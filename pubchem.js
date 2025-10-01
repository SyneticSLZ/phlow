#!/usr/bin/env node
/**
 * PubChem-only Server (Node.js + Express)
 * Purpose: discover NEW PubChem Substances (SIDs), map to Compounds (CIDs),
 * extract depositor (company/lab/vendor), and serve clean JSON for BD/CI.
 *
 * Features
 * - Endpoints to list SIDs by date window (mdat), map SID→CID, fetch CID meta
 * - Ingestion endpoint that stores SID↔CID↔Depositor into SQLite
 * - Vendor blocklist filter (skip Enamine/ChemBridge/etc.)
 * - Polite usage: custom User-Agent, backoff on 429/503, pacing + tiny concurrency
 * - CORS enabled so you can call from your existing dashboard
 *
 * Quickstart
 *   npm init -y
 *   npm i express axios better-sqlite3 cors dayjs
 *   node pubchem-only-server.js
 *
 * Environment (optional)
 *   PUBCHEM_CONTACT_EMAIL=you@company.com   # used in UA + E-utilities tool param
 *   PORT=5051
 */

const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');
const cors = require('cors');
const dayjs = require('dayjs');

// ------------------ Config ------------------
const PORT = process.env.PORT || 5051;
const CONTACT_EMAIL = process.env.PUBCHEM_CONTACT_EMAIL || 'you@company.com';
const UA = `pubchem-only/1.0 (contact: ${CONTACT_EMAIL})`;
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

// Vendor blocklist (skip generic libraries/vendors)
const VENDOR_BLOCKLIST = [
  /enamine/i,
  /chembridge/i,
  /sigma[-\s]?aldrich/i,
  /alfa[-\s]?aesar/i,
  /tcichemicals?/i,
  /boc\s*sciences/i,
  /selleck/i,
  /molport/i,
  /mcule/i,
  /matrix\s*scientific/i,
  /synleadin/i,
];

function isVendorDepositor(name = '') { return VENDOR_BLOCKLIST.some(rx => rx.test(name)); }

// ------------------ HTTP helpers ------------------
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function politeGet(url, attempt=1){
  try {
    const res = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    return res;
  } catch (err) {
    const status = err.response?.status;
    const retryAfter = Number(err.response?.headers?.['retry-after']) || 0;
    if ((status === 429 || status === 503 || !status) && attempt <= 6) {
      const waitMs = Math.max((retryAfter||3)*1000, 1000 * 2**(attempt-1));
      console.warn(`[backoff] ${status||'net'} on ${url} — retry in ${Math.round(waitMs/1000)}s (attempt ${attempt})`);
      await sleep(waitMs);
      return politeGet(url, attempt+1);
    }
    throw err;
  }
}

// simple concurrency limiter
async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  async function worker(){
    while(i < items.length){
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch(e){ out[idx] = null; console.warn(`[worker] item ${idx} failed: ${e.message}`); }
      await sleep(350); // keep global pace ~3 req/sec
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out.filter(Boolean);
}

// ------------------ DB ------------------
const db = new Database('pubchem.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS depositors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  type TEXT,             -- 'company'|'university'|'vendor'|'unknown'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS substances (
  sid INTEGER PRIMARY KEY,
  depositor_id INTEGER,
  mindate TEXT,          -- window when ingested (optional)
  maxdate TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(depositor_id) REFERENCES depositors(id)
);
CREATE TABLE IF NOT EXISTS compounds (
  cid INTEGER PRIMARY KEY,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid INTEGER,
  cid INTEGER,
  UNIQUE(sid, cid),
  FOREIGN KEY(sid) REFERENCES substances(sid),
  FOREIGN KEY(cid) REFERENCES compounds(cid)
);
`);

const upsertDepositor = db.prepare(`
INSERT INTO depositors(name, type) VALUES(?, ?)
ON CONFLICT(name) DO UPDATE SET type=COALESCE(excluded.type, depositors.type)
`);
const getDepositor = db.prepare('SELECT * FROM depositors WHERE name = ?');
const insertSubstance = db.prepare('INSERT OR IGNORE INTO substances(sid, depositor_id, mindate, maxdate) VALUES(?,?,?,?)');
const insertCompound = db.prepare('INSERT OR IGNORE INTO compounds(cid, name) VALUES(?,?)');
const insertLink = db.prepare('INSERT OR IGNORE INTO links(sid, cid) VALUES(?,?)');

function classifyDepositor(name=''){
  if (!name) return 'unknown';
  if (isVendorDepositor(name)) return 'vendor';
  if (/univ|college|institute|hospital|centre|center|school/i.test(name)) return 'university';
  return 'company';
}

// ------------------ PubChem fetchers ------------------
async function esearchSIDs({ mindate, maxdate, retmax=500 }){
  const PAGE=100; let retstart=0; const ids=[];
  while(retstart < retmax){
    const url = `${EUTILS}/esearch.fcgi?db=pcsubstance&retmode=json&sort=datemodified`
      + `&tool=pubchem-only&email=${encodeURIComponent(CONTACT_EMAIL)}`
      + `&term=all[sb]&datetype=mdat&mindate=${mindate}&maxdate=${maxdate}`
      + `&retstart=${retstart}&retmax=${PAGE}`;
    const { data } = await politeGet(url);
    const batch = data?.esearchresult?.idlist || [];
    if (!batch.length) break;
    ids.push(...batch.map(Number));
    retstart += batch.length;
    await sleep(350);
    if (batch.length < PAGE) break;
  }
  return ids.slice(0, retmax);
}

async function sidDetails(sid){
  const url = `${PUG}/substance/sid/${sid}/JSON`;
  const { data } = await politeGet(url);
  const rec = data?.PC_Substances?.[0] || {};
  const depositor = rec.sourceinfo?.[0]?.db?.name || 'Unknown';
  return { sid, depositor };
}

async function sidToCIDs(sid){
  const url = `${PUG}/substance/sid/${sid}/cids/JSON`;
  const { data } = await politeGet(url);
  const info = data?.InformationList?.Information?.[0];
  let cids = info?.CID || [];
  if (!Array.isArray(cids)) cids = cids ? [cids] : [];
  return cids.map(Number);
}

async function cidMeta(cid){
  const url = `${PUG}/compound/cid/${cid}/JSON`;
  const { data } = await politeGet(url);
  const rec = data?.PC_Compounds?.[0];
  const props = rec?.props || [];
  const pick = (label) => props.find(p=>p.urn?.label===label)?.value?.sval || null;
  const name = pick('IUPAC Name') || pick('Title') || null;
  return { cid, name };
}

// ------------------ Express App ------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req,res)=>res.json({ ok:true, time:new Date().toISOString() }));

// 1) Dry-run: list SIDs in a window (no DB writes)
// GET /pubchem/sids?mindate=YYYY/MM/DD&maxdate=YYYY/MM/DD&retmax=500
app.get('/pubchem/sids', async (req,res)=>{
  try {
    const mindate = req.query.mindate || dayjs().subtract(30,'day').format('YYYY/MM/DD');
    const maxdate = req.query.maxdate || dayjs().format('YYYY/MM/DD');
    const retmax  = Number(req.query.retmax || 200);
    const sids = await esearchSIDs({ mindate, maxdate, retmax });
    res.json({ mindate, maxdate, count: sids.length, sids });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) Dry-run: inspect a SID (depositor + CIDs)
// GET /pubchem/sid/:sid
app.get('/pubchem/sid/:sid', async (req,res)=>{
  try {
    const sid = Number(req.params.sid);
    const det = await sidDetails(sid);
    const cids = await sidToCIDs(sid);
    res.json({ ...det, cids });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3) Dry-run: inspect a CID (basic meta)
// GET /pubchem/cid/:cid
app.get('/pubchem/cid/:cid', async (req,res)=>{
  try {
    const cid = Number(req.params.cid);
    const meta = await cidMeta(cid);
    res.json(meta);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4) Ingest window: fetch SIDs, map to CIDs, store in DB with depositor mapping
// POST /pubchem/ingest { mindate?: 'YYYY/MM/DD', maxdate?: 'YYYY/MM/DD', retmax?: 500, includeVendors?: false, fetchCidMeta?: false }
app.post('/pubchem/ingest', async (req,res)=>{
  try {
    const mindate = req.body?.mindate || dayjs().subtract(90,'day').format('YYYY/MM/DD');
    const maxdate = req.body?.maxdate || dayjs().format('YYYY/MM/DD');
    const retmax  = Number(req.body?.retmax || 500);
    const includeVendors = !!req.body?.includeVendors;
    const fetchCidMetaFlag = !!req.body?.fetchCidMeta;

    const sids = await esearchSIDs({ mindate, maxdate, retmax });
    let processed=0, storedPairs=0, skippedVendors=0;

    for (const sid of sids){
      processed++;
      const { depositor } = await sidDetails(sid);
      if (!includeVendors && isVendorDepositor(depositor)) { skippedVendors++; continue; }

      const depType = classifyDepositor(depositor);
      upsertDepositor.run(depositor, depType);
      const dep = getDepositor.get(depositor);
      insertSubstance.run(sid, dep.id, mindate, maxdate);

      const cids = await sidToCIDs(sid);
      for (const cid of cids){
        if (fetchCidMetaFlag){
          const meta = await cidMeta(cid); // paced by mapLimit above; here sequential with sleep inside helper
          insertCompound.run(meta.cid, meta.name);
        } else {
          insertCompound.run(cid, null);
        }
        insertLink.run(sid, cid);
        storedPairs++;
      }
    }

    res.json({ ok:true, window:{ mindate, maxdate }, sids:sids.length, processed, storedPairs, skippedVendors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5) Recent pairs (for UI):
// GET /pubchem/recent?limit=50
app.get('/pubchem/recent', (req,res)=>{
  const limit = Number(req.query.limit || 50);
  const rows = db.prepare(`
    SELECT l.sid, l.cid, d.name AS depositor, d.type AS depositor_type, c.name AS cid_name
    FROM links l
    LEFT JOIN substances s ON s.sid=l.sid
    LEFT JOIN depositors d ON d.id=s.depositor_id
    LEFT JOIN compounds c ON c.cid=l.cid
    ORDER BY l.id DESC LIMIT ?
  `).all(limit);
  res.json({ items: rows });
});

// 6) Search by depositor name
// GET /pubchem/search?depositor=Acme
app.get('/pubchem/search', (req,res)=>{
  const q = req.query.depositor || '';
  const rows = db.prepare(`
    SELECT d.name AS depositor, d.type, s.sid, GROUP_CONCAT(l.cid) AS cids
    FROM depositors d
    LEFT JOIN substances s ON s.depositor_id=d.id
    LEFT JOIN links l ON l.sid=s.sid
    WHERE d.name LIKE '%'||?||'%'
    GROUP BY d.id, s.sid
    ORDER BY s.created_at DESC
  `).all(q);
  res.json({ query:q, items: rows });
});

app.listen(PORT, ()=>{
  console.log(`PubChem-only server listening on :${PORT}`);
});
