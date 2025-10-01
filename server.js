#!/usr/bin/env node
/**
 * CDMO Phase 1 Lead Discovery Engine - Enterprise Grade
 * 
 * A comprehensive backend system for discovering and scoring biopharma companies
 * entering IND-enabling/Phase 1, optimized for CDMO business development
 * 
 * FEATURES:
 * - Multi-source data aggregation (7+ sources)
 * - Intelligent scoring algorithm
 * - Real-time API integrations
 * - Robust error handling and retries
 * - Data enrichment pipeline
 * - Contact discovery
 * - Automated scheduled ingestion
 */

const express = require('express');
const Database = require('better-sqlite3');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { z } = require('zod');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const utc = require('dayjs/plugin/utc');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const dotenv = require('dotenv');
const crypto = require('crypto');
const PrePhase1Discovery = require('./pre-phase1-discovery.js');
dayjs.extend(customParseFormat);
dayjs.extend(utc);
dotenv.config();

// ===========================
// LOGGING CONFIGURATION
// ===========================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ===========================
// EXPRESS SETUP
// ===========================
const app = express();



app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',

}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});

app.use('/api/', limiter);

// ===========================
// DATABASE INITIALIZATION
// ===========================
const db = new Database('cdmo_leads.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Enhanced database schema
db.exec(`
  -- Companies table with comprehensive tracking
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    domain TEXT,
    country TEXT,
    employee_count INTEGER,
    employee_band TEXT,
    founded_year INTEGER,
    headquarters TEXT,
    description TEXT,
    industry_codes TEXT,
    has_internal_gmp INTEGER DEFAULT 0,
    outsourcing_probability REAL,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Enhanced funding table
  CREATE TABLE IF NOT EXISTS funding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    round_type TEXT,
    amount_usd REAL,
    date TEXT,
    investors TEXT,
    lead_investor TEXT,
    source TEXT,
    press_release_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Comprehensive molecules tracking
  CREATE TABLE IF NOT EXISTS molecules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT,
    pubchem_cid TEXT,
    chembl_id TEXT,
    target TEXT,
    target_class TEXT,
    mechanism_of_action TEXT,
    modality TEXT,
    indication TEXT,
    therapeutic_area TEXT,
    development_stage TEXT,
    structure_available INTEGER DEFAULT 0,
    process_chemistry_complexity TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name),
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Enhanced trials tracking
  CREATE TABLE IF NOT EXISTS trials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    molecule_id INTEGER,
    registry TEXT,
    trial_id TEXT,
    phase TEXT,
    status TEXT,
    title TEXT,
    start_date TEXT,
    completion_date TEXT,
    first_posted TEXT,
    last_update TEXT,
    enrollment INTEGER,
    locations TEXT,
    has_us_sites INTEGER DEFAULT 0,
    has_eu_sites INTEGER DEFAULT 0,
    sponsor_type TEXT,
    collaborators TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(registry, trial_id),
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY(molecule_id) REFERENCES molecules(id) ON DELETE SET NULL
  );

  -- Comprehensive signals tracking
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    signal_type TEXT NOT NULL,
    signal_strength TEXT,
    source TEXT,
    url TEXT,
    date TEXT,
    title TEXT,
    content TEXT,
    relevance_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Enhanced patents tracking
  CREATE TABLE IF NOT EXISTS patents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    molecule_id INTEGER,
    patent_number TEXT UNIQUE,
    title TEXT,
    abstract TEXT,
    filing_date TEXT,
    publication_date TEXT,
    assignee TEXT,
    inventors TEXT,
    classification_codes TEXT,
    claims_count INTEGER,
    process_chemistry_relevant INTEGER DEFAULT 0,
    url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY(molecule_id) REFERENCES molecules(id) ON DELETE SET NULL
  );

  -- Enhanced contacts tracking
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT,
    title TEXT,
    department TEXT,
    seniority_level TEXT,
    email TEXT,
    email_verified INTEGER DEFAULT 0,
    phone TEXT,
    linkedin_url TEXT,
    twitter_handle TEXT,
    bio TEXT,
    source TEXT,
    confidence_score REAL,
    last_verified DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Comprehensive scoring table
  CREATE TABLE IF NOT EXISTS scores (
    company_id INTEGER PRIMARY KEY,
    overall_score REAL,
    phase1_readiness_score REAL,
    funding_score REAL,
    outsourcing_likelihood_score REAL,
    molecule_quality_score REAL,
    timing_score REAL,
    can_pay INTEGER DEFAULT 0,
    needs_cdmo INTEGER DEFAULT 0,
    is_stale INTEGER DEFAULT 0,
    priority_tier TEXT,
    score_components TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Job postings tracking
  CREATE TABLE IF NOT EXISTS job_postings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    title TEXT,
    department TEXT,
    location TEXT,
    posted_date TEXT,
    url TEXT,
    cmc_relevant INTEGER DEFAULT 0,
    manufacturing_relevant INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Conference presentations tracking
  CREATE TABLE IF NOT EXISTS conference_presentations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    conference_name TEXT,
    presentation_title TEXT,
    abstract_text TEXT,
    presentation_date TEXT,
    authors TEXT,
    url TEXT,
    phase1_mentioned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  -- Create indexes for performance
  CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
  CREATE INDEX IF NOT EXISTS idx_trials_company ON trials(company_id);
  CREATE INDEX IF NOT EXISTS idx_trials_phase ON trials(phase);
  CREATE INDEX IF NOT EXISTS idx_molecules_company ON molecules(company_id);
  CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(company_id);
  CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
  CREATE INDEX IF NOT EXISTS idx_scores_overall ON scores(overall_score DESC);
  CREATE INDEX IF NOT EXISTS idx_patents_filing ON patents(filing_date DESC);
`);
// Ensure ON CONFLICT target exists for contacts upsert
db.exec(`
  -- De-dup (optional; only needed if you already have duplicates)
  DELETE FROM contacts
  WHERE id IN (
    SELECT id FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY company_id, COALESCE(email, '')
          ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
        ) AS rn
      FROM contacts
    )
    WHERE rn > 1
  );

  -- Make (company_id, email) unique so ON CONFLICT(company_id, email) works
  CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_company_email
  ON contacts(company_id, email);
`);

// ===========================
// UTILITY FUNCTIONS
// ===========================
class RetryableRequest {
  static async execute(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        logger.warn(`Request failed, retry ${i + 1}/${retries}`, { error: error.message });
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
}

// Database helpers
const dbHelpers = {
  upsertCompany: db.prepare(`
    INSERT INTO companies(name, domain, country, employee_count, employee_band, 
                         founded_year, headquarters, description, industry_codes, 
                         has_internal_gmp, outsourcing_probability, updated_at)
    VALUES (@name, @domain, @country, @employee_count, @employee_band,
            @founded_year, @headquarters, @description, @industry_codes,
            @has_internal_gmp, @outsourcing_probability, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      domain = COALESCE(excluded.domain, companies.domain),
      country = COALESCE(excluded.country, companies.country),
      employee_count = COALESCE(excluded.employee_count, companies.employee_count),
      employee_band = COALESCE(excluded.employee_band, companies.employee_band),
      founded_year = COALESCE(excluded.founded_year, companies.founded_year),
      headquarters = COALESCE(excluded.headquarters, companies.headquarters),
      description = COALESCE(excluded.description, companies.description),
      has_internal_gmp = COALESCE(excluded.has_internal_gmp, companies.has_internal_gmp),
      outsourcing_probability = COALESCE(excluded.outsourcing_probability, companies.outsourcing_probability),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `),

  getCompany: db.prepare('SELECT * FROM companies WHERE name = ?'),
  getCompanyById: db.prepare('SELECT * FROM companies WHERE id = ?'),

  insertFunding: db.prepare(`
    INSERT INTO funding(company_id, round_type, amount_usd, date, investors, 
                       lead_investor, source, press_release_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  upsertMolecule: db.prepare(`
    INSERT INTO molecules(company_id, name, pubchem_cid, chembl_id, target, 
                         target_class, mechanism_of_action, modality, indication,
                         therapeutic_area, development_stage, structure_available,
                         process_chemistry_complexity, updated_at)
    VALUES (@company_id, @name, @pubchem_cid, @chembl_id, @target,
            @target_class, @mechanism_of_action, @modality, @indication,
            @therapeutic_area, @development_stage, @structure_available,
            @process_chemistry_complexity, CURRENT_TIMESTAMP)
    ON CONFLICT(company_id, name) DO UPDATE SET
      pubchem_cid = COALESCE(excluded.pubchem_cid, molecules.pubchem_cid),
      chembl_id = COALESCE(excluded.chembl_id, molecules.chembl_id),
      target = COALESCE(excluded.target, molecules.target),
      mechanism_of_action = COALESCE(excluded.mechanism_of_action, molecules.mechanism_of_action),
      modality = COALESCE(excluded.modality, molecules.modality),
      indication = COALESCE(excluded.indication, molecules.indication),
      therapeutic_area = COALESCE(excluded.therapeutic_area, molecules.therapeutic_area),
      development_stage = COALESCE(excluded.development_stage, molecules.development_stage),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `),

  upsertTrial: db.prepare(`
    INSERT INTO trials(company_id, molecule_id, registry, trial_id, phase, status,
                      title, start_date, completion_date, first_posted, last_update,
                      enrollment, locations, has_us_sites, has_eu_sites, sponsor_type,
                      collaborators)
    VALUES (@company_id, @molecule_id, @registry, @trial_id, @phase, @status,
            @title, @start_date, @completion_date, @first_posted, @last_update,
            @enrollment, @locations, @has_us_sites, @has_eu_sites, @sponsor_type,
            @collaborators)
    ON CONFLICT(registry, trial_id) DO UPDATE SET
      phase = excluded.phase,
      status = excluded.status,
      last_update = excluded.last_update,
      enrollment = COALESCE(excluded.enrollment, trials.enrollment),
      locations = COALESCE(excluded.locations, trials.locations)
    RETURNING id
  `),

  insertSignal: db.prepare(`
    INSERT INTO signals(company_id, signal_type, signal_strength, source, url,
                       date, title, content, relevance_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  upsertPatent: db.prepare(`
    INSERT INTO patents(company_id, molecule_id, patent_number, title, abstract,
                       filing_date, publication_date, assignee, inventors,
                       classification_codes, claims_count, process_chemistry_relevant, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(patent_number) DO UPDATE SET
      title = excluded.title,
      abstract = excluded.abstract,
      process_chemistry_relevant = excluded.process_chemistry_relevant
    RETURNING id
  `),

  upsertContact: db.prepare(`
    INSERT INTO contacts(company_id, name, title, department, seniority_level,
                        email, email_verified, phone, linkedin_url, twitter_handle,
                        bio, source, confidence_score, last_verified, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(company_id, email) DO UPDATE SET
      title = COALESCE(excluded.title, contacts.title),
      department = COALESCE(excluded.department, contacts.department),
      linkedin_url = COALESCE(excluded.linkedin_url, contacts.linkedin_url),
      confidence_score = MAX(excluded.confidence_score, contacts.confidence_score),
      updated_at = CURRENT_TIMESTAMP
  `),

  upsertScore: db.prepare(`
    INSERT INTO scores(company_id, overall_score, phase1_readiness_score,
                      funding_score, outsourcing_likelihood_score, molecule_quality_score,
                      timing_score, can_pay, needs_cdmo, is_stale, priority_tier,
                      score_components, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(company_id) DO UPDATE SET
      overall_score = excluded.overall_score,
      phase1_readiness_score = excluded.phase1_readiness_score,
      funding_score = excluded.funding_score,
      outsourcing_likelihood_score = excluded.outsourcing_likelihood_score,
      molecule_quality_score = excluded.molecule_quality_score,
      timing_score = excluded.timing_score,
      can_pay = excluded.can_pay,
      needs_cdmo = excluded.needs_cdmo,
      is_stale = excluded.is_stale,
      priority_tier = excluded.priority_tier,
      score_components = excluded.score_components,
      updated_at = CURRENT_TIMESTAMP
  `)
};



// After database initialization, add:
const prePhase1 = new PrePhase1Discovery(db, logger);



// ===========================
// DATA SOURCE ADAPTERS
// ===========================

class ClinicalTrialsAPI {
  static async fetchPhase1Trials(options = {}) {
    const {
      maxResults = 1000,
      sinceDays = 180,
      country = null
    } = options;

    try {
      const baseUrl = 'https://clinicaltrials.gov/api/v2/studies';
      const sinceDate = dayjs().subtract(sinceDays, 'day').format('YYYY-MM-DD');
      
      // Build query using the new API format
      const queryParts = [
        'AREA[StudyType]Interventional',
        'AREA[Phase](Phase 1 OR Early Phase 1)',
        `AREA[StudyFirstPostDate]RANGE[${sinceDate}, MAX]`
      ];
      
      if (country) {
        queryParts.push(`AREA[LocationCountry]${country}`);
      }
      
      const params = new URLSearchParams({
        'query.cond': 'NOT cancer', // Exclude oncology initially for focused results
        'query.term': queryParts.join(' AND '),
        'pageSize': '100',
        'countTotal': 'true',
        'fields': 'NCTId|OfficialTitle|Phase|OverallStatus|StartDate|CompletionDate|' +
                 'LeadSponsorName|LeadSponsorClass|InterventionName|InterventionType|' +
                 'Condition|LocationCountry|LocationCity|EnrollmentCount|StudyFirstPostDate'
      });

      let allStudies = [];
      let pageToken = null;
      let totalFetched = 0;

      do {
        const url = pageToken 
          ? `${baseUrl}?${params.toString()}&pageToken=${pageToken}`
          : `${baseUrl}?${params.toString()}`;

        const response = await RetryableRequest.execute(async () => {
          const res = await axios.get(url, {
            timeout: 30000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'CDMO-Lead-Engine/1.0'
            }
          });
          return res.data;
        });

        const studies = response.studies || [];
        allStudies = allStudies.concat(studies);
        totalFetched += studies.length;

        pageToken = response.nextPageToken;
        
        if (totalFetched >= maxResults) break;
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } while (pageToken);

      logger.info(`Fetched ${allStudies.length} Phase 1 trials from ClinicalTrials.gov`);
      
      return allStudies.map(study => this.normalizeTrialData(study));
    } catch (error) {
      logger.error('Error fetching ClinicalTrials.gov data:', error);
      throw error;
    }
  }

  static normalizeTrialData(study) {
    const protocolSection = study.protocolSection || {};
    const identificationModule = protocolSection.identificationModule || {};
    const statusModule = protocolSection.statusModule || {};
    const designModule = protocolSection.designModule || {};
    const sponsorModule = protocolSection.sponsorCollaboratorsModule || {};
    const armsModule = protocolSection.armsInterventionsModule || {};
    const conditionsModule = protocolSection.conditionsModule || {};
    const contactsModule = protocolSection.contactsLocationsModule || {};

    const locations = contactsModule.locations || [];
    const hasUSSites = locations.some(loc => 
      loc.country === 'United States' || loc.country === 'USA'
    );
    const hasEUSites = locations.some(loc => 
      ['Germany', 'France', 'Italy', 'Spain', 'United Kingdom', 'Netherlands', 
       'Belgium', 'Switzerland', 'Austria', 'Denmark', 'Sweden', 'Norway', 
       'Finland', 'Poland'].includes(loc.country)
    );

    return {
      registry: 'ClinicalTrials.gov',
      trialId: identificationModule.nctId,
      title: identificationModule.officialTitle || identificationModule.briefTitle,
      phase: (designModule.phases || []).join(', '),
      status: statusModule.overallStatus,
      startDate: statusModule.startDateStruct?.date,
      completionDate: statusModule.completionDateStruct?.date,
      firstPosted: statusModule.studyFirstPostDateStruct?.date,
      lastUpdate: statusModule.lastUpdatePostDateStruct?.date,
      sponsor: sponsorModule.leadSponsor?.name,
      sponsorClass: sponsorModule.leadSponsor?.class,
      collaborators: (sponsorModule.collaborators || []).map(c => c.name),
      interventions: armsModule.interventions || [],
      conditions: conditionsModule.conditions || [],
      enrollment: designModule.enrollmentInfo?.count,
      hasUSSites,
      hasEUSites,
      locationCountries: [...new Set(locations.map(l => l.country))].filter(Boolean)
    };
  }
}

class FDADataAPI {
  static async fetchRecentINDApprovals(options = {}) {
    const { sinceDays = 90 } = options;
    
    try {
      // FDA Orange Book API for new drug applications
      const baseUrl = 'https://api.fda.gov/drug/drugsfda.json';
      const sinceDate = dayjs().subtract(sinceDays, 'day').format('YYYYMMDD');
      
      const params = new URLSearchParams({
        search: `submissions.submission_type:"IND" AND submissions.submission_status_date:[${sinceDate} TO ${dayjs().format('YYYYMMDD')}]`,
        limit: '100'
      });

      const response = await RetryableRequest.execute(async () => {
        const res = await axios.get(`${baseUrl}?${params.toString()}`, {
          timeout: 20000
        });
        return res.data;
      });

      const results = response.results || [];
      
      // Also fetch FDA press releases
      const pressReleases = await this.fetchFDAPressReleases();
      
      return {
        indApprovals: results,
        pressReleases: pressReleases
      };
    } catch (error) {
      logger.error('Error fetching FDA data:', error);
      return { indApprovals: [], pressReleases: [] };
    }
  }

  static async fetchFDAPressReleases() {
    try {
      // FDA provides RSS feed for press announcements
      const rssUrl = 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/fda-newsroom/rss.xml';
      
      const response = await axios.get(rssUrl, {
        timeout: 15000,
        headers: {
          'Accept': 'application/rss+xml,application/xml'
        }
      });

      // Basic XML parsing for RSS
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      const titleRegex = /<title>(.*?)<\/title>/;
      const linkRegex = /<link>(.*?)<\/link>/;
      const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
      const descRegex = /<description>(.*?)<\/description>/;

      let match;
      while ((match = itemRegex.exec(response.data)) !== null) {
        const itemContent = match[1];
        const title = (titleRegex.exec(itemContent) || [])[1];
        const link = (linkRegex.exec(itemContent) || [])[1];
        const pubDate = (pubDateRegex.exec(itemContent) || [])[1];
        const description = (descRegex.exec(itemContent) || [])[1];

        // Filter for relevant keywords
        if (title && /IND|Phase 1|clinical trial|first-in-human/i.test(title + ' ' + description)) {
          items.push({
            title: this.decodeHTMLEntities(title),
            link,
            pubDate: pubDate ? dayjs(pubDate).format('YYYY-MM-DD') : null,
            description: this.decodeHTMLEntities(description)
          });
        }
      }

      return items;
    } catch (error) {
      logger.error('Error fetching FDA press releases:', error);
      return [];
    }
  }

  static decodeHTMLEntities(text) {
    if (!text) return '';
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
  }
}

class PatentAPI {
  static async searchPatents(options = {}) {
    const {
      query = 'IND enabling manufacturing',
      assignee = null,
      sinceDays = 365
    } = options;

    try {
      // USPTO PatentsView API
      const baseUrl = 'https://api.patentsview.org/patents/query';
      const sinceDate = dayjs().subtract(sinceDays, 'day').format('YYYY-MM-DD');

      const queryObj = {
        _and: [
          {
            _or: [
              { _text_phrase: { patent_abstract: query } },
              { _text_phrase: { patent_title: 'process for preparing' } },
              { _text_phrase: { patent_title: 'pharmaceutical composition' } }
            ]
          },
          { _gte: { patent_date: sinceDate } }
        ]
      };

      if (assignee) {
        queryObj._and.push({ _begins: { assignee_organization: assignee } });
      }

      const requestBody = {
        q: queryObj,
        f: [
          'patent_number',
          'patent_title',
          'patent_abstract',
          'patent_date',
          'assignee_organization',
          'inventor_first_name',
          'inventor_last_name',
          'cpc_section',
          'patent_num_claims'
        ],
        s: [{ patent_date: 'desc' }],
        o: { per_page: 100 }
      };

      const response = await RetryableRequest.execute(async () => {
        const res = await axios.post(baseUrl, requestBody, {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        return res.data;
      });

      const patents = response.patents || [];
      
      // Filter for process chemistry relevance
      const processChemPatents = patents.filter(p => {
        const title = (p.patent_title || '').toLowerCase();
        const abstract = (p.patent_abstract || '').toLowerCase();
        return (
          title.includes('process') ||
          title.includes('synthesis') ||
          title.includes('manufacture') ||
          title.includes('preparation') ||
          abstract.includes('gmp') ||
          abstract.includes('scale-up') ||
          abstract.includes('clinical')
        );
      });

      logger.info(`Found ${processChemPatents.length} relevant patents`);
      return processChemPatents;
    } catch (error) {
      logger.error('Error fetching patent data:', error);
      return [];
    }
  }
}

class PubChemAPI {
  static async enrichMolecule(name) {
    try {
      // First, get CID by name
      const cidUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/cids/JSON`;
      
      const cidResponse = await RetryableRequest.execute(async () => {
        const res = await axios.get(cidUrl, { timeout: 10000 });
        return res.data;
      });

      if (!cidResponse.IdentifierList?.CID?.[0]) {
        return null;
      }

      const cid = cidResponse.IdentifierList.CID[0];
      
      // Get compound details
      const detailUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`;
      
      const detailResponse = await RetryableRequest.execute(async () => {
        const res = await axios.get(detailUrl, { timeout: 10000 });
        return res.data;
      });

      const properties = detailResponse.PropertyTable?.Properties?.[0] || {};

      // Get bioassay data if available
      const bioassayUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/assaysummary/JSON`;
      
      let bioassayData = {};
      try {
        const bioResponse = await axios.get(bioassayUrl, { timeout: 10000 });
        bioassayData = bioResponse.data;
      } catch (e) {
        // Bioassay data might not be available
      }

      return {
        pubchemCid: cid.toString(),
        molecularFormula: properties.MolecularFormula,
        molecularWeight: properties.MolecularWeight,
        smiles: properties.CanonicalSMILES,
        iupacName: properties.IUPACName,
        bioassayCount: bioassayData.Table?.Row?.length || 0,
        structureAvailable: properties.CanonicalSMILES ? 1 : 0
      };
    } catch (error) {
      logger.error(`Error enriching molecule ${name}:`, error.message);
      return null;
    }
  }
}

class CompanyEnrichmentService {
  static async enrichFromCrunchbase(companyName) {
    if (!process.env.CRUNCHBASE_API_KEY) {
      return null;
    }

    try {
      const apiKey = process.env.CRUNCHBASE_API_KEY;
      const baseUrl = 'https://api.crunchbase.com/v4/entities/organizations';
      
      // Search for company
      const searchUrl = `${baseUrl}?field_ids=name,identifier,short_description,num_employees_enum,founded_on,headquarters_location,funding_total&query=${encodeURIComponent(companyName)}&limit=1`;
      
      const response = await axios.get(searchUrl, {
        headers: {
          'X-cb-user-key': apiKey
        },
        timeout: 15000
      });

      const entity = response.data.entities?.[0];
      if (!entity) return null;

      return {
        domain: entity.properties.website_url,
        employeeCount: this.parseEmployeeEnum(entity.properties.num_employees_enum),
        foundedYear: entity.properties.founded_on?.year,
        headquarters: entity.properties.headquarters_location?.value,
        totalFunding: entity.properties.funding_total?.value_usd,
        description: entity.properties.short_description
      };
    } catch (error) {
      logger.error('Crunchbase enrichment error:', error.message);
      return null;
    }
  }

  static parseEmployeeEnum(enumValue) {
    const ranges = {
      'c_00001_00010': 5,
      'c_00011_00050': 30,
      'c_00051_00100': 75,
      'c_00101_00250': 175,
      'c_00251_00500': 375,
      'c_00501_01000': 750,
      'c_01001_05000': 3000,
      'c_05001_10000': 7500,
      'c_10001_max': 15000
    };
    return ranges[enumValue] || null;
  }

  static async enrichFromLinkedIn(companyName) {
    // LinkedIn API requires OAuth and company page access
    // This is a placeholder for integration
    return null;
  }
}

class ContactDiscoveryService {
  static async findContacts(companyName, companyDomain) {
    const contacts = [];

    // Try multiple sources
    if (process.env.HUNTER_API_KEY) {
      const hunterContacts = await this.searchHunterIO(companyDomain);
      contacts.push(...hunterContacts);
    }

    if (process.env.APOLLO_API_KEY) {
      const apolloContacts = await this.searchApollo(companyName);
      contacts.push(...apolloContacts);
    }

    if (process.env.CLEARBIT_API_KEY) {
      const clearbitContacts = await this.searchClearbit(companyDomain);
      contacts.push(...clearbitContacts);
    }

    // Deduplicate by email
    const uniqueContacts = [];
    const seenEmails = new Set();
    
    for (const contact of contacts) {
      if (contact.email && !seenEmails.has(contact.email.toLowerCase())) {
        seenEmails.add(contact.email.toLowerCase());
        uniqueContacts.push(contact);
      }
    }

    return uniqueContacts;
  }

  static async searchHunterIO(domain) {
    if (!domain || !process.env.HUNTER_API_KEY) return [];

    try {
      const url = `https://api.hunter.io/v2/domain-search`;
      const params = {
        domain: domain,
        api_key: process.env.HUNTER_API_KEY,
        limit: 10,
        department: 'management,executive'
      };

      const response = await axios.get(url, { params, timeout: 10000 });
      const emails = response.data.data?.emails || [];

      return emails.map(e => ({
        name: `${e.first_name} ${e.last_name}`.trim(),
        title: e.position,
        email: e.value,
        department: e.department,
        seniorityLevel: e.seniority,
        confidence: e.confidence / 100,
        source: 'Hunter.io',
        linkedin: e.linkedin
      }));
    } catch (error) {
      logger.error('Hunter.io search error:', error.message);
      return [];
    }
  }

  static async searchApollo(companyName) {
    if (!process.env.APOLLO_API_KEY) return [];

    try {
      const url = 'https://api.apollo.io/v1/mixed_people/search';
      
      const requestBody = {
        api_key: process.env.APOLLO_API_KEY,
        q_organization_name: companyName,
        page: 1,
        per_page: 10,
        person_titles: ['CEO', 'VP', 'Director', 'Head', 'Chief']
      };

      const response = await axios.post(url, requestBody, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      });

      const people = response.data.people || [];

      return people.map(p => ({
        name: p.name,
        title: p.title,
        email: p.email,
        department: p.departments?.[0],
        seniorityLevel: p.seniority,
        confidence: 0.8,
        source: 'Apollo.io',
        linkedin: p.linkedin_url,
        phone: p.phone_numbers?.[0]?.number
      }));
    } catch (error) {
      logger.error('Apollo.io search error:', error.message);
      return [];
    }
  }

  static async searchClearbit(domain) {
    if (!domain || !process.env.CLEARBIT_API_KEY) return [];

    try {
      const url = `https://prospector.clearbit.com/v1/people/search`;
      
      const params = {
        domain: domain,
        roles: 'ceo,vp,director',
        limit: 10
      };

      const response = await axios.get(url, {
        params,
        auth: {
          username: process.env.CLEARBIT_API_KEY,
          password: ''
        },
        timeout: 10000
      });

      const results = response.data.results || [];

      return results.map(r => ({
        name: r.name.fullName,
        title: r.title,
        email: r.email,
        seniorityLevel: r.role,
        confidence: 0.85,
        source: 'Clearbit',
        linkedin: r.linkedin?.handle ? `https://linkedin.com/in/${r.linkedin.handle}` : null
      }));
    } catch (error) {
      logger.error('Clearbit search error:', error.message);
      return [];
    }
  }
}

// ===========================
// SCORING ENGINE
// ===========================
class CDMOScoringEngine {
  static calculateScore(companyId) {
    const company = dbHelpers.getCompanyById.get(companyId);
    if (!company) return null;

    // Fetch all relevant data
    const trials = db.prepare('SELECT * FROM trials WHERE company_id = ?').all(companyId);
    const funding = db.prepare('SELECT * FROM funding WHERE company_id = ? ORDER BY date DESC').all(companyId);
    const molecules = db.prepare('SELECT * FROM molecules WHERE company_id = ?').all(companyId);
    const patents = db.prepare('SELECT * FROM patents WHERE company_id = ? AND filing_date > ?')
      .all(companyId, dayjs().subtract(18, 'month').format('YYYY-MM-DD'));
    const signals = db.prepare('SELECT * FROM signals WHERE company_id = ?').all(companyId);
    const jobPostings = db.prepare('SELECT * FROM job_postings WHERE company_id = ?').all(companyId);

    // Component scores
    const scores = {
      phase1Readiness: 0,
      funding: 0,
      outsourcingLikelihood: 0,
      moleculeQuality: 0,
      timing: 0
    };

    // 1. Phase 1 Readiness Score (0-30 points)
    const phase1Trials = trials.filter(t => t.phase?.includes('Phase 1'));
    const notYetRecruiting = phase1Trials.filter(t => t.status === 'Not yet recruiting');
    
    if (phase1Trials.length > 0) {
      scores.phase1Readiness += 15;
      if (notYetRecruiting.length > 0) scores.phase1Readiness += 10;
      if (phase1Trials.some(t => t.has_us_sites)) scores.phase1Readiness += 5;
    }

    // Check for IND signals
    const indSignals = signals.filter(s => 
      s.signal_type === 'ind' || 
      s.content?.toLowerCase().includes('ind') ||
      s.title?.toLowerCase().includes('ind-enabling')
    );
    if (indSignals.length > 0) scores.phase1Readiness += 10;

    // 2. Funding Score (0-25 points)
    const recentFunding = funding.filter(f => 
      dayjs(f.date).isAfter(dayjs().subtract(18, 'month'))
    );
    
    if (recentFunding.length > 0) {
      scores.funding += 10;
      const totalAmount = recentFunding.reduce((sum, f) => sum + (f.amount_usd || 0), 0);
      if (totalAmount > 50000000) scores.funding += 10;
      if (totalAmount > 100000000) scores.funding += 5;
    }

    // 3. Outsourcing Likelihood Score (0-25 points)
    const employeeCount = company.employee_count || 0;
    const hasGMP = company.has_internal_gmp;
    
    if (employeeCount > 0 && employeeCount <= 50) scores.outsourcingLikelihood += 15;
    else if (employeeCount <= 250) scores.outsourcingLikelihood += 10;
    else if (employeeCount <= 500) scores.outsourcingLikelihood += 5;
    
    if (!hasGMP) scores.outsourcingLikelihood += 10;

    // Check for CMC/manufacturing job postings
    const cmcJobs = jobPostings.filter(j => j.cmc_relevant || j.manufacturing_relevant);
    if (cmcJobs.length > 0) scores.outsourcingLikelihood += 5;

    // Check if they already have a CDMO partner
    const cdmoSignals = signals.filter(s => 
      s.signal_type === 'cdmo' || 
      s.content?.toLowerCase().includes('cdmo') ||
      s.content?.toLowerCase().includes('contract manufacturer')
    );
    if (cdmoSignals.length === 0) scores.outsourcingLikelihood += 5;

    // 4. Molecule Quality Score (0-10 points)
    const moleculesWithStructure = molecules.filter(m => m.structure_available);
    const moleculesWithTarget = molecules.filter(m => m.target);
    
    if (moleculesWithStructure.length > 0) scores.moleculeQuality += 5;
    if (moleculesWithTarget.length > 0) scores.moleculeQuality += 3;
    if (patents.length > 0) scores.moleculeQuality += 2;

    // 5. Timing Score (0-10 points) / Penalty for stale programs
    const oldestTrial = trials
      .filter(t => t.start_date)
      .sort((a, b) => dayjs(a.start_date).unix() - dayjs(b.start_date).unix())[0];
    
    if (oldestTrial) {
      const yearsInClinic = dayjs().diff(dayjs(oldestTrial.start_date), 'year');
      if (yearsInClinic < 1) scores.timing += 10;
      else if (yearsInClinic < 2) scores.timing += 5;
      else if (yearsInClinic >= 3) scores.timing -= 10; // Penalty for lingering
    } else {
      scores.timing += 5; // No trials yet but showing signals
    }

    // Calculate overall score
    const overallScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
    
    // Determine priority tier
    let priorityTier = 'C';
    if (overallScore >= 70) priorityTier = 'A';
    else if (overallScore >= 50) priorityTier = 'B';

    // Determine flags
    const canPay = recentFunding.length > 0 ? 1 : 0;
    const needsCDMO = scores.outsourcingLikelihood >= 15 ? 1 : 0;
    const isStale = scores.timing < 0 ? 1 : 0;

    // Save score
    dbHelpers.upsertScore.run(
      companyId,
      overallScore,
      scores.phase1Readiness,
      scores.funding,
      scores.outsourcingLikelihood,
      scores.moleculeQuality,
      scores.timing,
      canPay,
      needsCDMO,
      isStale,
      priorityTier,
      JSON.stringify(scores)
    );

    return {
      companyId,
      overallScore,
      priorityTier,
      ...scores,
      canPay,
      needsCDMO,
      isStale
    };
  }

  static async rescoreAllCompanies() {
    const companies = db.prepare('SELECT id FROM companies').all();
    const results = [];
    
    for (const company of companies) {
      const score = this.calculateScore(company.id);
      if (score) results.push(score);
    }
    
    logger.info(`Rescored ${results.length} companies`);
    return results;
  }
}

// ===========================
// INGESTION ORCHESTRATOR
// ===========================
class DataIngestionOrchestrator {
  static async ingestClinicalTrials(options = {}) {
    try {
      logger.info('Starting clinical trials ingestion...');
      const trials = await ClinicalTrialsAPI.fetchPhase1Trials(options);
      
      let companiesProcessed = 0;
      let trialsAdded = 0;

      for (const trial of trials) {
        if (!trial.sponsor) continue;

        // Create or update company
        const companyData = {
          name: trial.sponsor,
          domain: null,
          country: trial.locationCountries?.[0] || null,
          employee_count: null,
          employee_band: null,
          founded_year: null,
          headquarters: null,
          description: null,
          industry_codes: null,
          has_internal_gmp: trial.sponsorClass === 'INDUSTRY' ? 0 : null,
          outsourcing_probability: null
        };

        // const result = dbHelpers.upsertCompany.run(companyData);
        // const companyId = result.id;
        const result = dbHelpers.upsertCompany.run(companyData);
let companyId = result.lastInsertRowid;

// If no lastInsertRowid, get the company by name
if (!companyId) {
  const company = dbHelpers.getCompany.get(trial.sponsor);
  if (!company) {
    logger.error(`Failed to get company ID for ${trial.sponsor}`);
    continue;
  }
  companyId = company.id;
}
        companiesProcessed++;

        // Extract molecule information from interventions
        let moleculeId = null;
        const drugInterventions = (trial.interventions || []).filter(i => 
          i.InterventionType === 'Drug' || i.InterventionType === 'Biological'
        );

        if (drugInterventions.length > 0) {
          const moleculeName = drugInterventions[0].InterventionName;
          const moleculeData = {
            company_id: companyId,
            name: moleculeName,
            pubchem_cid: null,
            chembl_id: null,
            target: null,
            target_class: null,
            mechanism_of_action: null,
            modality: drugInterventions[0].InterventionType,
            indication: trial.conditions?.join(', '),
            therapeutic_area: null,
            development_stage: 'Phase 1',
            structure_available: 0,
            process_chemistry_complexity: null
          };

          const molResult = dbHelpers.upsertMolecule.run(moleculeData);
          moleculeId = molResult.id;
        }

        // Add trial
        const trialData = {
          company_id: companyId,
          molecule_id: moleculeId,
          registry: trial.registry,
          trial_id: trial.trialId,
          phase: trial.phase,
          status: trial.status,
          title: trial.title,
          start_date: trial.startDate,
          completion_date: trial.completionDate,
          first_posted: trial.firstPosted,
          last_update: trial.lastUpdate,
          enrollment: trial.enrollment,
          locations: trial.locationCountries?.join(', '),
          has_us_sites: trial.hasUSSites ? 1 : 0,
          has_eu_sites: trial.hasEUSites ? 1 : 0,
          sponsor_type: trial.sponsorClass,
          collaborators: trial.collaborators?.join(', ')
        };

        dbHelpers.upsertTrial.run(trialData);
        trialsAdded++;

        // Add signal
        dbHelpers.insertSignal.run(
          companyId,
          'clinical_trial',
          'strong',
          'ClinicalTrials.gov',
          `https://clinicaltrials.gov/study/${trial.trialId}`,
          trial.firstPosted,
          trial.title,
          `Phase 1 trial: ${trial.status}`,
          0.9
        );
      }

      logger.info(`Processed ${companiesProcessed} companies and ${trialsAdded} trials`);
      return { companiesProcessed, trialsAdded };
    } catch (error) {
      logger.error('Clinical trials ingestion error:', error);
      throw error;
    }
  }

  static async ingestFDAData() {
    try {
      logger.info('Starting FDA data ingestion...');
      const fdaData = await FDADataAPI.fetchRecentINDApprovals();
      
      let signalsAdded = 0;

      // Process press releases
      for (const release of fdaData.pressReleases) {
        // Try to extract company name from title/description
        const companyMatch = release.title.match(/([A-Z][A-Za-z0-9\s\-\.]+(?:Inc|Corp|Ltd|LLC|Pharma|Bio|Therapeutics))/);
        if (companyMatch) {
          const companyName = companyMatch[1].trim();
          const companyData = {
            name: companyName,
            domain: null,
            country: 'United States',
            employee_count: null,
            employee_band: null,
            founded_year: null,
            headquarters: null,
            description: null,
            industry_codes: null,
            has_internal_gmp: null,
            outsourcing_probability: null
          };

          const result = dbHelpers.upsertCompany.run(companyData);
          
          dbHelpers.insertSignal.run(
            result.id,
            'fda_news',
            'medium',
            'FDA',
            release.link,
            release.pubDate,
            release.title,
            release.description,
            0.7
          );
          signalsAdded++;
        }
      }

      logger.info(`Added ${signalsAdded} FDA signals`);
      return { signalsAdded };
    } catch (error) {
      logger.error('FDA data ingestion error:', error);
      throw error;
    }
  }

  static async ingestPatents(options = {}) {
    try {
      logger.info('Starting patent ingestion...');
      const patents = await PatentAPI.searchPatents(options);
      
      let patentsAdded = 0;

      for (const patent of patents) {
        if (!patent.assignee_organization) continue;

        // Create or update company
        const companyData = {
          name: patent.assignee_organization,
          domain: null,
          country: null,
          employee_count: null,
          employee_band: null,
          founded_year: null,
          headquarters: null,
          description: null,
          industry_codes: null,
          has_internal_gmp: null,
          outsourcing_probability: null
        };

        // const result = dbHelpers.upsertCompany.run(companyData);
        // const companyId = result.id;
const result = dbHelpers.upsertCompany.run(companyData);
let companyId = result.lastInsertRowid;

// If no lastInsertRowid, get the company by name
if (!companyId) {
  const company = dbHelpers.getCompany.get(trial.sponsor);
  if (!company) {
    logger.error(`Failed to get company ID for ${trial.sponsor}`);
    continue;
  }
  companyId = company.id;
}
        // Determine if process chemistry relevant
        const isProcessChem = /process|synthesis|manufacture|preparation|scale|gmp/i.test(
          patent.patent_title + ' ' + patent.patent_abstract
        );

        dbHelpers.upsertPatent.run(
          companyId,
          null, // molecule_id
          patent.patent_number,
          patent.patent_title,
          patent.patent_abstract,
          patent.patent_date,
          patent.patent_date,
          patent.assignee_organization,
          null, // inventors
          patent.cpc_section,
          patent.patent_num_claims,
          isProcessChem ? 1 : 0,
          `https://patents.google.com/patent/US${patent.patent_number}`
        );

        // Add signal
        dbHelpers.insertSignal.run(
          companyId,
          'patent',
          isProcessChem ? 'strong' : 'medium',
          'USPTO',
          `https://patents.google.com/patent/US${patent.patent_number}`,
          patent.patent_date,
          patent.patent_title,
          patent.patent_abstract?.substring(0, 500),
          isProcessChem ? 0.9 : 0.6
        );

        patentsAdded++;
      }

      logger.info(`Added ${patentsAdded} patents`);
      return { patentsAdded };
    } catch (error) {
      logger.error('Patent ingestion error:', error);
      throw error;
    }
  }

  static async enrichMolecules() {
    try {
      logger.info('Starting molecule enrichment...');
      const molecules = db.prepare('SELECT * FROM molecules WHERE pubchem_cid IS NULL LIMIT 50').all();
      
      let enriched = 0;
      
      for (const molecule of molecules) {
        const enrichmentData = await PubChemAPI.enrichMolecule(molecule.name);
        
        if (enrichmentData) {
          db.prepare(`
            UPDATE molecules 
            SET pubchem_cid = ?, structure_available = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(enrichmentData.pubchemCid, enrichmentData.structureAvailable, molecule.id);
          
          enriched++;
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info(`Enriched ${enriched} molecules`);
      return { enriched };
    } catch (error) {
      logger.error('Molecule enrichment error:', error);
      throw error;
    }
  }

  static async discoverContacts(companyId) {
    try {
      const company = dbHelpers.getCompanyById.get(companyId);
      if (!company) throw new Error('Company not found');

      logger.info(`Discovering contacts for ${company.name}...`);
      
      const contacts = await ContactDiscoveryService.findContacts(
        company.name,
        company.domain
      );

      let added = 0;
      for (const contact of contacts) {
        // Filter for relevant titles
        const relevantTitles = /CEO|VP|Director|Head|Chief|President|Executive/i;
        if (!relevantTitles.test(contact.title || '')) continue;

        dbHelpers.upsertContact.run(
          companyId,
          contact.name,
          contact.title,
          contact.department,
          contact.seniorityLevel,
          contact.email,
          0, // email_verified
          contact.phone,
          contact.linkedin,
          null, // twitter_handle
          null, // bio
          contact.source,
          contact.confidence,
          null // last_verified
        );
        added++;
      }

      logger.info(`Added ${added} contacts for ${company.name}`);
      return { added };
    } catch (error) {
      logger.error('Contact discovery error:', error);
      throw error;
    }
  }
}

// ===========================
// API ENDPOINTS
// ===========================

// Health check
app.get('/api/health', (req, res) => {
  const stats = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: {
      companies: db.prepare('SELECT COUNT(*) as count FROM companies').get().count,
      trials: db.prepare('SELECT COUNT(*) as count FROM trials').get().count,
      molecules: db.prepare('SELECT COUNT(*) as count FROM molecules').get().count,
      patents: db.prepare('SELECT COUNT(*) as count FROM patents').get().count,
      signals: db.prepare('SELECT COUNT(*) as count FROM signals').get().count,
      contacts: db.prepare('SELECT COUNT(*) as count FROM contacts').get().count
    }
  };
  res.json(stats);
});

// Ingest clinical trials
app.post('/api/ingest/clinical-trials', async (req, res) => {
  try {
    const schema = z.object({
      country: z.string().optional(),
      sinceDays: z.number().optional().default(180),
      maxResults: z.number().optional().default(500)
    });
    
    const options = schema.parse(req.body);
    const result = await DataIngestionOrchestrator.ingestClinicalTrials(options);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Clinical trials endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Ingest FDA data
app.post('/api/ingest/fda', async (req, res) => {
  try {
    const result = await DataIngestionOrchestrator.ingestFDAData();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('FDA endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Ingest patents
app.post('/api/ingest/patents', async (req, res) => {
  try {
    const schema = z.object({
      query: z.string().optional().default('IND enabling manufacturing'),
      assignee: z.string().optional(),
      sinceDays: z.number().optional().default(365)
    });
    
    const options = schema.parse(req.body);
    const result = await DataIngestionOrchestrator.ingestPatents(options);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Patents endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enrich molecules
app.post('/api/enrich/molecules', async (req, res) => {
  try {
    const result = await DataIngestionOrchestrator.enrichMolecules();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Molecule enrichment endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Discover contacts for a company
app.post('/api/contacts/discover/:companyId', async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const result = await DataIngestionOrchestrator.discoverContacts(companyId);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Contact discovery endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rescore all companies
app.post('/api/rescore', async (req, res) => {
  try {
    const results = await CDMOScoringEngine.rescoreAllCompanies();
    res.json({ success: true, rescored: results.length, results });
  } catch (error) {
    logger.error('Rescoring endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get leads with filtering and pagination
app.get('/api/leads', (req, res) => {
  try {
    const schema = z.object({
      page: z.coerce.number().optional().default(1),
      pageSize: z.coerce.number().optional().default(25),
      minScore: z.coerce.number().optional(),
      priorityTier: z.string().optional(),
      hasPhase1: z.coerce.boolean().optional(),
      needsCDMO: z.coerce.boolean().optional(),
      excludeStale: z.coerce.boolean().optional().default(true),
      search: z.string().optional(),
      sortBy: z.enum(['score', 'date', 'name']).optional().default('score')
    });

    const params = schema.parse(req.query);
    const offset = (params.page - 1) * params.pageSize;

    let whereClauses = ['1=1'];
    let queryParams = [];

    if (params.minScore !== undefined) {
      whereClauses.push('s.overall_score >= ?');
      queryParams.push(params.minScore);
    }

    if (params.priorityTier) {
      whereClauses.push('s.priority_tier = ?');
      queryParams.push(params.priorityTier);
    }

    if (params.needsCDMO !== undefined) {
      whereClauses.push('s.needs_cdmo = ?');
      queryParams.push(params.needsCDMO ? 1 : 0);
    }

    if (params.excludeStale) {
      whereClauses.push('(s.is_stale IS NULL OR s.is_stale = 0)');
    }

    if (params.search) {
      whereClauses.push('c.name LIKE ?');
      queryParams.push(`%${params.search}%`);
    }

    const orderBy = {
      score: 'COALESCE(s.overall_score, 0) DESC',
      date: 'c.updated_at DESC',
      name: 'c.name ASC'
    }[params.sortBy];

    const query = `
      SELECT 
        c.*,
        s.overall_score,
        s.priority_tier,
        s.phase1_readiness_score,
        s.funding_score,
        s.outsourcing_likelihood_score,
        s.molecule_quality_score,
        s.timing_score,
        s.can_pay,
        s.needs_cdmo,
        s.is_stale,
        (SELECT COUNT(*) FROM trials t WHERE t.company_id = c.id AND t.phase LIKE '%Phase 1%') as phase1_count,
        (SELECT COUNT(*) FROM molecules m WHERE m.company_id = c.id) as molecule_count,
        (SELECT MAX(date) FROM funding f WHERE f.company_id = c.id) as last_funding_date,
        (SELECT SUM(amount_usd) FROM funding f WHERE f.company_id = c.id) as total_funding
      FROM companies c
      LEFT JOIN scores s ON s.company_id = c.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const leads = db.prepare(query).all(...queryParams, params.pageSize, offset);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM companies c
      LEFT JOIN scores s ON s.company_id = c.id
      WHERE ${whereClauses.join(' AND ')}
    `;
    const { total } = db.prepare(countQuery).get(...queryParams);

    res.json({
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
      leads
    });
  } catch (error) {
    logger.error('Get leads endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get detailed company information
app.get('/api/leads/:id', (req, res) => {
  try {
    const companyId = parseInt(req.params.id);
    const company = dbHelpers.getCompanyById.get(companyId);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const details = {
      company,
      score: db.prepare('SELECT * FROM scores WHERE company_id = ?').get(companyId),
      molecules: db.prepare('SELECT * FROM molecules WHERE company_id = ?').all(companyId),
      trials: db.prepare('SELECT * FROM trials WHERE company_id = ? ORDER BY start_date DESC').all(companyId),
      funding: db.prepare('SELECT * FROM funding WHERE company_id = ? ORDER BY date DESC').all(companyId),
      patents: db.prepare('SELECT * FROM patents WHERE company_id = ? ORDER BY filing_date DESC LIMIT 10').all(companyId),
      signals: db.prepare('SELECT * FROM signals WHERE company_id = ? ORDER BY date DESC LIMIT 20').all(companyId),
      contacts: db.prepare('SELECT * FROM contacts WHERE company_id = ?').all(companyId),
      jobPostings: db.prepare('SELECT * FROM job_postings WHERE company_id = ? ORDER BY posted_date DESC LIMIT 10').all(companyId),
      conferences: db.prepare('SELECT * FROM conference_presentations WHERE company_id = ? ORDER BY presentation_date DESC').all(companyId)
    };

    res.json(details);
  } catch (error) {
    logger.error('Get company details error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add manual funding entry
app.post('/api/funding', (req, res) => {
  try {
    const schema = z.object({
      companyName: z.string(),
      roundType: z.string(),
      amountUsd: z.number().optional(),
      date: z.string(),
      investors: z.string().optional(),
      leadInvestor: z.string().optional(),
      source: z.string().optional().default('manual'),
      pressReleaseUrl: z.string().optional()
    });

    const data = schema.parse(req.body);
    
    // Create or get company
    const companyResult = dbHelpers.upsertCompany.run({
      name: data.companyName,
      domain: null,
      country: null,
      employee_count: null,
      employee_band: null,
      founded_year: null,
      headquarters: null,
      description: null,
      industry_codes: null,
      has_internal_gmp: null,
      outsourcing_probability: null
    });

    // Add funding
    dbHelpers.insertFunding.run(
      companyResult.id,
      data.roundType,
      data.amountUsd,
      data.date,
      data.investors,
      data.leadInvestor,
      data.source,
      data.pressReleaseUrl
    );

    // Add signal
    dbHelpers.insertSignal.run(
      companyResult.id,
      'funding',
      'strong',
      data.source,
      data.pressReleaseUrl,
      data.date,
      `${data.roundType} funding round`,
      `Amount: $${data.amountUsd?.toLocaleString() || 'undisclosed'}`,
      0.9
    );

    // Recalculate score
    CDMOScoringEngine.calculateScore(companyResult.id);

    res.json({ success: true, companyId: companyResult.id });
  } catch (error) {
    logger.error('Add funding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add manual signal
app.post('/api/signals', (req, res) => {
  try {
    const schema = z.object({
      companyName: z.string(),
      signalType: z.enum(['ind', 'clinical_trial', 'patent', 'funding', 'hiring', 'conference', 'press', 'cdmo', 'other']),
      signalStrength: z.enum(['weak', 'medium', 'strong']),
      source: z.string(),
      url: z.string().optional(),
      date: z.string(),
      title: z.string(),
      content: z.string().optional(),
      relevanceScore: z.number().min(0).max(1).optional().default(0.5)
    });

    const data = schema.parse(req.body);
    
    // Create or get company
    const companyResult = dbHelpers.upsertCompany.run({
      name: data.companyName,
      domain: null,
      country: null,
      employee_count: null,
      employee_band: null,
      founded_year: null,
      headquarters: null,
      description: null,
      industry_codes: null,
      has_internal_gmp: null,
      outsourcing_probability: null
    });

    // Add signal
    dbHelpers.insertSignal.run(
      companyResult.id,
      data.signalType,
      data.signalStrength,
      data.source,
      data.url,
      data.date,
      data.title,
      data.content,
      data.relevanceScore
    );

    // Recalculate score
    CDMOScoringEngine.calculateScore(companyResult.id);

    res.json({ success: true, companyId: companyResult.id });
  } catch (error) {
    logger.error('Add signal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk import from CSV
app.post('/api/import/csv', express.raw({ type: 'text/csv', limit: '10mb' }), async (req, res) => {
  try {
    const csvData = req.body.toString();
    const lines = csvData.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    let imported = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length !== headers.length) continue;
      
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx];
      });
      
      if (!row.company_name) continue;
      
      // Create company
      const companyResult = dbHelpers.upsertCompany.run({
        name: row.company_name,
        domain: row.domain || null,
        country: row.country || null,
        employee_count: row.employee_count ? parseInt(row.employee_count) : null,
        employee_band: null,
        founded_year: row.founded_year ? parseInt(row.founded_year) : null,
        headquarters: row.headquarters || null,
        description: row.description || null,
        industry_codes: null,
        has_internal_gmp: null,
        outsourcing_probability: null
      });
      
      // Add molecule if provided
      if (row.molecule_name) {
        dbHelpers.upsertMolecule.run({
          company_id: companyResult.id,
          name: row.molecule_name,
          pubchem_cid: null,
          chembl_id: null,
          target: row.target || null,
          target_class: null,
          mechanism_of_action: row.moa || null,
          modality: row.modality || null,
          indication: row.indication || null,
          therapeutic_area: row.therapeutic_area || null,
          development_stage: row.stage || 'Phase 1',
          structure_available: 0,
          process_chemistry_complexity: null
        });
      }
      
      imported++;
    }
    
    res.json({ success: true, imported });
  } catch (error) {
    logger.error('CSV import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export leads to CSV
app.get('/api/export/leads', (req, res) => {
  try {
    const leads = db.prepare(`
      SELECT 
        c.name as company_name,
        c.domain,
        c.country,
        c.employee_count,
        c.employee_band,
        s.overall_score,
        s.priority_tier,
        s.can_pay,
        s.needs_cdmo,
        s.is_stale,
        (SELECT GROUP_CONCAT(name, '; ') FROM molecules WHERE company_id = c.id) as molecules,
        (SELECT COUNT(*) FROM trials WHERE company_id = c.id AND phase LIKE '%Phase 1%') as phase1_trials,
        (SELECT MAX(date) FROM funding WHERE company_id = c.id) as last_funding,
        (SELECT GROUP_CONCAT(DISTINCT name || ' (' || title || ')' || COALESCE(' - ' || email, ''), '; ') 
         FROM contacts WHERE company_id = c.id AND title LIKE '%VP%' OR title LIKE '%Director%' OR title LIKE '%CEO%') as key_contacts
      FROM companies c
      LEFT JOIN scores s ON s.company_id = c.id
      WHERE s.overall_score > 0
      ORDER BY s.overall_score DESC
    `).all();

    const csv = [
      'Company,Domain,Country,Employees,Score,Tier,Can Pay,Needs CDMO,Molecules,Phase 1 Trials,Last Funding,Key Contacts',
      ...leads.map(l => [
        l.company_name,
        l.domain || '',
        l.country || '',
        l.employee_count || l.employee_band || '',
        l.overall_score || 0,
        l.priority_tier || '',
        l.can_pay ? 'Yes' : 'No',
        l.needs_cdmo ? 'Yes' : 'No',
        l.molecules || '',
        l.phase1_trials || 0,
        l.last_funding || '',
        l.key_contacts || ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cdmo_leads_export.csv"');
    res.send(csv);
  } catch (error) {
    logger.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Dashboard statistics
app.get('/api/stats/dashboard', (req, res) => {
  try {
    const stats = {
      overview: {
        totalCompanies: db.prepare('SELECT COUNT(*) as count FROM companies').get().count,
        scoredCompanies: db.prepare('SELECT COUNT(*) as count FROM scores').get().count,
        tierACompanies: db.prepare("SELECT COUNT(*) as count FROM scores WHERE priority_tier = 'A'").get().count,
        tierBCompanies: db.prepare("SELECT COUNT(*) as count FROM scores WHERE priority_tier = 'B'").get().count,
        companiesNeedingCDMO: db.prepare('SELECT COUNT(*) as count FROM scores WHERE needs_cdmo = 1').get().count,
        staleCompanies: db.prepare('SELECT COUNT(*) as count FROM scores WHERE is_stale = 1').get().count
      },
      trials: {
        totalTrials: db.prepare('SELECT COUNT(*) as count FROM trials').get().count,
        phase1Trials: db.prepare("SELECT COUNT(*) as count FROM trials WHERE phase LIKE '%Phase 1%'").get().count,
        notYetRecruiting: db.prepare("SELECT COUNT(*) as count FROM trials WHERE status = 'Not yet recruiting'").get().count,
        recruiting: db.prepare("SELECT COUNT(*) as count FROM trials WHERE status = 'Recruiting'").get().count
      },
      molecules: {
        total: db.prepare('SELECT COUNT(*) as count FROM molecules').get().count,
        withStructure: db.prepare('SELECT COUNT(*) as count FROM molecules WHERE structure_available = 1').get().count,
        withPubChem: db.prepare('SELECT COUNT(*) as count FROM molecules WHERE pubchem_cid IS NOT NULL').get().count
      },
      funding: {
        companiesWithFunding: db.prepare('SELECT COUNT(DISTINCT company_id) as count FROM funding').get().count,
        recentFunding: db.prepare(`
          SELECT COUNT(DISTINCT company_id) as count 
          FROM funding 
          WHERE date >= date('now', '-18 months')
        `).get().count,
        totalRaised: db.prepare('SELECT SUM(amount_usd) as total FROM funding').get().total || 0
      },
      patents: {
        total: db.prepare('SELECT COUNT(*) as count FROM patents').get().count,
        processChemistry: db.prepare('SELECT COUNT(*) as count FROM patents WHERE process_chemistry_relevant = 1').get().count,
        recentFilings: db.prepare(`
          SELECT COUNT(*) as count 
          FROM patents 
          WHERE filing_date >= date('now', '-12 months')
        `).get().count
      },
      contacts: {
        total: db.prepare('SELECT COUNT(*) as count FROM contacts').get().count,
        executives: db.prepare("SELECT COUNT(*) as count FROM contacts WHERE title LIKE '%CEO%' OR title LIKE '%VP%' OR title LIKE '%Director%'").get().count,
        withEmail: db.prepare('SELECT COUNT(*) as count FROM contacts WHERE email IS NOT NULL').get().count
      },
      signals: {
        total: db.prepare('SELECT COUNT(*) as count FROM signals').get().count,
        byType: db.prepare(`
          SELECT signal_type, COUNT(*) as count 
          FROM signals 
          GROUP BY signal_type
        `).all()
      },
      recentActivity: {
        last7Days: {
          companies: db.prepare(`
            SELECT COUNT(*) as count 
            FROM companies 
            WHERE created_at >= date('now', '-7 days')
          `).get().count,
          trials: db.prepare(`
            SELECT COUNT(*) as count 
            FROM trials 
            WHERE created_at >= date('now', '-7 days')
          `).get().count,
          signals: db.prepare(`
            SELECT COUNT(*) as count 
            FROM signals 
            WHERE created_at >= date('now', '-7 days')
          `).get().count
        }
      },
      topCompanies: db.prepare(`
        SELECT 
          c.name,
          s.overall_score,
          s.priority_tier,
          (SELECT COUNT(*) FROM molecules WHERE company_id = c.id) as molecule_count,
          (SELECT MAX(date) FROM funding WHERE company_id = c.id) as last_funding
        FROM companies c
        JOIN scores s ON s.company_id = c.id
        ORDER BY s.overall_score DESC
        LIMIT 10
      `).all()
    };

    res.json(stats);
  } catch (error) {
    logger.error('Dashboard stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Trigger full data refresh
app.post('/api/refresh/all', async (req, res) => {
  try {
    logger.info('Starting full data refresh...');
    
    const results = {
      clinicalTrials: await DataIngestionOrchestrator.ingestClinicalTrials({ maxResults: 200 }),
      fdaData: await DataIngestionOrchestrator.ingestFDAData(),
      patents: await DataIngestionOrchestrator.ingestPatents({ sinceDays: 180 }),
      molecules: await DataIngestionOrchestrator.enrichMolecules(),
      scores: await CDMOScoringEngine.rescoreAllCompanies()
    };

    res.json({ success: true, results });
  } catch (error) {
    logger.error('Full refresh error:', error);
    res.status(500).json({ error: error.message });
  }
});
// Add these API endpoints:
app.post('/api/discovery/pubchem', async (req, res) => {
  try {
    const results = await prePhase1.discoverNewPubChemSubstances(req.body);
    res.json({ success: true, discovered: results.length, results });
  } catch (error) {
    logger.error('PubChem discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/discovery/patents', async (req, res) => {
  try {
    const results = await prePhase1.discoverEarlyPatents(req.body);
    res.json({ success: true, discovered: results.length, results });
  } catch (error) {
    logger.error('Patent discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/discovery/grants', async (req, res) => {
  try {
    const results = await prePhase1.discoverNIHGrants(req.body);
    res.json({ success: true, discovered: results.length, results });
  } catch (error) {
    logger.error('Grant discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/discovery/publications', async (req, res) => {
  try {
    const results = await prePhase1.discoverPubMedPublications(req.body);
    res.json({ success: true, discovered: results.length, results });
  } catch (error) {
    logger.error('Publication discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/discovery/press', async (req, res) => {
  try {
    const results = await prePhase1.discoverPressReleases(req.body);
    res.json({ success: true, discovered: results.length, results });
  } catch (error) {
    logger.error('Press discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/discovery/comprehensive', async (req, res) => {
  try {
    const results = await prePhase1.runComprehensiveDiscovery();
    res.json({ success: true, ...results });
  } catch (error) {
    logger.error('Comprehensive discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/discovery/stats', async (req, res) => {
  try {
    const stats = {
      preclinicalCompounds: db.prepare('SELECT COUNT(*) as count FROM preclinical_compounds').get().count,
      grants: db.prepare('SELECT COUNT(*) as count FROM grants').get().count,
      publications: db.prepare('SELECT COUNT(*) as count FROM publications').get().count,
      newsItems: db.prepare('SELECT COUNT(*) as count FROM news_mentions').get().count,
      recentSignals: db.prepare("SELECT COUNT(*) as count FROM signals WHERE date >= date('now', '-7 days')").get().count,
      patents: db.prepare('SELECT COUNT(*) as count FROM patents WHERE process_chemistry_relevant = 1').get().count
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add scheduled job:
cron.schedule('0 4 * * *', async () => {
  logger.info('Starting scheduled pre-Phase 1 discovery...');
  try {
    await prePhase1.runComprehensiveDiscovery();
    logger.info('Pre-Phase 1 discovery completed');
  } catch (error) {
    logger.error('Pre-Phase 1 discovery failed:', error);
  }
});
// ===========================
// SCHEDULED JOBS
// ===========================

// Daily ingestion at 2 AM
cron.schedule('0 2 * * *', async () => {
  logger.info('Starting scheduled daily ingestion...');
  try {
    await DataIngestionOrchestrator.ingestClinicalTrials({ maxResults: 10, sinceDays: 7 });
    await DataIngestionOrchestrator.ingestFDAData();
    await CDMOScoringEngine.rescoreAllCompanies();
    logger.info('Daily ingestion completed successfully');
  } catch (error) {
    logger.error('Daily ingestion failed:', error);
  }
});

// Weekly comprehensive update on Sundays at 3 AM
cron.schedule('0 3 * * 0', async () => {
  logger.info('Starting scheduled weekly comprehensive update...');
  try {
    await DataIngestionOrchestrator.ingestClinicalTrials({ maxResults: 500, sinceDays: 30 });
    await DataIngestionOrchestrator.ingestFDAData();
    await DataIngestionOrchestrator.ingestPatents({ sinceDays: 90 });
    await DataIngestionOrchestrator.enrichMolecules();
    
    // Discover contacts for top companies without contacts
    const topCompaniesWithoutContacts = db.prepare(`
      SELECT c.id 
      FROM companies c
      JOIN scores s ON s.company_id = c.id
      LEFT JOIN contacts ct ON ct.company_id = c.id
      WHERE ct.id IS NULL
      ORDER BY s.overall_score DESC
      LIMIT 20
    `).all();

    for (const company of topCompaniesWithoutContacts) {
      await DataIngestionOrchestrator.discoverContacts(company.id);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
    }

    await CDMOScoringEngine.rescoreAllCompanies();
    logger.info('Weekly comprehensive update completed successfully');
  } catch (error) {
    logger.error('Weekly update failed:', error);
  }
});

// ===========================
// WEBHOOK ENDPOINTS (for external integrations)
// ===========================
// --- Discovery API Routes ---
// app.get('/api/discovery/compounds', async (req, res) => {
//   try {
//     const results = await prePhase1.discoverNewPubChemSubstances({ days: 7, limit: 10 });
//     res.json({ compounds: results });
//   } catch (err) {
//     logger.error('Error in /api/discovery/compounds', err);
//     res.status(500).json({ error: 'Failed to fetch compounds' });
//   }
// });

// server.js  — REPLACE the existing GET /api/discovery/compounds route with this
app.get('/api/discovery/compounds', (req, res) => {
  try {
    const { days, source } = req.query;

    const clauses = [];
    const params = {};

    if (days) {
      clauses.push("date(pc.created_at) >= date('now', ?)");
      params['-?'] = `-${parseInt(days, 10)} days`; // placeholder handled below
    }
    if (source) {
      clauses.push("pc.source = @source");
      params.source = source;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      SELECT
        pc.substance_id            AS substance_id,
        pc.compound_cid            AS compound_cid,
        pc.depositor_name          AS depositor_name,
        pc.submission_date         AS submission_date,
        pc.stage                   AS stage,
        pc.source                  AS source,
        c.name                     AS companyName
      FROM preclinical_compounds pc
      LEFT JOIN companies c ON c.id = pc.company_id
      ${where}
      ORDER BY datetime(pc.created_at) DESC
      LIMIT 500
    `;

    // better-sqlite3 binds unnamed params positionally; handle the single "-X days" if present
    const stmt = db.prepare(sql);
    const rows = ('-?' in params)
      ? stmt.all(params['-?'], params.source ?? undefined)
      : stmt.all(params);

    res.json(rows);
  } catch (err) {
    logger.error('Error listing compounds from DB:', err);
    res.status(500).json({ error: 'Failed to load compounds from database' });
  }
});


app.get('/api/discovery/patents', async (req, res) => {
  try {
    const results = await prePhase1.discoverEarlyPatents({ days: 30 });
    res.json({ patents: results });
  } catch (err) {
    logger.error('Error in /api/discovery/patents', err);
    res.status(500).json({ error: 'Failed to fetch patents' });
  }
});

app.get('/api/discovery/grants', async (req, res) => {
  try {
    const results = await prePhase1.discoverNIHGrants({});
    res.json({ grants: results });
  } catch (err) {
    logger.error('Error in /api/discovery/grants', err);
    res.status(500).json({ error: 'Failed to fetch grants' });
  }
});

// Webhook for real-time clinical trial updates
app.post('/api/webhook/clinical-trial', async (req, res) => {
  try {
    const schema = z.object({
      source: z.string(),
      trialId: z.string(),
      sponsor: z.string(),
      phase: z.string(),
      status: z.string(),
      molecule: z.string().optional(),
      indication: z.string().optional(),
      startDate: z.string().optional()
    });

    const data = schema.parse(req.body);
    
    // Process the webhook data
    const companyResult = dbHelpers.upsertCompany.run({
      name: data.sponsor,
      domain: null,
      country: null,
      employee_count: null,
      employee_band: null,
      founded_year: null,
      headquarters: null,
      description: null,
      industry_codes: null,
      has_internal_gmp: null,
      outsourcing_probability: null
    });

    // Add trial
    dbHelpers.upsertTrial.run({
      company_id: companyResult.id,
      molecule_id: null,
      registry: data.source,
      trial_id: data.trialId,
      phase: data.phase,
      status: data.status,
      title: null,
      start_date: data.startDate,
      completion_date: null,
      first_posted: new Date().toISOString(),
      last_update: new Date().toISOString(),
      enrollment: null,
      locations: null,
      has_us_sites: 0,
      has_eu_sites: 0,
      sponsor_type: null,
      collaborators: null
    });

    // Add signal
    dbHelpers.insertSignal.run(
      companyResult.id,
      'clinical_trial',
      'strong',
      'webhook',
      null,
      new Date().toISOString(),
      `New ${data.phase} trial: ${data.status}`,
      `Trial ID: ${data.trialId}, Indication: ${data.indication || 'N/A'}`,
      0.95
    );

    // Recalculate score
    CDMOScoringEngine.calculateScore(companyResult.id);

    res.json({ success: true, companyId: companyResult.id });
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/trials/new
// GET /api/trials/new
app.get('/api/trials/new', async (req, res) => {
  try {
    const {
      sinceDays = '60',
      maxResults = '200',
      country,
      // query flags (strings -> booleans)
      earlyPhaseOnly = 'true',
      fihHeuristic = 'true',
      includeOncology = 'false'
    } = req.query;

    // Map your query params to the options your fetcher expects.
    // (Adjust names here if your ClinicalTrialsAPI uses different keys.)
    const options = {
      sinceDays: Number(sinceDays),
      maxResults: Number(maxResults),
      country: country || null,
      // If your fetcher expects 'earlyPhaseOnly' & 'firstInHumanHeuristic', map them:
      earlyPhaseOnly: earlyPhaseOnly === 'true' || earlyPhaseOnly === true,
      firstInHumanHeuristic: fihHeuristic === 'true' || fihHeuristic === true,
      // If your fetcher uses 'includeOncology' to flip the NOT cancer filter:
      includeOncology: includeOncology === 'true' || includeOncology === true
    };

    const trials = await ClinicalTrialsAPI.fetchPhase1Trials(options);

    // Minimal, *optional* post-filter:
    // Keep Early Phase 1 OR anything with FIH hints to avoid filtering everything out.
    const fihHints = /(first[- ]?in[- ]?human|^fih\b|single ascending dose|sad|multiple ascending dose|mad)/i;

    const filtered = trials.filter(t => {
      const phase = (t.phase || '');
      const text = `${t.title || ''} ${t.briefTitle || ''}`;
      const isEarly = /early phase 1/i.test(phase);
      const hasHint = fihHints.test(text);
      if (options.earlyPhaseOnly && options.firstInHumanHeuristic) return isEarly || hasHint;
      if (options.earlyPhaseOnly) return isEarly;
      if (options.firstInHumanHeuristic) return hasHint;
      return true;
    });

    // Small debug sample to help you see what was filtered
    const sample = trials.slice(0, 5).map(t => ({
      nctId: t.trialId,
      phase: t.phase,
      title: t.title
    }));

    res.json({
      success: true,
      meta: options,
      count: filtered.length,
      filtered: filtered,
      debug: {
        fetchedCount: trials.length,
        sample
      }
    });
  } catch (err) {
    logger.error('Error fetching new trials:', err);
    res.status(500).json({ error: err.message });
  }
});




// ===========================
// ERROR HANDLING
// ===========================

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ===========================
// SERVER STARTUP
// ===========================

const PORT = process.env.PORT || 5050;

const server = app.listen(PORT, () => {
  logger.info(`🚀 CDMO Lead Discovery Engine running on port ${PORT}`);
  logger.info(`📊 Dashboard: http://localhost:${PORT}/`);
  logger.info(`🔧 API Docs: http://localhost:${PORT}/api/health`);
  
  // Run initial data fetch on startup if database is empty
  const companyCount = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
  if (companyCount === 0) {
    logger.info('Empty database detected. Starting initial data ingestion...');
    DataIngestionOrchestrator.ingestClinicalTrials({ maxResults: 10 })
      .then(() => logger.info('Initial data ingestion completed'))
      .catch(err => logger.error('Initial ingestion failed:', err));
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    db.close();
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    db.close();
    logger.info('Server closed');
    process.exit(0);
  });
});

// ===========================
// PACKAGE.JSON REQUIREMENTS
// ===========================
/*
{
  "name": "cdmo-lead-discovery-engine",
  "version": "2.0.0",
  "description": "Enterprise-grade lead discovery system for CDMO business development",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest",
    "migrate": "node migrations/run.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^9.2.2",
    "axios": "^1.6.5",
    "node-cron": "^3.0.3",
    "cors": "^2.8.5",
    "zod": "^3.22.4",
    "dayjs": "^1.11.10",
    "winston": "^3.11.0",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "jest": "^29.7.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
*/

// ===========================
// ENVIRONMENT VARIABLES (.env)
// ===========================
/*
# Server Configuration
PORT=5050
NODE_ENV=production
LOG_LEVEL=info
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# API Keys (optional but recommended)
CRUNCHBASE_API_KEY=your_key_here
CLEARBIT_API_KEY=your_key_here
HUNTER_API_KEY=your_key_here
APOLLO_API_KEY=your_key_here
ROCKETREACH_API_KEY=your_key_here

# Patent APIs
EPO_OPS_KEY=your_key_here

# Database
DB_PATH=cdmo_leads.db

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
*/

module.exports = app;