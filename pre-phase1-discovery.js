// pre-phase1-discovery.js - Pre-Clinical & Early Discovery Module for CDMO Lead Engine
// This module adds comprehensive pre-Phase 1 signal detection

const axios = require('axios');
const xml2js = require('xml2js');
const { parseString } = require('xml2js');
const promisify = require('util').promisify;
const parseXml = promisify(parseString);

// ===========================
// PRE-PHASE 1 DISCOVERY MODULE
// ===========================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class PrePhase1Discovery {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger;
    this.setupDatabase();
  }

  // Enhanced database schema for pre-clinical tracking
  setupDatabase() {
    this.db.exec(`
      -- Pre-clinical compounds table
      CREATE TABLE IF NOT EXISTS preclinical_compounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        substance_id TEXT,
        compound_cid TEXT,
        inchi_key TEXT,
        smiles TEXT,
        depositor_name TEXT,
        submission_date TEXT,
        source TEXT,
        stage TEXT DEFAULT 'discovery',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
      );

      -- Grant tracking
      CREATE TABLE IF NOT EXISTS grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        grant_id TEXT UNIQUE,
        agency TEXT,
        title TEXT,
        abstract TEXT,
        amount REAL,
        start_date TEXT,
        end_date TEXT,
        pi_name TEXT,
        keywords TEXT,
        source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
      );

      -- Tech transfer opportunities
      CREATE TABLE IF NOT EXISTS tech_transfer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        university TEXT,
        technology_id TEXT,
        title TEXT,
        description TEXT,
        status TEXT,
        licensing_contact TEXT,
        patent_numbers TEXT,
        molecule_info TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Publications tracking
      CREATE TABLE IF NOT EXISTS publications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        pmid TEXT UNIQUE,
        doi TEXT,
        title TEXT,
        abstract TEXT,
        authors TEXT,
        affiliations TEXT,
        publication_date TEXT,
        journal TEXT,
        compounds_mentioned TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
      );

      -- News and press monitoring
      CREATE TABLE IF NOT EXISTS news_mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        title TEXT,
        url TEXT,
        source TEXT,
        published_date TEXT,
        content_snippet TEXT,
        signal_keywords TEXT,
        relevance_score REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_preclinical_depositor ON preclinical_compounds(depositor_name);
      CREATE INDEX IF NOT EXISTS idx_grants_agency ON grants(agency);
      CREATE INDEX IF NOT EXISTS idx_publications_date ON publications(publication_date DESC);
    `);
  }

  // ============= PUBCHEM DISCOVERY =============
//   async discoverNewPubChemSubstances(options = {}) {
//     const { days = 7, limit = 500 } = options;
    
//     try {
//       this.logger.info('Discovering new PubChem substances...');
      
//       // Get recently modified substances using E-utilities
//       const dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
//         .toISOString().split('T')[0].replace(/-/g, '/');
      
//       const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
//       const searchParams = {
//         db: 'pcsubstance',
//         term: `${dateFilter}[MDAT]:3000[MDAT]`, // Modified date range
//         retmax: limit,
//         retmode: 'json',
//         sort: 'date',
//         usehistory: 'y'
//       };

//       const searchResponse = await axios.get(searchUrl, { params: searchParams });
//       const sidListraw = searchResponse.data.esearchresult?.idlist || [];
//       const sidList = sidListraw.slice(0, 5); // only use first 5

//       this.logger.info(`Found ${sidList.length} new PubChem substances`);

//       const newCompounds = [];
      
//       // Fetch details for each SID in batches
//       const batchSize = 1;
//       for (let i = 0; i < sidList.length; i += batchSize) {
//         const batch = sidList.slice(i, i + batchSize);
//         const substances = await this.fetchPubChemSubstanceDetails(batch);
        
//         for (const substance of substances) {
//           // Extract depositor and map to company
//           const depositor = substance.depositor_name;
//           const company = await this.resolveCompanyFromDepositor(depositor);
          
//           if (company) {
//             // Store the preclinical compound
//             this.db.prepare(`
//               INSERT OR IGNORE INTO preclinical_compounds 
//               (company_id, substance_id, compound_cid, depositor_name, submission_date, source, stage)
//               VALUES (?, ?, ?, ?, ?, 'PubChem', 'discovery')
//             `).run(
//               company.id,
//               substance.sid,
//               substance.cid,
//               depositor,
//               substance.submission_date
//             );

//             // Add as signal
//             this.db.prepare(`
//               INSERT INTO signals 
//               (company_id, signal_type, signal_strength, source, url, date, title, content, relevance_score)
//               VALUES (?, 'new_compound', 'medium', 'PubChem', ?, ?, ?, ?, 0.6)
//             `).run(
//               company.id,
//               `https://pubchem.ncbi.nlm.nih.gov/substance/${substance.sid}`,
//               substance.submission_date,
//               `New substance: ${substance.sid}`,
//               `Depositor: ${depositor}, CID: ${substance.cid || 'pending'}`
//             );

//             newCompounds.push({ company: company.name, substance });
//           }
//         }
        
//         // Rate limiting
//         await sleep(1000)
//         await new Promise(resolve => setTimeout(resolve, 500));
//       }

//       return newCompounds;
//     } catch (error) {
//       this.logger.error('Error discovering PubChem substances:', error);
//       return [];
//     }
//   }
async discoverNewPubChemSubstances(options = {}) {
  const { days = 7, limit = 500 } = options;
  
  const results = {
    searched: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    errors: [],
    compounds: [],
    rawData: []  // Store ALL data we get
  };
  
  try {
    this.logger.info('Discovering new PubChem substances...');
    
    // Get recently modified substances using E-utilities
    const dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0].replace(/-/g, '/');
    
    // NCBI E-utilities (different from PubChem REST) - has separate rate limits
    const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
    const searchParams = {
      db: 'pcsubstance',
      term: `${dateFilter}[MDAT]:3000[MDAT]`, // Modified date range
      retmax: Math.min(limit, 20), // Limit initial search
      retmode: 'json',
      sort: 'date'
    };

    // Add NCBI API key if available (increases rate limit from 3/sec to 10/sec)
    if (process.env.NCBI_API_KEY) {
      searchParams.api_key = process.env.NCBI_API_KEY;
    }

    const searchResponse = await axios.get(searchUrl, { params: searchParams });
    const sidListraw = searchResponse.data.esearchresult?.idlist || [];
    const sidList = sidListraw.slice(0, 5); // Process 5 for now
    
    results.searched = sidListraw.length;
    results.processed = sidList.length;

    this.logger.info(`Processing ${sidList.length} PubChem substances (of ${sidListraw.length} found)`);
    this.logger.info(`SIDs to process: ${sidList.join(', ')}`);

    // CRITICAL: Add initial delay to avoid immediate rate limiting
    await this.delay(3000); // 3 second initial delay
    
    // Process each SID individually with very conservative rate limiting
    for (let i = 0; i < sidList.length; i++) {
      const sid = sidList[i];
      
      try {
        this.logger.info(`Processing SID ${sid} (${i + 1}/${sidList.length})...`);
        
        // Try alternative approach: Use E-utilities efetch instead of PUG REST
        const substance = await this.fetchSubstanceViaEutils(sid);
        
        if (substance) {
          // Store raw data regardless
          results.rawData.push({
            sid,
            data: substance,
            status: 'fetched',
            timestamp: new Date().toISOString()
          });
          
          this.logger.info(`Fetched data for SID ${sid}:`, JSON.stringify(substance, null, 2));
          
          // Extract depositor and map to company
          const depositor = substance.depositor_name;
          
          if (!depositor || depositor === 'Unknown') {
            this.logger.warn(`No depositor found for SID ${sid}`);
            results.compounds.push({
              sid,
              status: 'no_depositor',
              substance
            });
            continue;
          }
          
          const company = await this.resolveCompanyFromDepositor(depositor);
          
          if (company) {
            this.logger.info(`Mapped depositor "${depositor}" to company "${company.name}" (ID: ${company.id})`);
            
            // Check if we already have this substance to avoid duplicates
            const existing = this.db.prepare(
              'SELECT id FROM preclinical_compounds WHERE substance_id = ?'
            ).get(substance.sid);
            
            if (!existing) {
              // Store the preclinical compound
              this.db.prepare(`
                INSERT INTO preclinical_compounds 
                (company_id, substance_id, compound_cid, depositor_name, submission_date, source, stage)
                VALUES (?, ?, ?, ?, ?, 'PubChem', 'discovery')
              `).run(
                company.id,
                substance.sid,
                substance.cid,
                depositor,
                substance.submission_date
              );

              // Add as signal
              this.db.prepare(`
                INSERT INTO signals 
                (company_id, signal_type, signal_strength, source, url, date, title, content, relevance_score)
                VALUES (?, 'new_compound', 'medium', 'PubChem', ?, ?, ?, ?, 0.6)
              `).run(
                company.id,
                `https://pubchem.ncbi.nlm.nih.gov/substance/${substance.sid}`,
                substance.submission_date,
                `New substance: ${substance.sid}`,
                `Depositor: ${depositor}, CID: ${substance.cid || 'pending'}`
              );

              results.compounds.push({
                sid,
                status: 'added',
                company: company.name,
                companyId: company.id,
                substance
              });
              
              results.successful++;
              this.logger.info(`✓ Added substance ${substance.sid} from ${depositor}`);
            } else {
              this.logger.info(`Substance ${substance.sid} already exists in database`);
              results.compounds.push({
                sid,
                status: 'duplicate',
                company: company.name,
                substance
              });
            }
          } else {
            this.logger.warn(`Could not create/find company for depositor: ${depositor}`);
            results.compounds.push({
              sid,
              status: 'no_company',
              depositor,
              substance
            });
          }
        } else {
          this.logger.warn(`No data returned for SID ${sid}`);
          results.rawData.push({
            sid,
            status: 'no_data',
            timestamp: new Date().toISOString()
          });
          results.failed++;
        }
        
        // CRITICAL: Wait between each substance to respect rate limits
        if (i < sidList.length - 1) {
          this.logger.debug(`Waiting 5 seconds before next request...`);
          await this.delay(5000); // 5 seconds between requests
        }
        
      } catch (error) {
        this.logger.error(`Failed to process SID ${sid}: ${error.message}`);
        results.errors.push({
          sid,
          error: error.message,
          stack: error.stack,
          response: error.response?.data
        });
        results.rawData.push({
          sid,
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
        results.failed++;
        
        // Wait even longer after an error
        this.logger.debug(`Waiting 10 seconds after error...`);
        await this.delay(10000); // 10 seconds after error
      }
    }

    this.logger.info(`Discovery complete. Results:`, JSON.stringify({
      searched: results.searched,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      compounds: results.compounds.length
    }, null, 2));
    
    return results;
    
  } catch (error) {
    this.logger.error('Fatal error in PubChem discovery:', error);
    results.errors.push({
      type: 'fatal',
      error: error.message,
      stack: error.stack
    });
    return results;
  }
}

// Alternative method using E-utilities instead of PUG REST
async fetchSubstanceViaEutils(sid) {
  try {
    this.logger.debug(`Fetching SID ${sid} via E-utilities...`);
    
    // Use E-utilities efetch which has different rate limits
    const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
    const params = {
      db: 'pcsubstance',
      id: sid,
      retmode: 'json'
    };
    
    if (process.env.NCBI_API_KEY) {
      params.api_key = process.env.NCBI_API_KEY;
    }
    
    const response = await axios.get(url, {
      params,
      timeout: 15000,
      headers: {
        'User-Agent': 'CDMO-Lead-Engine/1.0 (contact@example.com)'
      }
    });
    
    // Log the raw response to understand the structure
    this.logger.debug(`E-utilities response for SID ${sid}:`, JSON.stringify(response.data, null, 2));
    
    const result = response.data?.result?.[sid];
    if (!result) {
      this.logger.warn(`No result data for SID ${sid} in E-utilities response`);
      return null;
    }
    
    // Try multiple fields to get depositor name
    const depositorName = result.sourcenamelist?.[0] || 
                         result.sourcename ||
                         result.sourcecategory || 
                         result.submittername ||
                         result.sourceid?.name ||
                         'Unknown';
    
    const depositDate = result.depositdate || 
                       result.modifydate || 
                       result.createdate ||
                       result.holddate;
    
    const extractedData = {
      sid: sid.toString(),
      cid: result.cid?.toString() || result.standardizedcid?.toString() || null,
      depositor_name: depositorName,
      submission_date: depositDate ? 
        depositDate.split(' ')[0] : // Take just the date part
        new Date().toISOString().split('T')[0],
      // Include all available metadata
      raw_data: {
        synonymlist: result.synonymlist,
        sourcenamelist: result.sourcenamelist,
        sourcecategory: result.sourcecategory,
        hasproperties: result.hasproperties,
        totalheavyatomcount: result.totalheavyatomcount,
        molecularweight: result.molecularweight,
        status: result.status
      }
    };
    
    this.logger.debug(`Extracted data for SID ${sid}:`, JSON.stringify(extractedData, null, 2));
    return extractedData;
    
  } catch (error) {
    // If E-utilities fails, try PUG REST as fallback with heavy rate limiting
    if (error.response?.status === 503 || error.response?.status === 429) {
      this.logger.warn(`E-utilities rate limit for SID ${sid}, falling back to PUG REST after delay`);
      await this.delay(30000); // Wait 30 seconds before trying PUG REST
      return this.fetchPubChemSubstanceDetailsSafe(sid);
    }
    
    this.logger.error(`E-utilities error for SID ${sid}:`, {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

// Safer version of PUG REST fetch with longer delays
async fetchPubChemSubstanceDetailsSafe(sid) {
  try {
    this.logger.debug(`Fetching SID ${sid} via PUG REST (fallback)...`);
    
    // Wait before making request
    await this.delay(10000); // 10 second pre-delay for PUG REST
    
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/JSON`;
    
    const response = await axios.get(url, { 
      timeout: 30000, // Longer timeout
      headers: {
        'User-Agent': 'CDMO-Lead-Engine/1.0 (contact@example.com)',
        'Accept': 'application/json'
      }
    });
    
    // Log raw response
    this.logger.debug(`PUG REST response for SID ${sid}:`, JSON.stringify(response.data, null, 2).substring(0, 500));
    
    const record = response.data?.PC_Substances?.[0];
    if (!record) {
      this.logger.warn(`No substance record in PUG REST response for SID ${sid}`);
      return null;
    }
    
    const sourceData = record.source?.db || {};
    const depositDate = sourceData.date?.std;
    
    const extractedData = {
      sid: sid.toString(),
      cid: record.compound?.[0]?.id?.id?.cid?.toString() || null,
      depositor_name: sourceData.source_id?.str || 
                     sourceData.name || 
                     record.source?.name ||
                     'Unknown',
      submission_date: depositDate ? 
        `${depositDate.year}-${String(depositDate.month || 1).padStart(2, '0')}-${String(depositDate.day || 1).padStart(2, '0')}` : 
        new Date().toISOString().split('T')[0],
      // Include raw data for debugging
      raw_data: {
        source: record.source,
        compound: record.compound,
        sid_info: record.sid
      }
    };
    
    this.logger.debug(`Extracted PUG REST data for SID ${sid}:`, JSON.stringify(extractedData, null, 2));
    return extractedData;
    
  } catch (error) {
    this.logger.error(`Failed to fetch SID ${sid} via PUG REST:`, {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    return null;
  }
}

// Enhanced company resolution with better logging
async resolveCompanyFromDepositor(depositorName) {
  if (!depositorName || depositorName === 'Unknown') {
    this.logger.debug(`Invalid depositor name: "${depositorName}"`);
    return null;
  }

  // Clean up depositor name
  const cleanName = depositorName
    .replace(/\s+(Inc|Corp|LLC|Ltd|GmbH|AG|SA|Pharmaceuticals|Pharma|Therapeutics|Bio|Biotech)\.?$/gi, '')
    .trim();

  this.logger.debug(`Looking for company with name like: "${cleanName}" (original: "${depositorName}")`);

  // Check if company exists
  let company = this.db.prepare('SELECT * FROM companies WHERE name LIKE ?')
    .get(`%${cleanName}%`);

  if (!company) {
    // Try exact match
    company = this.db.prepare('SELECT * FROM companies WHERE name = ?')
      .get(depositorName);
  }

  if (!company) {
    // Create new company
    this.logger.info(`Creating new company: "${depositorName}"`);
    const result = this.db.prepare(`
      INSERT INTO companies (name, domain, country, last_seen_at, created_at)
      VALUES (?, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(depositorName);

    company = this.db.prepare('SELECT * FROM companies WHERE id = ?')
      .get(result.lastInsertRowid);
    
    this.logger.info(`Created company ID ${company.id} for "${depositorName}"`);
  } else {
    this.logger.debug(`Found existing company ID ${company.id} for "${depositorName}"`);
  }

  return company;
}

// Helper method for delays
async delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

//   async fetchPubChemSubstanceDetails(sidList) {
//     try {
//       const substances = [];
      
//       for (const sid of sidList) {
//         const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/JSON`;
//         const response = await axios.get(url, { timeout: 10000 });
        
//         const record = response.data?.PC_Substances?.[0];
//         if (record) {
//           const sourceData = record.source?.db || {};
//           substances.push({
//             sid: sid.toString(),
//             cid: record.compound?.[0]?.id?.id?.cid?.toString(),
//             depositor_name: sourceData.source_id?.str || 'Unknown',
//             submission_date: sourceData.date?.std?.year ? 
//               `${sourceData.date.std.year}-${sourceData.date.std.month || '01'}-${sourceData.date.std.day || '01'}` : 
//               new Date().toISOString().split('T')[0]
//           });
//         }
//       }
      
//       return substances;
//     } catch (error) {
//       this.logger.error('Error fetching substance details:', error);
//       return [];
//     }
//   }

// Drop-in replacement
async fetchPubChemSubstanceDetails(sidList) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Start with a conservative batch size; will shrink on 503s
  let batchSize = 25;

  const headers = {
    'Accept': 'application/json',
    // Identify your client per NCBI guidance (put a real contact email here)
    'User-Agent': process.env.NCBI_USER_AGENT || 'CDMO-Lead-Engine/1.0 (contact@example.com)'
  };

  const all = [];
  let i = 0;

  while (i < sidList.length) {
    const batch = sidList.slice(i, i + batchSize);
    const ids = batch.join(',');

    // const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${ids}/JSON`;
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${ids}/JSON?api_key=${process.env.NCBI_API_KEY}`;


    // Retry with exponential backoff + jitter; honor Retry-After if present
    let attempt = 0;
    const maxAttempts = 6;

    while (true) {
      try {
        const res = await axios.get(url, { timeout: 30000, headers });
        const records = res.data?.PC_Substances || [];

        for (const rec of records) {
          // Pull SID/CID and depositor/source date safely from batch payload
          const sid = rec?.id?.id?.sid?.toString();
          const cid = rec?.compound?.[0]?.id?.id?.cid?.toString();
          const sourceDb = rec?.source?.db || {};
          const depositor = sourceDb?.source_id?.str || 'Unknown';

          // PubChem dates are objects; synthesize an ISO-ish fallback if partial
          const d = sourceDb?.date?.std || {};
          const submissionDate = (d.year)
            ? `${d.year}-${String(d.month || 1).padStart(2,'0')}-${String(d.day || 1).padStart(2,'0')}`
            : new Date().toISOString().slice(0,10);

          if (sid) {
            all.push({
              sid,
              cid,
              depositor_name: depositor,
              submission_date: submissionDate
            });
          }
        }

        // polite pacing between batch calls
        await sleep(1100);
        break; // success for this batch

      } catch (err) {
        attempt += 1;

        // If server provided a Retry-After, use it; else 2^n backoff + jitter
        const retryAfter = parseInt(err?.response?.headers?.['retry-after'], 10);
        const is503 = err?.response?.status === 503;

        if (attempt >= maxAttempts) {
          this.logger.error(`PubChem batch failed after ${attempt} attempts`, { status: err?.response?.status, message: err?.message });
          // Don’t blow up the whole run; move to next batch
          break;
        }

        if (is503) {
          // Be nice: reduce batch size to ease server load
          batchSize = Math.max(5, Math.floor(batchSize / 2));
        }

        const base = retryAfter && !Number.isNaN(retryAfter) ? retryAfter * 1000
                  : Math.min(15000, 1000 * Math.pow(2, attempt)); // 1s,2s,4s,8s,…
        const jitter = Math.floor(Math.random() * 400);
        const delay = base + jitter;

        this.logger.warn(`PubChem ${is503 ? 'ServerBusy 503' : 'error'}; retrying attempt ${attempt}/${maxAttempts} in ${delay}ms (batchSize=${batchSize})`);

        await sleep(delay);
      }
    }

    i += batchSize;
  }

  return all;
}


  async resolveCompanyFromDepositor(depositorName) {
    if (!depositorName || depositorName === 'Unknown') return null;

    // Clean up depositor name
    const cleanName = depositorName
      .replace(/\s+(Inc|Corp|LLC|Ltd|GmbH|AG|SA|Pharmaceuticals|Pharma|Therapeutics|Bio|Biotech)\.?$/gi, '')
      .trim();

    // Check if company exists
    let company = this.db.prepare('SELECT * FROM companies WHERE name LIKE ?')
      .get(`%${cleanName}%`);

    if (!company) {
      // Create new company
      const result = this.db.prepare(`
        INSERT INTO companies (name, domain, country, last_seen_at, created_at)
        VALUES (?, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(depositorName);

      company = this.db.prepare('SELECT * FROM companies WHERE id = ?')
        .get(result.lastInsertRowid);
    }

    return company;
  }

  // ============= PATENT DISCOVERY =============
//   async discoverEarlyPatents(options = {}) {
//     const { days = 30, keywords = ['pharmaceutical composition', 'method of treating', 'compound of formula'] } = options;
    
//     try {
//       this.logger.info('Discovering early-stage patents...');
      
//       const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
//         .toISOString().split('T')[0];

//       // USPTO PatentsView API
//       const baseUrl = 'https://api.patentsview.org/patents/query';
      
//       const queryObj = {
//         _and: [
//           {
//             _or: keywords.map(kw => ({ _text_phrase: { patent_abstract: kw } }))
//           },
//           { _gte: { patent_date: sinceDate } },
//           {
//             _or: [
//               { _text_phrase: { cpc_subsection_id: 'A61K' } }, // Medicinal preparations
//               { _text_phrase: { cpc_subsection_id: 'A61P' } }  // Therapeutic activity
//             ]
//           }
//         ]
//       };

//       const requestBody = {
//         q: queryObj,
//         f: [
//           'patent_number', 'patent_title', 'patent_abstract', 'patent_date',
//           'assignee_organization', 'inventor_first_name', 'inventor_last_name',
//           'cpc_subsection_id', 'patent_num_claims', 'patent_firstnamed_assignee_id'
//         ],
//         s: [{ patent_date: 'desc' }],
//         o: { per_page: 10 }
//       };

//       const response = await axios.post(baseUrl, requestBody, {
//         timeout: 30000,
//         headers: { 'Content-Type': 'application/json' }
//       });

//       const patents = response.data.patents || [];
//       const earlyStagePatents = [];

//       for (const patent of patents) {
//         // Check for pre-clinical indicators
//         const abstract = (patent.patent_abstract || '').toLowerCase();
//         const isEarlyStage = 
//           abstract.includes('lead compound') ||
//           abstract.includes('preclinical') ||
//           abstract.includes('in vitro') ||
//           abstract.includes('animal model') ||
//           abstract.includes('candidate') ||
//           !abstract.includes('phase');

//         if (isEarlyStage && patent.assignee_organization) {
//           const company = await this.resolveCompanyFromDepositor(patent.assignee_organization);
          
//           if (company) {
//             // Store patent
//             this.db.prepare(`
//               INSERT OR IGNORE INTO patents 
//               (company_id, patent_number, title, abstract, filing_date, assignee, process_chemistry_relevant, url)
//               VALUES (?, ?, ?, ?, ?, ?, 1, ?)
//             `).run(
//               company.id,
//               patent.patent_number,
//               patent.patent_title,
//               patent.patent_abstract?.substring(0, 1000),
//               patent.patent_date,
//               patent.assignee_organization,
//               `https://patents.google.com/patent/US${patent.patent_number}`
//             );

//             // Add signal
//             this.db.prepare(`
//               INSERT INTO signals 
//               (company_id, signal_type, signal_strength, source, date, title, content, relevance_score)
//               VALUES (?, 'early_patent', 'strong', 'USPTO', ?, ?, ?, 0.8)
//             `).run(
//               company.id,
//               patent.patent_date,
//               `Early-stage patent: ${patent.patent_title}`,
//               `Pre-clinical compound patent filed`
//             );

//             earlyStagePatents.push({ 
//               company: company.name, 
//               patent: patent.patent_number,
//               title: patent.patent_title 
//             });
//           }
//         }
//       }

//       this.logger.info(`Found ${earlyStagePatents.length} early-stage patents`);
//       return earlyStagePatents;
//     } catch (error) {
//       this.logger.error('Error discovering patents:', error);
//       return [];
//     }
//   }
// ============= PATENT DISCOVERY (Updated with PatentsView GraphQL) =============
async discoverEarlyPatents(options = {}) {
  const { 
    days = 30, 
    keywords = [
      "pharmaceutical composition", 
      "method of treating", 
      "compound of formula"
    ] 
  } = options;

  try {
    this.logger.info("Discovering early-stage patents (via GraphQL)...");

    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // GraphQL query for recent patents
    const query = `
      query ($since: Date!) {
        patents(
          query: { patent_date: { gte: $since } }
          per_page: 25
          sort: [{ patent_date: "desc" }]
        ) {
          count
          patents {
            patent_number
            patent_title
            patent_date
            patent_abstract
            assignees { organization }
            inventors { name_first name_last }
          }
        }
      }
    `;

    const response = await axios.post(
      "https://api.patentsview.org/graphql",
      { query, variables: { since: sinceDate } },
      { timeout: 30000, headers: { "Content-Type": "application/json" } }
    );

    const patents = response.data?.data?.patents?.patents || [];
    const earlyStagePatents = [];

    for (const patent of patents) {
      const abstract = (patent.patent_abstract || "").toLowerCase();

      // Early-stage filter
      const isEarlyStage =
        abstract.includes("lead compound") ||
        abstract.includes("preclinical") ||
        abstract.includes("in vitro") ||
        abstract.includes("animal model") ||
        abstract.includes("candidate") ||
        !abstract.includes("phase");

      if (isEarlyStage && patent.assignees?.length) {
        const org = patent.assignees[0].organization || "Unknown";
        const company = await this.resolveCompanyFromDepositor(org);

        if (company) {
          // Store patent
          this.db
            .prepare(
              `
              INSERT OR IGNORE INTO patents 
              (company_id, patent_number, title, abstract, filing_date, assignee, process_chemistry_relevant, url)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            `
            )
            .run(
              company.id,
              patent.patent_number,
              patent.patent_title,
              patent.patent_abstract?.substring(0, 1000),
              patent.patent_date,
              org,
              `https://patents.google.com/patent/US${patent.patent_number}`
            );

          // Add signal
          this.db
            .prepare(
              `
              INSERT INTO signals 
              (company_id, signal_type, signal_strength, source, date, title, content, relevance_score)
              VALUES (?, 'early_patent', 'strong', 'USPTO', ?, ?, ?, 0.8)
            `
            )
            .run(
              company.id,
              patent.patent_date,
              `Early-stage patent: ${patent.patent_title}`,
              `Pre-clinical compound patent filed`
            );

          earlyStagePatents.push({
            company: company.name,
            patent: patent.patent_number,
            title: patent.patent_title,
          });
        }
      }
    }

    this.logger.info(`Found ${earlyStagePatents.length} early-stage patents`);
    return earlyStagePatents;
  } catch (error) {
    this.logger.error("Error discovering patents:", error.response?.data || error.message);
    return [];
  }
}

  // ============= GRANT DISCOVERY =============
  async discoverNIHGrants(options = {}) {
    const { fiscalYear = new Date().getFullYear(), terms = ['drug discovery', 'lead optimization', 'IND-enabling', 'preclinical development'] } = options;
    
    try {
      this.logger.info('Discovering NIH grants...');
      
      const baseUrl = 'https://api.reporter.nih.gov/v2/projects/search';
      const grants = [];

      for (const term of terms) {
        const requestBody = {
          criteria: {
            text_search: {
              operator: 'and',
              terms: [term]
            },
            fiscal_years: [fiscalYear],
            award_types: ['R01', 'R21', 'R43', 'R44', 'U01', 'SBIR', 'STTR']
          },
          limit: 10,
          offset: 0
        };

        const response = await axios.post(baseUrl, requestBody, {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        });

        const results = response.data.results || [];

        for (const grant of results) {
          // Extract organization
          const orgName = grant.organization?.org_name;
          if (!orgName) continue;

          const company = await this.resolveCompanyFromDepositor(orgName);
          
          if (company) {
            // Store grant
            this.db.prepare(`
              INSERT OR IGNORE INTO grants 
              (company_id, grant_id, agency, title, abstract, amount, start_date, end_date, pi_name, source)
              VALUES (?, ?, 'NIH', ?, ?, ?, ?, ?, ?, 'NIH RePORTER')
            `).run(
              company.id,
              grant.award_id || grant.application_id,
              grant.project_title,
              grant.abstract_text?.substring(0, 2000),
              grant.award_amount || grant.total_cost,
              grant.project_start_date,
              grant.project_end_date,
              grant.principal_investigators?.[0]?.full_name
            );

            // Add signal
            this.db.prepare(`
              INSERT INTO signals 
              (company_id, signal_type, signal_strength, source, date, title, content, relevance_score)
              VALUES (?, 'grant', 'medium', 'NIH', ?, ?, ?, 0.7)
            `).run(
              company.id,
              grant.project_start_date,
              `NIH Grant: ${grant.project_title}`,
              `Amount: $${grant.award_amount || 'N/A'}, Type: ${grant.award_type}`
            );

            grants.push({ company: company.name, grant: grant.project_title });
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      this.logger.info(`Found ${grants.length} relevant grants`);
      return grants;
    } catch (error) {
      this.logger.error('Error discovering NIH grants:', error);
      return [];
    }
  }

  // ============= PUBLICATION DISCOVERY =============
  async discoverPubMedPublications(options = {}) {
    const { days = 30, terms = ['lead compound', 'hit to lead', 'structure activity relationship', 'medicinal chemistry'] } = options;
    
    try {
      this.logger.info('Discovering PubMed publications...');
      
      const dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

      const publications = [];

      for (const term of terms) {
        const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
        const searchParams = {
          db: 'pubmed',
          term: `${term}[Title/Abstract] AND ${dateFilter}:3000[PDAT]`,
          retmax: 50,
          retmode: 'json',
          sort: 'date'
        };

        const searchResponse = await axios.get(searchUrl, { params: searchParams });
        const pmidList = searchResponse.data.esearchresult?.idlist || [];

        if (pmidList.length === 0) continue;

        // Fetch article details
        const fetchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
        const fetchParams = {
          db: 'pubmed',
          id: pmidList.join(','),
          retmode: 'xml'
        };

        const fetchResponse = await axios.get(fetchUrl, { params: fetchParams });
        const articles = await this.parsePubMedXML(fetchResponse.data);

        for (const article of articles) {
          // Extract affiliations and map to companies
          const affiliations = article.affiliations || [];
          
          for (const affiliation of affiliations) {
            const companyMatch = affiliation.match(/([A-Z][A-Za-z\s]+(?:Pharmaceuticals|Pharma|Therapeutics|Bio|Biotech|Inc|Corp|LLC|Ltd))/gi);
            
            if (companyMatch) {
              const companyName = companyMatch[0].trim();
              const company = await this.resolveCompanyFromDepositor(companyName);
              
              if (company) {
                // Store publication
                this.db.prepare(`
                  INSERT OR IGNORE INTO publications 
                  (company_id, pmid, title, abstract, authors, affiliations, publication_date, journal)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  company.id,
                  article.pmid,
                  article.title,
                  article.abstract?.substring(0, 2000),
                  article.authors,
                  affiliation,
                  article.pubDate,
                  article.journal
                );

                // Add signal
                this.db.prepare(`
                  INSERT INTO signals 
                  (company_id, signal_type, signal_strength, source, date, title, content, relevance_score)
                  VALUES (?, 'publication', 'medium', 'PubMed', ?, ?, ?, 0.6)
                `).run(
                  company.id,
                  article.pubDate,
                  `Research: ${article.title}`,
                  `Early-stage drug discovery publication`
                );

                publications.push({ company: company.name, title: article.title });
              }
            }
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      this.logger.info(`Found ${publications.length} relevant publications`);
      return publications;
    } catch (error) {
      this.logger.error('Error discovering publications:', error);
      return [];
    }
  }

  async parsePubMedXML(xmlData) {
    try {
      const result = await parseXml(xmlData);
      const articles = [];
      
      const articleSet = result.PubmedArticleSet?.PubmedArticle || [];
      
      for (const item of articleSet) {
        const medline = item.MedlineCitation?.[0];
        if (!medline) continue;

        const article = medline.Article?.[0];
        const pmid = medline.PMID?.[0]?._;
        
        const authors = article?.AuthorList?.[0]?.Author?.map(a => 
          `${a.ForeName?.[0]} ${a.LastName?.[0]}`
        ).join(', ');

        const affiliations = article?.AuthorList?.[0]?.Author
          ?.map(a => a.AffiliationInfo?.[0]?.Affiliation?.[0])
          .filter(Boolean) || [];

        articles.push({
          pmid,
          title: article?.ArticleTitle?.[0],
          abstract: article?.Abstract?.[0]?.AbstractText?.[0],
          authors,
          affiliations,
          journal: medline.MedlineJournalInfo?.[0]?.MedlineTA?.[0],
          pubDate: article?.ArticleDate?.[0]?.Year?.[0] || 
                   medline.DateCreated?.[0]?.Year?.[0]
        });
      }

      return articles;
    } catch (error) {
      this.logger.error('Error parsing PubMed XML:', error);
      return [];
    }
  }

  // ============= NEWS & PRESS DISCOVERY =============
  async discoverPressReleases(options = {}) {
    const { 
      sources = ['prnewswire', 'globenewswire', 'businesswire'],
      keywords = ['IND-enabling', 'lead compound', 'candidate nomination', 'preclinical', 'Series A', 'Series B']
    } = options;
    
    try {
      this.logger.info('Discovering press releases...');
      const newsItems = [];

      // PRNewswire RSS
      if (sources.includes('prnewswire')) {
        const rssUrl = 'https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss';
        const response = await axios.get(rssUrl, { timeout: 15000 });
        
        const items = await this.parseRSSFeed(response.data);
        
        for (const item of items) {
          const relevantKeyword = keywords.find(kw => 
            item.title.toLowerCase().includes(kw.toLowerCase()) ||
            item.description.toLowerCase().includes(kw.toLowerCase())
          );

          if (relevantKeyword) {
            // Extract company name from title
            const companyMatch = item.title.match(/^([^:,]+?)(?:\s+(?:Announces|Reports|Completes|Initiates|Receives|Advances))/i);
            
            if (companyMatch) {
              const companyName = companyMatch[1].trim();
              const company = await this.resolveCompanyFromDepositor(companyName);
              
              if (company) {
                // Store news mention
                this.db.prepare(`
                  INSERT INTO news_mentions 
                  (company_id, title, url, source, published_date, content_snippet, signal_keywords, relevance_score)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  company.id,
                  item.title,
                  item.link,
                  'PRNewswire',
                  item.pubDate,
                  item.description?.substring(0, 500),
                  relevantKeyword,
                  0.8
                );

                // Add signal
                this.db.prepare(`
                  INSERT INTO signals 
                  (company_id, signal_type, signal_strength, source, url, date, title, content, relevance_score)
                  VALUES (?, 'press', 'strong', 'PRNewswire', ?, ?, ?, ?, 0.8)
                `).run(
                  company.id,
                  item.link,
                  item.pubDate,
                  item.title,
                  `Keyword: ${relevantKeyword}`
                );

                newsItems.push({ company: company.name, headline: item.title });
              }
            }
          }
        }
      }

      this.logger.info(`Found ${newsItems.length} relevant press releases`);
      return newsItems;
    } catch (error) {
      this.logger.error('Error discovering press releases:', error);
      return [];
    }
  }

  async parseRSSFeed(xmlData) {
    try {
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      
      let match;
      while ((match = itemRegex.exec(xmlData)) !== null) {
        const itemContent = match[1];
        
        const title = this.extractXMLValue(itemContent, 'title');
        const link = this.extractXMLValue(itemContent, 'link');
        const description = this.extractXMLValue(itemContent, 'description');
        const pubDate = this.extractXMLValue(itemContent, 'pubDate');
        
        if (title && link) {
          items.push({
            title: this.decodeHTMLEntities(title),
            link,
            description: this.decodeHTMLEntities(description),
            pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
          });
        }
      }
      
      return items;
    } catch (error) {
      this.logger.error('Error parsing RSS feed:', error);
      return [];
    }
  }

  extractXMLValue(xml, tag) {
    const regex = new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>|<${tag}>(.+?)</${tag}>`, 's');
    const match = xml.match(regex);
    return match ? (match[1] || match[2]) : null;
  }

  decodeHTMLEntities(text) {
    if (!text) return '';
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ''); // Strip HTML tags
  }

  // ============= SEC EDGAR DISCOVERY =============
  async discoverSECFilings(options = {}) {
    const { days = 7 } = options;
    
    try {
      this.logger.info('Discovering SEC filings...');
      
      // SEC EDGAR API - Form D (private offerings) and 8-K (material events)
      const baseUrl = 'https://data.sec.gov/submissions/';
      const companiesUrl = 'https://www.sec.gov/files/company_tickers.json';
      
      // Get list of biotech companies from SEC
      const tickersResponse = await axios.get(companiesUrl, {
        headers: { 'User-Agent': 'CDMO Lead Engine/1.0 (contact@example.com)' }
      });
      
      const filings = [];
      const biotechKeywords = ['therapeutics', 'pharmaceuticals', 'bio', 'pharma', 'medicine'];
      
      for (const [ticker, company] of Object.entries(tickersResponse.data)) {
        const companyName = company.title;
        
        // Filter for biotech companies
        const isBiotech = biotechKeywords.some(kw => 
          companyName.toLowerCase().includes(kw)
        );
        
        if (!isBiotech) continue;
        
        // Get recent filings
        const cik = String(company.cik_str).padStart(10, '0');
        const filingUrl = `${baseUrl}CIK${cik}.json`;
        
        try {
          const filingResponse = await axios.get(filingUrl, {
            headers: { 'User-Agent': 'CDMO Lead Engine/1.0 (contact@example.com)' },
            timeout: 10000
          });
          
          const recentFilings = filingResponse.data.filings?.recent || {};
          const forms = recentFilings.form || [];
          const dates = recentFilings.filingDate || [];
          
          for (let i = 0; i < forms.length; i++) {
            const form = forms[i];
            const date = dates[i];
            
            // Check if recent and relevant form type
            const daysSinceFiling = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysSinceFiling <= days && (form === 'D' || form === '8-K')) {
              const companyEntity = await this.resolveCompanyFromDepositor(companyName);
              
              if (companyEntity) {
                // Add signal for financing
                this.db.prepare(`
                  INSERT INTO signals 
                  (company_id, signal_type, signal_strength, source, date, title, content, relevance_score)
                  VALUES (?, 'sec_filing', 'strong', 'SEC EDGAR', ?, ?, ?, 0.9)
                `).run(
                  companyEntity.id,
                  date,
                  `SEC Form ${form} filed`,
                  `Potential financing or material event`
                );
                
                filings.push({ company: companyName, form, date });
              }
            }
          }
        } catch (err) {
          // Skip if company data not available
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      this.logger.info(`Found ${filings.length} relevant SEC filings`);
      return filings;
    } catch (error) {
      this.logger.error('Error discovering SEC filings:', error);
      return [];
    }
  }

  // ============= HIRING SIGNALS =============
  async discoverHiringSignals(options = {}) {
    const { 
      keywords = ['toxicology', 'CMC', 'IND', 'regulatory affairs', 'GMP', 'formulation', 'process chemistry']
    } = options;
    
    try {
      this.logger.info('Discovering hiring signals...');
      
      // Note: This would require LinkedIn API access or web scraping
      // For now, we'll create the structure for manual input
      
      const hiringSignals = [];
      
      // You would implement actual job board APIs here
      // Example structure for manual entry via API endpoint
      
      return hiringSignals;
    } catch (error) {
      this.logger.error('Error discovering hiring signals:', error);
      return [];
    }
  }

  // ============= MASTER DISCOVERY ORCHESTRATOR =============
  async runComprehensiveDiscovery() {
    try {
      this.logger.info('Starting comprehensive pre-Phase 1 discovery...');
      
      const results = {
        pubchem: await this.discoverNewPubChemSubstances({ days: 7, limit: 200 }),
        patents: await this.discoverEarlyPatents({ days: 30 }),
        grants: await this.discoverNIHGrants(),
        publications: await this.discoverPubMedPublications({ days: 30 }),
        press: await this.discoverPressReleases(),
        sec: await this.discoverSECFilings({ days: 7 })
      };
      
      // Calculate statistics
      const stats = {
        newCompounds: results.pubchem.length,
        newPatents: results.patents.length,
        newGrants: results.grants.length,
        newPublications: results.publications.length,
        newPressReleases: results.press.length,
        newFilings: results.sec.length,
        totalSignals: Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
      };
      
      this.logger.info('Discovery complete:', stats);
      
      // Trigger scoring update for all affected companies
      const affectedCompanies = new Set();
      Object.values(results).forEach(resultArray => {
        resultArray.forEach(item => {
          if (item.company) affectedCompanies.add(item.company);
        });
      });
      
      // Update scores
      for (const companyName of affectedCompanies) {
        const company = this.db.prepare('SELECT id FROM companies WHERE name = ?').get(companyName);
        if (company) {
          this.updatePrePhase1Score(company.id);
        }
      }
      
      return { results, stats };
    } catch (error) {
      this.logger.error('Comprehensive discovery failed:', error);
      throw error;
    }
  }

  // Enhanced scoring for pre-Phase 1 signals
  updatePrePhase1Score(companyId) {
    const signals = this.db.prepare(`
      SELECT signal_type, signal_strength, COUNT(*) as count 
      FROM signals 
      WHERE company_id = ? 
      AND date >= date('now', '-6 months')
      GROUP BY signal_type, signal_strength
    `).all(companyId);
    
    let prePhase1Score = 0;
    
    signals.forEach(signal => {
      const strengthMultiplier = 
        signal.signal_strength === 'strong' ? 3 :
        signal.signal_strength === 'medium' ? 2 : 1;
      
      const typeWeight = {
        'new_compound': 5,
        'early_patent': 4,
        'grant': 3,
        'publication': 2,
        'press': 3,
        'sec_filing': 4,
        'hiring': 2
      }[signal.signal_type] || 1;
      
      prePhase1Score += signal.count * strengthMultiplier * typeWeight;
    });
    
    // Update the company's score
    const currentScore = this.db.prepare('SELECT * FROM scores WHERE company_id = ?').get(companyId);
    
    if (currentScore) {
      const newOverallScore = currentScore.overall_score + (prePhase1Score * 0.5);
      
      this.db.prepare(`
        UPDATE scores 
        SET overall_score = ?, 
            molecule_quality_score = molecule_quality_score + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = ?
      `).run(newOverallScore, prePhase1Score * 0.1, companyId);
    }
    
    return prePhase1Score;
  }
}

// Export the module
module.exports = PrePhase1Discovery;

// ===========================
// INTEGRATION WITH MAIN SERVER
// ===========================

// Add these API endpoints to your server.js:

/*
// Import the module at the top of server.js:
const PrePhase1Discovery = require('./pre-phase1-discovery');

// Initialize after database setup:
const prePhase1 = new PrePhase1Discovery(db, logger);

// API Endpoints:

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
      recentSignals: db.prepare("SELECT COUNT(*) as count FROM signals WHERE date >= date('now', '-7 days')").get().count
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scheduled job for daily discovery (add to your cron section):
cron.schedule('0 4 * * *', async () => {
  logger.info('Starting scheduled pre-Phase 1 discovery...');
  try {
    await prePhase1.runComprehensiveDiscovery();
    logger.info('Pre-Phase 1 discovery completed');
  } catch (error) {
    logger.error('Pre-Phase 1 discovery failed:', error);
  }
});

*/