#!/usr/bin/env node
/**
 * Phase 1 Discovery Platform - Complete Fixed Server
 * With Hunter.io integration and comprehensive GPT-4 enrichment
 */

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const dayjs = require('dayjs');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
require('dotenv').config();
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://syneticslz:gMN1GUBtevSaw8DE@synetictest.bl3xxux.mongodb.net/?retryWrites=true&w=majority&appName=SyneticTest';
mongoose.connect(MONGODB_URI);

mongoose.connection.once('open', async () => {
  console.log('Connected to MongoDB');
  try {
    await mongoose.connection.collection('trials').dropIndex('nctId_1_fetched_for_api_1').catch(() => {});
    await mongoose.connection.collection('trials').dropIndex('trialId_1').catch(() => {});
    console.log('Cleaned up indexes');
  } catch (err) {
    // Indexes might not exist
  }
});

// OpenAI setup
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// Utility functions
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function politeGet(url, options = {}) {
  const maxRetries = 5;
  const baseDelay = 1000;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'PhaseOne-Discovery/1.0',
          ...options.headers
        },
        ...options
      });
      await sleep(500);
      return response;
    } catch (error) {
      const status = error.response?.status;
      
      if (status === 429 || status === 503) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`Rate limited on ${url}, waiting ${delay}ms before retry ${i + 1}/${maxRetries}`);
        await sleep(delay);
        continue;
      }
      
      if (!error.response && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`Network error on ${url}, retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      
      if (i === maxRetries - 1) {
        console.error(`Failed to fetch ${url} after ${maxRetries} retries:`, error.message);
        return null;
      }
    }
  }
  return null;
}

// MongoDB Schemas
const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  domain: String,
  website: String,
  country: String,
  employeeCount: Number,
  employeeBand: String,
  foundedYear: Number,
  headquarters: String,
  description: String,
  hasInternalGMP: Boolean,
  outsourcingProbability: Number,
  recentEvents: [Object],
  lastEnriched: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const MoleculeSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  name: String,
  pubchemSid: String,
  pubchemCid: String,
  chemblId: String,
  target: String,
  targetClass: String,
  mechanismOfAction: String,
  modality: String,
  indication: String,
  therapeuticArea: String,
  developmentStage: String,
  structureAvailable: Boolean,
  processChemistryComplexity: String,
  smiles: String,
  molecularWeight: Number,
  depositor: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const TrialSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  molecule: { type: mongoose.Schema.Types.ObjectId, ref: 'Molecule' },
  registry: String,
  trialId: { type: String, sparse: true },
  phase: String,
  status: String,
  title: String,
  startDate: Date,
  completionDate: Date,
  firstPosted: Date,
  lastUpdate: Date,
  enrollment: Number,
  locations: [String],
  hasUSSites: Boolean,
  hasEUSites: Boolean,
  sponsorType: String,
  collaborators: [String],
  interventions: [Object],
  conditions: [String],
  createdAt: { type: Date, default: Date.now }
});

TrialSchema.index({ trialId: 1, registry: 1 }, { unique: true, sparse: true });

const FundingSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  roundType: String,
  amountUSD: Number,
  date: Date,
  investors: [String],
  leadInvestor: String,
  source: String,
  pressReleaseUrl: String,
  createdAt: { type: Date, default: Date.now }
});

const ContactSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  name: String,
  title: String,
  department: String,
  email: String,
  emailVerified: Boolean,
  phone: String,
  linkedinUrl: String,
  bio: String,
  source: String,
  confidenceScore: Number,
  lastVerified: Date,
  createdAt: { type: Date, default: Date.now }
});

const ScoreSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  overallScore: Number,
  phase1ReadinessScore: Number,
  fundingScore: Number,
  outsourcingLikelihoodScore: Number,
  moleculeQualityScore: Number,
  timingScore: Number,
  canPay: Boolean,
  needsCDMO: Boolean,
  isStale: Boolean,
  priorityTier: String,
  scoreComponents: Object,
  updatedAt: { type: Date, default: Date.now }
});

// Patent Schema
const PatentSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  patentNumber: { type: String, unique: true, required: true },
  applicationNumber: String,
  title: { type: String, required: true },
  abstract: String,
  filingDate: Date,
  grantDate: Date,
  priorityDate: Date,
  assignee: String,
  inventors: [String],
  claims: Number,
  citedPatents: [String],
  classifications: {
    cpc: [String],
    uspc: [String],
    ipc: [String]
  },
  type: String, // utility, design, plant, reissue
  status: String, // pending, granted, expired, abandoned
  
  // Pharmaceutical relevance
  pharmaceuticalRelevance: Number,
  relevanceLevel: String, // High, Medium, Low
  relevanceFactors: [String],
  isProcessChemistry: Boolean,
  isDrugDelivery: Boolean,
  isNovelCompound: Boolean,
  cdmoRelevant: Boolean,
  
  // Links and sources
  url: String,
  source: String, // USPTO, EPO, WIPO
  processingTime: Number,
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// News Article Schema
const NewsArticleSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  title: { type: String, required: true },
  url: { type: String, unique: true },
  publishDate: Date,
  source: String,
  category: String,
  content: String,
  summary: String,
  
  // Analysis
  analysis: {
    fundingAmount: Number,
    fundingRound: String,
    companies: [String],
    molecules: [String],
    types: [String], // funding, clinical_trial, regulatory, partnership, m&a, patent
    relevanceScore: Number,
    isPhase1Related: Boolean,
    isCDMORelated: Boolean
  },
  
  // Extracted entities
  mentionedCompanies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Company' }],
  mentionedMolecules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Molecule' }],
  mentionedPeople: [String],
  
  matchedKeywords: [String],
  sentiment: String, // positive, negative, neutral
  
  createdAt: { type: Date, default: Date.now }
});

// Comprehensive Analysis Schema
const AnalysisSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', unique: true },
  
  cdmoOpportunity: {
    outsourcingLikelihood: Number, // 0-100
    timeline: String, // immediate, 6_months, 12_months, 18_plus_months
    estimatedBudget: {
      min: Number,
      max: Number
    },
    servicesNeeded: [String], // API, formulation, fill_finish, analytical, stability
    decisionFactors: [String],
    recommendedApproach: String
  },
  
  competitivePosition: {
    uniqueAdvantages: [String],
    differentiators: [String],
    marketPosition: String,
    competitiveThreats: [String],
    competitorComparison: Object
  },
  
  financialHealth: {
    burnRate: Number,
    runwayMonths: Number,
    canAffordServices: Boolean,
    fundingOutlook: String,
    creditRisk: String // low, medium, high
  },
  
  technicalAssessment: {
    moleculeComplexity: String, // low, medium, high
    manufacturingChallenges: [String],
    regulatoryPathway: String,
    technicalRisks: [String],
    scalabilityIssues: [String]
  },
  
  businessDevelopment: {
    keyDecisionMakers: [String],
    approachStrategy: String,
    valuePropositions: [String],
    potentialObjections: [String],
    responseStrategies: [String],
    expectedSalessCycle: Number // days
  },
  
  riskAssessment: {
    programRisks: [String],
    financialRisks: [String],
    competitiveRisks: [String],
    regulatoryRisks: [String],
    overallRiskLevel: String // low, medium, high, critical
  },
  
  partnershipReadiness: {
    currentPartnerships: [String],
    partnershipNeeds: [String],
    dealPreferences: [String],
    negotiationLeverage: String // weak, moderate, strong
  },
  
  recommendations: {
    priority: String, // high, medium, low
    nextSteps: [String],
    customProposal: String,
    pricingStrategy: String
  },
  
  dataQuality: {
    completeness: Number, // 0-1
    confidence: Number, // 0-1
    lastUpdated: Date,
    sources: [String]
  },
  
  generatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => Date.now() + 30*24*60*60*1000 } // 30 days
});

// RSS Feed Configuration Schema
const RSSFeedSchema = new mongoose.Schema({
  url: { type: String, unique: true, required: true },
  category: String,
  name: String,
  active: { type: Boolean, default: true },
  lastFetched: Date,
  fetchFrequency: Number, // minutes
  errorCount: Number,
  lastError: String,
  
  // Statistics
  articlesFound: Number,
  relevantArticles: Number,
  companiesDiscovered: [String],
  
  createdAt: { type: Date, default: Date.now }
});

// Enhanced Molecule Schema with PubChem compound data
const EnhancedMoleculeSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  name: String,
  synonyms: [String],
  
  // Identifiers
  pubchemSid: String,
  pubchemCid: String,
  chemblId: String,
  drugbankId: String,
  inchiKey: String,
  casNumber: String,
  
  // Structure
  smiles: String,
  isomericSmiles: String,
  inchi: String,
  molecularFormula: String,
  
  // Properties
  molecularWeight: Number,
  xLogP: Number,
  tpsa: Number, // Topological Polar Surface Area
  complexity: Number,
  hBondDonorCount: Number,
  hBondAcceptorCount: Number,
  rotatableBondCount: Number,
  heavyAtomCount: Number,
  monoisotopicMass: Number,
  
  // Drug-likeness
  drugLikeness: {
    passesRuleOfFive: Boolean,
    violations: [String],
    isLeadLike: Boolean,
    qedScore: Number, // Quantitative Estimate of Drug-likeness
    lipinskiScore: Number,
    veberScore: Number
  },
  
  // Development
  developmentStage: String,
  indication: String,
  therapeuticArea: String,
  target: String,
  targetClass: String,
  mechanismOfAction: String,
  modality: String,
  
  // Bioactivity
  bioassayCount: Number,
  activeAssays: Number,
  inactiveAssays: Number,
  potency: String,
  
  // Patents
  relatedPatents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Patent' }],
  patentExpiry: Date,
  
  // Manufacturing
  synthesisComplexity: String, // simple, moderate, complex
  processChemistryNotes: String,
  expectedYield: Number,
  costEstimate: Number,
  
  // Clinical
  clinicalTrials: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trial' }],
  adverseEvents: [String],
  
  structureAvailable: Boolean,
  sourceDatabase: String,
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Complete Data Aggregation Service
class DataAggregationService {
  static async aggregateCompanyData(companyId) {
    try {
      // Fetch all data sources
      const [
        company,
        trials,
        molecules,
        funding,
        patents,
        news,
        contacts,
        analysis
      ] = await Promise.all([
        Company.findById(companyId),
        Trial.find({ company: companyId }).sort({ startDate: -1 }),
        EnhancedMolecule.find({ company: companyId }),
        Funding.find({ company: companyId }).sort({ date: -1 }),
        Patent.find({ company: companyId }).sort({ filingDate: -1 }),
        NewsArticle.find({ company: companyId }).sort({ publishDate: -1 }).limit(50),
        Contact.find({ company: companyId }),
        Analysis.findOne({ company: companyId })
      ]);
      
      // Calculate comprehensive metrics
      const metrics = {
        // Pipeline metrics
        pipelineDepth: molecules.length,
        phase1Programs: trials.filter(t => t.phase?.includes('Phase 1')).length,
        activePrograms: trials.filter(t => ['Recruiting', 'Active, not recruiting'].includes(t.status)).length,
        
        // Financial metrics
        totalFunding: funding.reduce((sum, f) => sum + (f.amountUSD || 0), 0),
        lastFundingAge: funding[0] ? dayjs().diff(funding[0].date, 'month') : null,
        fundingVelocity: this.calculateFundingVelocity(funding),
        
        // IP metrics
        patentCount: patents.length,
        recentPatents: patents.filter(p => dayjs(p.filingDate).isAfter(dayjs().subtract(18, 'month'))).length,
        processPatents: patents.filter(p => p.isProcessChemistry).length,
        
        // News sentiment
        recentNewsCount: news.length,
        positiveSentiment: news.filter(n => n.sentiment === 'positive').length / news.length,
        fundingMentions: news.filter(n => n.analysis.types.includes('funding')).length,
        
        // Drug-likeness
        drugLikeMolecules: molecules.filter(m => m.drugLikeness?.passesRuleOfFive).length,
        leadLikeMolecules: molecules.filter(m => m.drugLikeness?.isLeadLike).length,
        
        // Relationships
        contactQuality: this.assessContactQuality(contacts),
        dataCompleteness: this.calculateDataCompleteness({
          company, trials, molecules, funding, patents, contacts
        })
      };
      
      return {
        company,
        trials,
        molecules,
        funding,
        patents,
        news,
        contacts,
        analysis,
        metrics
      };
      
    } catch (error) {
      console.error('Data aggregation error:', error);
      throw error;
    }
  }
  
  static calculateFundingVelocity(funding) {
    if (funding.length < 2) return 0;
    
    const recentFunding = funding.filter(f => 
      dayjs(f.date).isAfter(dayjs().subtract(24, 'month'))
    );
    
    if (recentFunding.length < 2) return 0;
    
    const totalRaised = recentFunding.reduce((sum, f) => sum + (f.amountUSD || 0), 0);
    const monthsSpan = dayjs(recentFunding[0].date).diff(recentFunding[recentFunding.length - 1].date, 'month') || 1;
    
    return totalRaised / monthsSpan; // $ per month
  }
  
  static assessContactQuality(contacts) {
    if (!contacts.length) return 0;
    
    let score = 0;
    const executiveCount = contacts.filter(c => /CEO|CFO|COO|President/i.test(c.title)).length;
    const vpCount = contacts.filter(c => /VP|Vice President/i.test(c.title)).length;
    const withEmail = contacts.filter(c => c.email).length;
    const withLinkedIn = contacts.filter(c => c.linkedinUrl).length;
    
    score += Math.min(executiveCount * 20, 40);
    score += Math.min(vpCount * 10, 30);
    score += Math.min((withEmail / contacts.length) * 20, 20);
    score += Math.min((withLinkedIn / contacts.length) * 10, 10);
    
    return score; // 0-100
  }
  
  static calculateDataCompleteness(data) {
    let score = 0;
    const weights = {
      company: 20,
      trials: 20,
      molecules: 20,
      funding: 15,
      patents: 10,
      contacts: 15
    };
    
    // Company completeness
    if (data.company) {
      const fields = ['website', 'employeeCount', 'headquarters', 'foundedYear'];
      const filled = fields.filter(f => data.company[f]).length;
      score += (filled / fields.length) * weights.company;
    }
    
    // Other data presence
    if (data.trials?.length > 0) score += weights.trials;
    if (data.molecules?.length > 0) score += weights.molecules;
    if (data.funding?.length > 0) score += weights.funding;
    if (data.patents?.length > 0) score += weights.patents;
    if (data.contacts?.length > 0) score += weights.contacts;
    
    return score; // 0-100
  }
}

// Automated Discovery Pipeline
class AutomatedDiscoveryPipeline {
  static async runFullDiscovery() {
    console.log('Starting automated discovery pipeline...');
    
    const results = {
      companies: [],
      trials: [],
      molecules: [],
      patents: [],
      funding: [],
      news: []
    };
    
    try {
      // 1. Scan RSS feeds for new companies and events
      console.log('Scanning RSS feeds...');
      const rssMonitor = new RSSFeedMonitor();
      const articles = await rssMonitor.scanAllFeeds();
      
      // Process discovered companies
      const discoveredCompanies = new Set();
      articles.forEach(article => {
        article.analysis.companies.forEach(c => discoveredCompanies.add(c));
      });
      
      for (const companyName of discoveredCompanies) {
        let company = await Company.findOne({ name: companyName });
        if (!company) {
          company = await Company.create({ name: companyName });
          results.companies.push(company);
        }
      }
      
      results.news = articles;
      
      // 2. Fetch recent clinical trials
      console.log('Fetching clinical trials...');
      const trials = await ClinicalTrialsAPI.fetchPhase1Trials({
        sinceDays: 7,
        maxResults: 100
      });
      results.trials = trials;
      
      // 3. Fetch PubChem substances
      console.log('Fetching PubChem data...');
      const substances = await PubChemAPI.fetchRecentSubstances({
        days: 7,
        limit: 50
      });
      
      // Process molecules
      for (const substance of substances) {
        if (substance.therapeuticPotential?.score > 40) {
          results.molecules.push(substance);
        }
      }
      
      // 4. Search for patents
      console.log('Searching for recent patents...');
      for (const company of results.companies.slice(0, 10)) {
        const patents = await PatentSearchService.searchCompanyPatents(
          company.name,
          { sinceDays: 90 }
        );
        results.patents.push(...patents);
      }
      
      // 5. Discover funding
      console.log('Discovering funding events...');
      for (const company of results.companies.slice(0, 10)) {
        const funding = await AdvancedFundingDiscovery.discoverFunding(company.name);
        results.funding.push(...funding);
      }
      
      // 6. Run AI analysis on top prospects
      console.log('Running AI analysis...');
      const topCompanies = await Company.find()
        .sort({ 'score.overallScore': -1 })
        .limit(5);
      
      for (const company of topCompanies) {
        const aggregatedData = await DataAggregationService.aggregateCompanyData(company._id);
        const analysis = await ComprehensiveAIAnalysis.analyzeCompany(aggregatedData);
        
        await Analysis.findOneAndUpdate(
          { company: company._id },
          { analysis, generatedAt: new Date() },
          { upsert: true }
        );
      }
      
      console.log('Discovery pipeline complete');
      return results;
      
    } catch (error) {
      console.error('Discovery pipeline error:', error);
      return results;
    }
  }
}

// Add new endpoints to main server
app.post('/api/discovery/run-full', async (req, res) => {
  try {
    showLoading('Running comprehensive discovery', 'This will take several minutes...');
    const results = await AutomatedDiscoveryPipeline.runFullDiscovery();
    
    res.json({
      success: true,
      discovered: {
        companies: results.companies.length,
        trials: results.trials.length,
        molecules: results.molecules.length,
        patents: results.patents.length,
        funding: results.funding.length,
        news: results.news.length
      },
      results
    });
  } catch (error) {
    console.error('Full discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get aggregated company data
app.get('/api/companies/:id/aggregated', async (req, res) => {
  try {
    const data = await DataAggregationService.aggregateCompanyData(req.params.id);
    res.json(data);
  } catch (error) {
    console.error('Aggregation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Models
const Patent = mongoose.model('Patent', PatentSchema);
const NewsArticle = mongoose.model('NewsArticle', NewsArticleSchema);
const Analysis = mongoose.model('Analysis', AnalysisSchema);
const RSSFeed = mongoose.model('RSSFeed', RSSFeedSchema);
const EnhancedMolecule = mongoose.model('EnhancedMolecule', EnhancedMoleculeSchema);

// Models
const Company = mongoose.model('Company', CompanySchema);
const Molecule = mongoose.model('Molecule', MoleculeSchema);
const Trial = mongoose.model('Trial', TrialSchema);
const Funding = mongoose.model('Funding', FundingSchema);
const Contact = mongoose.model('Contact', ContactSchema);
const Score = mongoose.model('Score', ScoreSchema);

// // Clinical Trials API
// class ClinicalTrialsAPI {
//   static async fetchPhase1Trials(options = {}) {
//     const {
//       maxResults = 500,
//       sinceDays = 90,
//       country = null,
//       earlyPhaseOnly = false,
//       firstInHumanHeuristic = false,
//       includeOncology = false
//     } = options;

//     try {
//       const baseUrl = 'https://clinicaltrials.gov/api/v2/studies';
//       const sinceDate = dayjs().subtract(sinceDays, 'day').format('YYYY-MM-DD');
      
//       const queryParts = [
//         'AREA[StudyType]Interventional',
//         'AREA[Phase](Phase 1 OR Early Phase 1)',
//         `AREA[StudyFirstPostDate]RANGE[${sinceDate}, MAX]`
//       ];
      
//       if (!includeOncology) {
//         queryParts.push('NOT AREA[Condition]cancer');
//       }
      
//       if (country) {
//         queryParts.push(`AREA[LocationCountry]${country}`);
//       }
      
//       const params = new URLSearchParams({
//         'query.term': queryParts.join(' AND '),
//         'pageSize': '100',
//         'countTotal': 'true',
//         'fields': 'NCTId|OfficialTitle|BriefTitle|Phase|OverallStatus|StartDate|CompletionDate|' +
//                  'LeadSponsorName|LeadSponsorClass|InterventionName|InterventionType|' +
//                  'Condition|LocationCountry|LocationCity|EnrollmentCount|StudyFirstPostDate'
//       });

//       let allStudies = [];
//       let pageToken = null;
//       let totalFetched = 0;

//       do {
//         const url = pageToken 
//           ? `${baseUrl}?${params.toString()}&pageToken=${pageToken}`
//           : `${baseUrl}?${params.toString()}`;

//         const response = await politeGet(url);
//         if (!response) break;
        
//         const studies = response.data?.studies || [];
//         allStudies = allStudies.concat(studies);
//         totalFetched += studies.length;
//         pageToken = response.data?.nextPageToken;
        
//         if (totalFetched >= maxResults) break;
        
//       } while (pageToken);

//       console.log(`Fetched ${allStudies.length} Phase 1 trials`);
//       return allStudies.map(study => this.normalizeTrialData(study));
      
//     } catch (error) {
//       console.error('Error fetching clinical trials:', error);
//       return [];
//     }
//   }

//   static normalizeTrialData(study) {
//     const protocolSection = study.protocolSection || {};
//     const identificationModule = protocolSection.identificationModule || {};
//     const statusModule = protocolSection.statusModule || {};
//     const designModule = protocolSection.designModule || {};
//     const sponsorModule = protocolSection.sponsorCollaboratorsModule || {};
//     const armsModule = protocolSection.armsInterventionsModule || {};
//     const conditionsModule = protocolSection.conditionsModule || {};
//     const contactsModule = protocolSection.contactsLocationsModule || {};

//     const locations = contactsModule.locations || [];
//     const hasUSSites = locations.some(loc => 
//       loc.country === 'United States' || loc.country === 'USA'
//     );
//     const hasEUSites = locations.some(loc => 
//       ['Germany', 'France', 'Italy', 'Spain', 'United Kingdom', 'Netherlands'].includes(loc.country)
//     );

//     return {
//       registry: 'ClinicalTrials.gov',
//       trialId: identificationModule.nctId,
//       title: identificationModule.officialTitle || identificationModule.briefTitle,
//       briefTitle: identificationModule.briefTitle,
//       phase: (designModule.phases || []).join(', '),
//       status: statusModule.overallStatus,
//       startDate: statusModule.startDateStruct?.date,
//       completionDate: statusModule.completionDateStruct?.date,
//       firstPosted: statusModule.studyFirstPostDateStruct?.date,
//       lastUpdate: statusModule.lastUpdatePostDateStruct?.date,
//       sponsor: sponsorModule.leadSponsor?.name,
//       sponsorClass: sponsorModule.leadSponsor?.class,
//       collaborators: (sponsorModule.collaborators || []).map(c => c.name),
//       interventions: armsModule.interventions || [],
//       conditions: conditionsModule.conditions || [],
//       enrollment: designModule.enrollmentInfo?.count,
//       hasUSSites,
//       hasEUSites,
//       locationCountries: [...new Set(locations.map(l => l.country))].filter(Boolean)
//     };
//   }
// }

// // PubChem API
// class PubChemAPI {
//   static async fetchRecentSubstances(options = {}) {
//     const { days = 7, limit = 50 } = options;
//     const substances = [];
    
//     try {
//       const sinceDate = dayjs().subtract(days, 'day').format('YYYY/MM/DD');
//       const maxDate = dayjs().format('YYYY/MM/DD');
      
//       const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`;
//       const params = {
//         db: 'pcsubstance',
//         retmode: 'json',
//         retmax: limit,
//         sort: 'datemodified',
//         term: 'all[sb]',
//         datetype: 'mdat',
//         mindate: sinceDate,
//         maxdate: maxDate
//       };

//       const response = await politeGet(url, { params });
//       if (!response) {
//         console.log('Failed to fetch PubChem search results');
//         return substances;
//       }
      
//       const sids = response.data?.esearchresult?.idlist || [];
//       console.log(`Found ${sids.length} recent PubChem substances`);
      
//       for (const sid of sids.slice(0, Math.min(limit, 20))) {
//         try {
//           const details = await this.getSubstanceDetails(sid);
//           if (details) {
//             substances.push(details);
//             console.log(`Fetched substance ${sid}: ${details.depositor}`);
//           }
//         } catch (err) {
//           console.error(`Error fetching substance ${sid}:`, err.message);
//         }
//         await sleep(300);
//       }
      
//     } catch (error) {
//       console.error('Error in PubChem search:', error.message);
//     }
    
//     console.log(`Successfully fetched ${substances.length} substances`);
//     return substances;
//   }

//   static async getSubstanceDetails(sid) {
//     try {
//       const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/JSON`;
//       const response = await politeGet(url);
      
//       if (!response) return null;
      
//       const substance = response.data?.PC_Substances?.[0];
//       if (!substance) return null;
      
//       const depositor = substance.source?.db?.name || 
//                        substance.sourceinfo?.[0]?.db?.name || 
//                        'Unknown';
      
//       let cids = [];
//       try {
//         const cidUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/cids/JSON`;
//         const cidResponse = await politeGet(cidUrl);
//         if (cidResponse) {
//           const cidInfo = cidResponse.data?.InformationList?.Information?.[0];
//           cids = cidInfo?.CID || [];
//           if (!Array.isArray(cids)) cids = cids ? [cids] : [];
//         }
//       } catch (err) {
//         // CIDs might not be available
//       }
      
//       return {
//         sid: sid.toString(),
//         depositor,
//         cids: cids.map(c => c.toString()),
//         submissionDate: new Date().toISOString()
//       };
//     } catch (error) {
//       console.error(`Error getting details for SID ${sid}:`, error.message);
//       return null;
//     }
//   }
// }
// Run comprehensive discovery daily at 3 AM
// cron.schedule('0 3 * * *', async () => {
//   await AutomatedDiscoveryPipeline.runFullDiscovery();
// });
// Enhanced Clinical Trials API with comprehensive data extraction
class ClinicalTrialsAPI {
  static async fetchPhase1Trials(options = {}) {
    const {
      maxResults = 500,
      sinceDays = 90,
      country = null,
      earlyPhaseOnly = false,
      firstInHumanHeuristic = false,
      includeOncology = false
    } = options;

    try {
      const baseUrl = 'https://clinicaltrials.gov/api/v2/studies';
      const sinceDate = dayjs().subtract(sinceDays, 'day').format('YYYY-MM-DD');
      
      const queryParts = [
        'AREA[StudyType]Interventional',
        'AREA[Phase](Phase 1 OR Early Phase 1)',
        `AREA[StudyFirstPostDate]RANGE[${sinceDate}, MAX]`
      ];
      
      if (!includeOncology) {
        queryParts.push('NOT AREA[Condition]cancer');
      }
      
      if (country) {
        queryParts.push(`AREA[LocationCountry]${country}`);
      }
      
      // Request ALL available fields for comprehensive data
      const params = new URLSearchParams({
        'query.term': queryParts.join(' AND '),
        'pageSize': '100',
        'countTotal': 'true',
        'fields': 'NCTId|OfficialTitle|BriefTitle|BriefSummary|DetailedDescription|' +
                 'Phase|OverallStatus|WhyStopped|StartDate|StartDateType|CompletionDate|CompletionDateType|' +
                 'StudyFirstPostDate|ResultsFirstPostDate|LastUpdatePostDate|' +
                 'LeadSponsorName|LeadSponsorClass|CollaboratorName|CollaboratorClass|' +
                 'ResponsiblePartyType|ResponsiblePartyInvestigatorFullName|ResponsiblePartyInvestigatorTitle|' +
                 'ResponsiblePartyOldNameTitle|ResponsiblePartyOldOrganization|' +
                 'InterventionType|InterventionName|InterventionDescription|InterventionArmGroupLabel|InterventionOtherName|' +
                 'Condition|ConditionAncestorTerm|ConditionBrowseBranchName|ConditionBrowseLeafName|ConditionMeshTerm|' +
                 'PrimaryOutcomeMeasure|PrimaryOutcomeDescription|PrimaryOutcomeTimeFrame|' +
                 'SecondaryOutcomeMeasure|SecondaryOutcomeDescription|SecondaryOutcomeTimeFrame|' +
                 'EnrollmentCount|EnrollmentType|PatientRegistry|TargetDuration|' +
                 'LocationFacility|LocationCity|LocationState|LocationZip|LocationCountry|LocationStatus|' +
                 'LocationContactName|LocationContactEMail|LocationContactPhone|' +
                 'ReferencePMID|ReferenceCitation|ReferenceType|' +
                 'DesignAllocation|DesignInterventionModel|DesignPrimaryPurpose|DesignMasking|' +
                 'DesignWhoMasked|StudyType|Gender|MinimumAge|MaximumAge|HealthyVolunteers|' +
                 'IPDSharing|IPDSharingDescription|IPDSharingURL|' +
                 'VersionHolder|HasResults|ExpandedAccessNCTId|ExpandedAccessStatusForNCTId|' +
                 'HasDMCOversightComment|IsFDARegulatedDrug|IsFDARegulatedDevice|' +
                 'IsUnapprovedDevice|IsPPSD|IsUSExport|' +
                 'BaselineMeasureDenomCountValue|BaselineMeasureDenomUnits'
      });

      let allStudies = [];
      let pageToken = null;
      let totalFetched = 0;

      do {
        const url = pageToken 
          ? `${baseUrl}?${params.toString()}&pageToken=${pageToken}`
          : `${baseUrl}?${params.toString()}`;

        const response = await politeGet(url);
        if (!response) break;
        
        const studies = response.data?.studies || [];
        allStudies = allStudies.concat(studies);
        totalFetched += studies.length;
        pageToken = response.data?.nextPageToken;
        
        if (totalFetched >= maxResults) break;
        
      } while (pageToken);

      console.log(`Fetched ${allStudies.length} Phase 1 trials with comprehensive data`);
      return allStudies.map(study => this.extractComprehensiveTrialData(study));
      
    } catch (error) {
      console.error('Error fetching clinical trials:', error);
      return [];
    }
  }

  static extractComprehensiveTrialData(study) {
    const protocolSection = study.protocolSection || {};
    const identificationModule = protocolSection.identificationModule || {};
    const statusModule = protocolSection.statusModule || {};
    const designModule = protocolSection.designModule || {};
    const sponsorModule = protocolSection.sponsorCollaboratorsModule || {};
    const armsModule = protocolSection.armsInterventionsModule || {};
    const conditionsModule = protocolSection.conditionsModule || {};
    const contactsModule = protocolSection.contactsLocationsModule || {};
    const descriptionModule = protocolSection.descriptionModule || {};
    const outcomesModule = protocolSection.outcomesModule || {};
    const eligibilityModule = protocolSection.eligibilityModule || {};
    const referencesModule = protocolSection.referencesModule || {};
    const oversightModule = protocolSection.oversightModule || {};

    // Extract all locations with comprehensive details
    const locations = (contactsModule.locations || []).map(loc => ({
      facility: loc.facility,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      country: loc.country,
      status: loc.status,
      contactName: loc.contacts?.[0]?.name,
      contactEmail: loc.contacts?.[0]?.email,
      contactPhone: loc.contacts?.[0]?.phone,
      geoPoint: loc.geoPoint // Lat/Long if available
    }));

    const hasUSSites = locations.some(loc => 
      loc.country === 'United States' || loc.country === 'USA'
    );
    const hasEUSites = locations.some(loc => 
      ['Germany', 'France', 'Italy', 'Spain', 'United Kingdom', 'Netherlands', 
       'Belgium', 'Switzerland', 'Austria', 'Denmark', 'Sweden', 'Norway', 
       'Finland', 'Poland'].includes(loc.country)
    );

    // Extract all interventions with full details
    const interventions = (armsModule.interventions || []).map(intervention => ({
      type: intervention.type,
      name: intervention.name,
      description: intervention.description,
      armGroupLabels: intervention.armGroupLabels,
      otherNames: intervention.otherNames
    }));

    // Extract drug-specific interventions for molecule analysis
    const drugInterventions = interventions.filter(i => 
      i.type === 'Drug' || i.type === 'Biological' || i.type === 'Combination Product'
    );

    // Extract outcomes with full descriptions
    const primaryOutcomes = (outcomesModule.primaryOutcomes || []).map(outcome => ({
      measure: outcome.measure,
      description: outcome.description,
      timeFrame: outcome.timeFrame
    }));

    const secondaryOutcomes = (outcomesModule.secondaryOutcomes || []).map(outcome => ({
      measure: outcome.measure,
      description: outcome.description,
      timeFrame: outcome.timeFrame
    }));

    // Extract eligibility criteria
    const eligibilityCriteria = {
      criteria: eligibilityModule.eligibilityCriteria,
      gender: eligibilityModule.sex,
      minimumAge: eligibilityModule.minimumAge,
      maximumAge: eligibilityModule.maximumAge,
      healthyVolunteers: eligibilityModule.healthyVolunteers === 'Yes',
      stdAge: eligibilityModule.stdAge // Standard age groups
    };

    // Extract collaborators
    const collaborators = (sponsorModule.collaborators || []).map(c => ({
      name: c.name,
      class: c.class
    }));

    // Extract references/publications
    const references = (referencesModule.references || []).map(ref => ({
      pmid: ref.pmid,
      type: ref.type,
      citation: ref.citation
    }));

    // Extract responsible party info for contact purposes
    const responsibleParty = sponsorModule.responsibleParty || {};
    
    // Build comprehensive trial data object
    return {
      // Core identifiers
      registry: 'ClinicalTrials.gov',
      trialId: identificationModule.nctId,
      orgStudyId: identificationModule.orgStudyIdInfo?.orgStudyId,
      secondaryIds: identificationModule.secondaryIdInfos?.map(id => id.secondaryId),
      
      // Titles and descriptions
      title: identificationModule.officialTitle || identificationModule.briefTitle,
      briefTitle: identificationModule.briefTitle,
      acronym: identificationModule.acronym,
      briefSummary: descriptionModule.briefSummary,
      detailedDescription: descriptionModule.detailedDescription,
      
      // Phase and status
      phase: (designModule.phases || []).join(', '),
      status: statusModule.overallStatus,
      whyStopped: statusModule.whyStopped,
      hasResults: statusModule.hasResults,
      
      // Dates
      startDate: statusModule.startDateStruct?.date,
      startDateType: statusModule.startDateType,
      completionDate: statusModule.completionDateStruct?.date,
      completionDateType: statusModule.completionDateType,
      firstPosted: statusModule.studyFirstPostDateStruct?.date,
      resultsFirstPosted: statusModule.resultsFirstPostDateStruct?.date,
      lastUpdate: statusModule.lastUpdatePostDateStruct?.date,
      
      // Sponsor information
      sponsor: sponsorModule.leadSponsor?.name,
      sponsorClass: sponsorModule.leadSponsor?.class,
      collaborators: collaborators,
      responsibleParty: {
        type: responsibleParty.type,
        investigatorFullName: responsibleParty.investigatorFullName,
        investigatorTitle: responsibleParty.investigatorTitle,
        investigatorAffiliation: responsibleParty.investigatorAffiliation,
        oldNameTitle: responsibleParty.oldNameTitle,
        oldOrganization: responsibleParty.oldOrganization
      },
      
      // Interventions (drugs/molecules)
      interventions: interventions,
      drugInterventions: drugInterventions,
      
      // Conditions and therapeutic areas
      conditions: conditionsModule.conditions || [],
      keywords: conditionsModule.keywords || [],
      
      // Study design
      studyType: designModule.studyType,
      allocation: designModule.allocation,
      interventionModel: designModule.interventionModel,
      primaryPurpose: designModule.primaryPurpose,
      masking: designModule.masking,
      whoMasked: designModule.whoMasked,
      
      // Enrollment
      enrollment: designModule.enrollmentInfo?.count,
      enrollmentType: designModule.enrollmentInfo?.type,
      targetDuration: designModule.targetDuration,
      
      // Outcomes
      primaryOutcomes: primaryOutcomes,
      secondaryOutcomes: secondaryOutcomes,
      
      // Eligibility
      eligibility: eligibilityCriteria,
      
      // Locations
      locations: locations,
      hasUSSites: hasUSSites,
      hasEUSites: hasEUSites,
      locationCountries: [...new Set(locations.map(l => l.country))].filter(Boolean),
      totalSites: locations.length,
      recruitingSites: locations.filter(l => l.status === 'Recruiting').length,
      
      // Regulatory
      isFDARegulated: oversightModule.isFDARegulated,
      isFDARegulatedDrug: oversightModule.isFDARegulatedDrug,
      isFDARegulatedDevice: oversightModule.isFDARegulatedDevice,
      hasDataMonitoringCommittee: oversightModule.hasDataMonitoringCommittee,
      
      // References
      references: references,
      
      // Data sharing
      ipdSharing: oversightModule.ipdSharing,
      ipdSharingDescription: oversightModule.ipdSharingDescription,
      ipdSharingUrl: oversightModule.ipdSharingUrl,
      
      // Additional metadata
      lastKnownStatus: statusModule.lastKnownStatus,
      verificationDate: statusModule.verificationDate,
      expandedAccessInfo: statusModule.expandedAccessInfo,
      
      // Computed fields for scoring
      daysActive: statusModule.startDateStruct?.date ? 
        dayjs().diff(dayjs(statusModule.startDateStruct.date), 'day') : null,
      isRecentlyPosted: statusModule.studyFirstPostDateStruct?.date ?
        dayjs(statusModule.studyFirstPostDateStruct.date).isAfter(dayjs().subtract(30, 'day')) : false,
      isActivelyRecruiting: statusModule.overallStatus === 'Recruiting' || 
                           statusModule.overallStatus === 'Not yet recruiting'
    };
  }
}

// Enhanced PubChem API with comprehensive molecule data
class PubChemAPI {
  static async fetchRecentSubstances(options = {}) {
    const { days = 7, limit = 100 } = options;
    const substances = [];
    
    try {
      const sinceDate = dayjs().subtract(days, 'day').format('YYYY/MM/DD');
      const maxDate = dayjs().format('YYYY/MM/DD');
      
      // First, search for recent substances
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`;
      const searchParams = {
        db: 'pcsubstance',
        retmode: 'json',
        retmax: limit,
        sort: 'datemodified',
        term: 'all[sb]',
        datetype: 'mdat',
        mindate: sinceDate,
        maxdate: maxDate
      };

      const searchResponse = await politeGet(searchUrl, { params: searchParams });
      if (!searchResponse) {
        console.log('Failed to fetch PubChem search results');
        return substances;
      }
      
      const sids = searchResponse.data?.esearchresult?.idlist || [];
      console.log(`Found ${sids.length} recent PubChem substances`);
      
      // Batch fetch substance details using efetch for efficiency
      for (let i = 0; i < sids.length; i += 10) {
        const batch = sids.slice(i, i + 10);
        const batchData = await this.fetchSubstanceBatch(batch);
        substances.push(...batchData);
        await sleep(500); // Rate limiting
      }
      
    } catch (error) {
      console.error('Error in PubChem search:', error.message);
    }
    
    console.log(`Successfully fetched ${substances.length} substances with comprehensive data`);
    return substances;
  }

  static async fetchSubstanceBatch(sids) {
    const substances = [];
    
    for (const sid of sids) {
      try {
        const details = await this.getComprehensiveSubstanceDetails(sid);
        if (details) {
          substances.push(details);
          console.log(`Fetched comprehensive data for SID ${sid}: ${details.depositor}`);
        }
      } catch (err) {
        console.error(`Error fetching substance ${sid}:`, err.message);
      }
      await sleep(200); // Be polite to PubChem
    }
    
    return substances;
  }

  static async getComprehensiveSubstanceDetails(sid) {
    try {
      // Get substance details
      const substanceUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/JSON`;
      const substanceResponse = await politeGet(substanceUrl);
      
      if (!substanceResponse) return null;
      
      const substance = substanceResponse.data?.PC_Substances?.[0];
      if (!substance) return null;
      
      // Extract comprehensive substance information
      const sourceInfo = substance.source || substance.sourceinfo?.[0] || {};
      const depositor = sourceInfo.db?.name || 'Unknown';
      const sourceId = sourceInfo.db?.source_id?.str;
      
      // Get submission date and other metadata
      const submissionDate = substance.deposited_date || 
                            substance.source?.db?.date?.std?.year ? 
                            `${substance.source.db.date.std.year}-${substance.source.db.date.std.month}-${substance.source.db.date.std.day}` : 
                            new Date().toISOString();
      
      // Get associated compounds with full details
      let compounds = [];
      try {
        const cidUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/cids/JSON`;
        const cidResponse = await politeGet(cidUrl);
        if (cidResponse) {
          const cidInfo = cidResponse.data?.InformationList?.Information?.[0];
          let cids = cidInfo?.CID || [];
          if (!Array.isArray(cids)) cids = cids ? [cids] : [];
          
          // Get detailed compound data for each CID
          for (const cid of cids.slice(0, 5)) { // Limit to 5 compounds per substance
            const compoundData = await this.getCompoundDetails(cid);
            if (compoundData) {
              compounds.push(compoundData);
            }
          }
        }
      } catch (err) {
        console.log(`No compounds found for SID ${sid}`);
      }
      
      // Get bioassay data if available
      let bioassayData = null;
      try {
        const bioassayUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/assaysummary/JSON`;
        const bioassayResponse = await politeGet(bioassayUrl);
        if (bioassayResponse) {
          bioassayData = {
            totalAssays: bioassayResponse.data?.Table?.Row?.length || 0,
            activeAssays: bioassayResponse.data?.Table?.Row?.filter(r => r.Cell?.[3]?.toUpperCase() === 'ACTIVE').length || 0
          };
        }
      } catch (err) {
        // Bioassay data might not be available
      }
      
      // Get patent information if available
      let patents = [];
      try {
        const patentUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/xrefs/PatentID/JSON`;
        const patentResponse = await politeGet(patentUrl);
        if (patentResponse) {
          const patentList = patentResponse.data?.InformationList?.Information?.[0]?.PatentID || [];
          patents = Array.isArray(patentList) ? patentList : [patentList];
        }
      } catch (err) {
        // Patents might not be available
      }
      
      // Get synonyms
      let synonyms = [];
      try {
        const synonymUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sid/${sid}/synonyms/JSON`;
        const synonymResponse = await politeGet(synonymUrl);
        if (synonymResponse) {
          const synonymList = synonymResponse.data?.InformationList?.Information?.[0]?.Synonym || [];
          synonyms = Array.isArray(synonymList) ? synonymList.slice(0, 10) : [synonymList];
        }
      } catch (err) {
        // Synonyms might not be available
      }
      
      return {
        sid: sid.toString(),
        depositor: depositor,
        sourceId: sourceId,
        submissionDate: submissionDate,
        compounds: compounds,
        compoundCount: compounds.length,
        synonyms: synonyms,
        patents: patents,
        patentCount: patents.length,
        bioassayData: bioassayData,
        hasActiveCompounds: compounds.some(c => c.isActive),
        hasDrugLikeProperties: compounds.some(c => c.drugLikeness),
        therapeuticPotential: this.assessTherapeuticPotential(compounds, bioassayData, patents),
        depositorType: this.classifyDepositor(depositor),
        isPharmaceuticalRelevant: this.isPharmaceuticallyRelevant(depositor, compounds)
      };
    } catch (error) {
      console.error(`Error getting comprehensive details for SID ${sid}:`, error.message);
      return null;
    }
  }

  static async getCompoundDetails(cid) {
    try {
      // Get comprehensive compound properties
      const propsUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/` +
                      `MolecularFormula,MolecularWeight,CanonicalSMILES,InChI,InChIKey,` +
                      `IUPACName,Title,XLogP,TPSA,Complexity,HBondDonorCount,HBondAcceptorCount,` +
                      `RotatableBondCount,HeavyAtomCount,IsomericSMILES,MonoisotopicMass/JSON`;
      
      const propsResponse = await politeGet(propsUrl);
      if (!propsResponse) return null;
      
      const properties = propsResponse.data?.PropertyTable?.Properties?.[0] || {};
      
      // Get pharmacological classification
      let pharmacology = null;
      try {
        const pharmaUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/classification/JSON`;
        const pharmaResponse = await politeGet(pharmaUrl);
        if (pharmaResponse) {
          pharmacology = pharmaResponse.data?.Hierarchies?.Hierarchy || [];
        }
      } catch (err) {
        // Pharmacology data might not be available
      }
      
      // Assess drug-likeness using Lipinski's Rule of Five
      const drugLikeness = this.assessDrugLikeness(properties);
      
      return {
        cid: cid.toString(),
        name: properties.Title || properties.IUPACName,
        molecularFormula: properties.MolecularFormula,
        molecularWeight: properties.MolecularWeight,
        smiles: properties.CanonicalSMILES,
        isomericSmiles: properties.IsomericSMILES,
        inchi: properties.InChI,
        inchiKey: properties.InChIKey,
        iupacName: properties.IUPACName,
        
        // Physicochemical properties
        xLogP: properties.XLogP,
        tpsa: properties.TPSA,
        complexity: properties.Complexity,
        hBondDonorCount: properties.HBondDonorCount,
        hBondAcceptorCount: properties.HBondAcceptorCount,
        rotatableBondCount: properties.RotatableBondCount,
        heavyAtomCount: properties.HeavyAtomCount,
        monoisotopicMass: properties.MonoisotopicMass,
        
        // Drug-likeness assessment
        drugLikeness: drugLikeness,
        lipinskiViolations: drugLikeness.violations,
        isLeadLike: drugLikeness.isLeadLike,
        
        // Pharmacological classification
        pharmacology: pharmacology,
        
        // Structure availability
        structureAvailable: !!properties.CanonicalSMILES,
        
        // Activity prediction
        isActive: properties.MolecularWeight && properties.MolecularWeight < 900
      };
    } catch (error) {
      console.error(`Error getting compound details for CID ${cid}:`, error.message);
      return null;
    }
  }

  static assessDrugLikeness(properties) {
    const violations = [];
    
    // Lipinski's Rule of Five
    if (properties.MolecularWeight > 500) violations.push('MW > 500');
    if (properties.XLogP > 5) violations.push('LogP > 5');
    if (properties.HBondDonorCount > 5) violations.push('HBD > 5');
    if (properties.HBondAcceptorCount > 10) violations.push('HBA > 10');
    
    // Additional drug-like properties
    const isLeadLike = properties.MolecularWeight <= 350 && 
                       properties.XLogP <= 3.5 &&
                       properties.RotatableBondCount <= 7;
    
    return {
      passesRuleOfFive: violations.length <= 1, // Allow 1 violation
      violations: violations,
      isLeadLike: isLeadLike,
      molecularWeight: properties.MolecularWeight,
      logP: properties.XLogP,
      tpsa: properties.TPSA,
      rotatable: properties.RotatableBondCount
    };
  }

  static assessTherapeuticPotential(compounds, bioassayData, patents) {
    let score = 0;
    
    // Has drug-like compounds
    if (compounds.some(c => c.drugLikeness?.passesRuleOfFive)) score += 30;
    
    // Has bioassay activity
    if (bioassayData?.activeAssays > 0) score += 25;
    
    // Has patents (indicates commercial interest)
    if (patents.length > 0) score += 20;
    
    // Multiple compounds (compound series)
    if (compounds.length > 1) score += 15;
    
    // Lead-like compounds
    if (compounds.some(c => c.drugLikeness?.isLeadLike)) score += 10;
    
    return {
      score: score,
      rating: score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low',
      factors: {
        hasDrugLike: compounds.some(c => c.drugLikeness?.passesRuleOfFive),
        hasBioactivity: bioassayData?.activeAssays > 0,
        hasPatents: patents.length > 0,
        hasMultipleCompounds: compounds.length > 1,
        hasLeadLike: compounds.some(c => c.drugLikeness?.isLeadLike)
      }
    };
  }

  static classifyDepositor(depositor) {
    if (!depositor || depositor === 'Unknown') return 'unknown';
    
    const depositorLower = depositor.toLowerCase();
    
    // Academic institutions
    if (/university|college|institute|academia|school/i.test(depositor)) {
      return 'academic';
    }
    
    // Government/nonprofit
    if (/nih|ncats|government|foundation|nonprofit/i.test(depositor)) {
      return 'government';
    }
    
    // Vendors/suppliers
    if (/enamine|chembridge|sigma|aldrich|mcule|molport|chemspace|zinc/i.test(depositor)) {
      return 'vendor';
    }
    
    // Pharmaceutical/biotech
    if (/pharma|therapeutics|bio|sciences|drug|medicine|discovery/i.test(depositor)) {
      return 'pharmaceutical';
    }
    
    return 'commercial';
  }

  static isPharmaceuticallyRelevant(depositor, compounds) {
    // Check if depositor is relevant
    const depositorType = this.classifyDepositor(depositor);
    if (depositorType === 'vendor') return false;
    
    // Check if compounds have drug-like properties
    const hasDrugLike = compounds.some(c => c.drugLikeness?.passesRuleOfFive);
    
    // Check molecular weight range (typical for drugs)
    const hasReasonableMW = compounds.some(c => 
      c.molecularWeight >= 150 && c.molecularWeight <= 900
    );
    
    return hasDrugLike || hasReasonableMW;
  }

  static async enrichMolecule(name) {
    try {
      // Search by name first
      const searchUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/cids/JSON`;
      const searchResponse = await politeGet(searchUrl);
      
      if (!searchResponse || !searchResponse.data?.IdentifierList?.CID?.[0]) {
        // Try synonym search if direct name search fails
        const synonymUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/synonym/${encodeURIComponent(name)}/cids/JSON`;
        const synonymResponse = await politeGet(synonymUrl);
        
        if (!synonymResponse || !synonymResponse.data?.IdentifierList?.CID?.[0]) {
          return null;
        }
        
        const cid = synonymResponse.data.IdentifierList.CID[0];
        return await this.getCompoundDetails(cid);
      }

      const cid = searchResponse.data.IdentifierList.CID[0];
      return await this.getCompoundDetails(cid);
      
    } catch (error) {
      console.error(`Error enriching molecule ${name}:`, error.message);
      return null;
    }
  }
}

// Export the enhanced classes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ClinicalTrialsAPI,
    PubChemAPI
  };
}

// Enhanced Funding Discovery with comprehensive GPT enrichment - FIXED VERSION
class ComprehensiveEnrichmentService {
  static async enrichCompany(companyName) {
    if (!openai) {
      console.log('OpenAI not configured');
      return null;
    }

    try {
      const prompt = `Research the pharmaceutical/biotech company "${companyName}" and provide comprehensive information.
        
        IMPORTANT: If you cannot find information about this specific company, or if this appears to be an individual person's name rather than a company, return the JSON with null values for unknown fields.
        
        Find ALL available information:
        1. Recent funding rounds (last 3 years) with amounts, dates, and investors
        2. Total funding raised to date
        3. Current employee count and growth trajectory
        4. Recent events (last 6 months): partnerships, clinical trial updates, leadership changes, regulatory milestones
        5. Company website and headquarters location
        6. Key therapeutic areas and pipeline programs
        7. Manufacturing capabilities (do they have GMP facilities?)
        8. Recent press releases or news (last 3 months)
        
        CRITICAL: You MUST respond with ONLY a valid JSON object in this exact format, even if information is not available:
        {
          "domain": "example.com" or null,
          "website": "https://example.com" or null,
          "headquarters": "City, State/Country" or null,
          "employeeCount": number or null,
          "employeeBand": "1-10" | "11-50" | "51-250" | "251-500" | "501-1000" | "1000+" or null,
          "fundingRounds": [
            {
              "date": "YYYY-MM-DD",
              "roundType": "Series A/B/C/etc",
              "amountUSD": number,
              "investors": ["investor1", "investor2"],
              "leadInvestor": "name"
            }
          ] or [],
          "totalFunding": number or null,
          "recentEvents": [
            {
              "date": "YYYY-MM-DD",
              "type": "partnership|trial|regulatory|leadership|other",
              "title": "Event title",
              "description": "Brief description",
              "source": "source URL or name"
            }
          ] or [],
          "therapeuticAreas": ["area1", "area2"] or [],
          "hasGMPFacilities": true/false or null,
          "pipelineHighlights": ["drug1 for indication", "drug2 Phase X"] or [],
          "lastUpdated": "YYYY-MM-DD",
          "sources": ["source1", "source2"] or [],
          "dataAvailable": true/false
        }
        
        DO NOT include any explanatory text, apologies, or anything outside the JSON object.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a pharmaceutical industry research assistant. Always respond with valid JSON only, even if no information is available. Use null values for unknown fields. Never include explanatory text outside the JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });

      const response = completion.choices[0].message.content;
      
      try {
        // Try to extract JSON even if there's extra text
        let jsonStr = response;
        
        // If response contains markdown code blocks, extract the JSON
        if (response.includes('```json')) {
          const match = response.match(/```json\s*([\s\S]*?)\s*```/);
          if (match) jsonStr = match[1];
        } else if (response.includes('```')) {
          const match = response.match(/```\s*([\s\S]*?)\s*```/);
          if (match) jsonStr = match[1];
        }
        
        // Try to find JSON object in the response
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
        
        const data = JSON.parse(jsonStr);
        
        // Check if we actually got data
        if (!data.dataAvailable && !data.fundingRounds?.length && !data.employeeCount) {
          console.log(`Limited data available for ${companyName}`);
        } else {
          console.log(`Successfully enriched ${companyName} with comprehensive data`);
        }
        
        return data;
      } catch (parseError) {
        console.error('Could not parse GPT response:', parseError.message);
        console.log('Raw response:', response.substring(0, 200));
        
        // Return minimal valid data structure
        return {
          domain: null,
          website: null,
          headquarters: null,
          employeeCount: null,
          employeeBand: null,
          fundingRounds: [],
          totalFunding: null,
          recentEvents: [],
          therapeuticAreas: [],
          hasGMPFacilities: null,
          pipelineHighlights: [],
          lastUpdated: new Date().toISOString().split('T')[0],
          sources: [],
          dataAvailable: false
        };
      }
    } catch (error) {
      console.error('Error in comprehensive enrichment:', error.message);
      
      // Return minimal valid data structure on error
      return {
        domain: null,
        website: null,
        headquarters: null,
        employeeCount: null,
        employeeBand: null,
        fundingRounds: [],
        totalFunding: null,
        recentEvents: [],
        therapeuticAreas: [],
        hasGMPFacilities: null,
        pipelineHighlights: [],
        lastUpdated: new Date().toISOString().split('T')[0],
        sources: [],
        dataAvailable: false
      };
    }
  }
}


// Smart AI Enrichment that handles both companies and individuals
class SmartEnrichmentService {
  static async identifyAndEnrich(entityName) {
    if (!openai) {
      console.log('OpenAI not configured');
      return null;
    }

    try {
      // First, identify what type of entity this is
      const entityType = await this.identifyEntityType(entityName);
      console.log(`Identified ${entityName} as: ${entityType.type}`);

      if (entityType.type === 'individual') {
        // For individuals, try to find their company affiliation
        return await this.enrichIndividual(entityName, entityType);
      } else {
        // For companies, do full enrichment
        return await this.enrichCompany(entityName, entityType);
      }
    } catch (error) {
      console.error('Smart enrichment error:', error);
      return null;
    }
  }

  static async identifyEntityType(entityName) {
    try {
      const prompt = `Analyze this name: "${entityName}"

      Determine if this is:
      1. A company/organization name
      2. An individual person's name
      3. A research group or academic lab
      
      If it's an individual, try to identify:
      - Their likely role (researcher, executive, etc.)
      - Any known company affiliations
      - Their field of expertise
      
      Respond with ONLY this JSON structure:
      {
        "type": "company" | "individual" | "research_group",
        "confidence": 0.0 to 1.0,
        "details": {
          "fullName": "the full name",
          "isAcademic": true/false,
          "likelyRole": "CEO/Researcher/Professor/etc",
          "possibleAffiliations": ["company1", "company2"],
          "field": "pharmaceutical/biotech/academic/etc",
          "notes": "any relevant context"
        }
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an entity identification specialist. Analyze names and determine if they are companies or individuals."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      const response = completion.choices[0].message.content;
      return JSON.parse(response);
    } catch (error) {
      console.error('Entity identification error:', error);
      return { type: 'unknown', confidence: 0, details: {} };
    }
  }

  static async enrichIndividual(personName, entityInfo) {
    try {
      const prompt = `Research the individual "${personName}" in the pharmaceutical/biotech context.
      
      ${entityInfo.details?.notes ? `Context: ${entityInfo.details.notes}` : ''}
      
      Find any available information about:
      1. Their current company or institution
      2. Their role and responsibilities
      3. Recent publications or patents
      4. Conference presentations or speaking engagements
      5. Professional background and expertise
      6. LinkedIn profile or professional contacts
      7. Any companies they've founded or are affiliated with
      
      If they are affiliated with a company, provide full details about that company including:
      - Company funding history
      - Employee count
      - Recent developments
      - Pipeline/products
      
      RESPOND WITH ONLY VALID JSON:
      {
        "entityType": "individual",
        "person": {
          "name": "${personName}",
          "title": "their title",
          "currentCompany": "company name",
          "role": "specific role",
          "expertise": ["area1", "area2"],
          "linkedinUrl": "url or null",
          "email": "email or null",
          "recentActivity": [
            {
              "date": "YYYY-MM-DD",
              "type": "publication/patent/presentation",
              "description": "brief description"
            }
          ]
        },
        "affiliatedCompany": {
          "name": "company name",
          "domain": "domain.com",
          "website": "https://...",
          "employeeCount": number,
          "employeeBand": "range",
          "fundingRounds": [
            {
              "date": "YYYY-MM-DD",
              "roundType": "Series X",
              "amountUSD": number,
              "investors": ["investor1"],
              "leadInvestor": "name"
            }
          ],
          "recentEvents": [],
          "therapeuticAreas": [],
          "hasGMPFacilities": true/false/null,
          "pipeline": []
        },
        "dataAvailable": true/false,
        "sources": ["source1", "source2"]
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a pharmaceutical industry researcher. Find information about individuals and their company affiliations. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });

      const response = completion.choices[0].message.content;
      const data = JSON.parse(this.extractJSON(response));
      
      console.log(`Found individual ${personName} affiliated with ${data.affiliatedCompany?.name || 'unknown company'}`);
      return data;
      
    } catch (error) {
      console.error('Individual enrichment error:', error);
      return {
        entityType: 'individual',
        person: { name: personName },
        affiliatedCompany: null,
        dataAvailable: false
      };
    }
  }

  static async enrichCompany(companyName, entityInfo) {
    try {
      const prompt = `Research the pharmaceutical/biotech entity "${companyName}".
      
      ${entityInfo.details?.notes ? `Context: ${entityInfo.details.notes}` : ''}
      
      This might be a company, research group, or subsidiary. Find ALL available information:
      
      1. Company Overview:
         - Full legal name and any DBAs
         - Website and headquarters
         - Parent company (if subsidiary)
         - Year founded
         - Company type (public/private/subsidiary)
      
      2. Funding & Financials:
         - ALL funding rounds with dates, amounts, investors
         - Total funding to date
         - Current valuation if available
         - Revenue (if public or disclosed)
      
      3. Personnel:
         - Current employee count and growth
         - Key executives (CEO, CSO, CMO, etc.) with names
         - Board members
         - Scientific advisors
      
      4. Pipeline & Products:
         - Current drug candidates with phases
         - Therapeutic areas of focus
         - Technology platforms
         - Approved products (if any)
      
      5. Recent Activity (last 12 months):
         - Clinical trial initiations
         - Partnerships and collaborations
         - Leadership changes
         - Regulatory milestones
         - Publications or presentations
      
      6. Manufacturing:
         - Internal GMP capabilities
         - Manufacturing partners/CDMOs used
         - Facility locations
      
      7. Intellectual Property:
         - Recent patents filed
         - Patent portfolio size
      
      RESPOND WITH ONLY VALID JSON:
      {
        "entityType": "company",
        "company": {
          "name": "full name",
          "legalName": "legal entity name",
          "domain": "domain.com",
          "website": "https://...",
          "headquarters": "City, Country",
          "foundedYear": YYYY,
          "companyType": "private/public/subsidiary",
          "parentCompany": "name or null",
          "stockSymbol": "SYMBOL or null"
        },
        "financials": {
          "totalFunding": number,
          "lastValuation": number or null,
          "fundingRounds": [
            {
              "date": "YYYY-MM-DD",
              "roundType": "Series X",
              "amountUSD": number,
              "investors": ["investor1", "investor2"],
              "leadInvestor": "name",
              "postMoneyValuation": number or null
            }
          ],
          "revenue": number or null,
          "burnRate": number or null
        },
        "personnel": {
          "employeeCount": number,
          "employeeBand": "1-50",
          "growthRate": "X% YoY",
          "executives": [
            {
              "name": "John Doe",
              "title": "CEO",
              "linkedinUrl": "url",
              "previousCompany": "previous"
            }
          ],
          "boardMembers": ["name1", "name2"],
          "advisors": ["name1", "name2"]
        },
        "pipeline": [
          {
            "name": "Drug-123",
            "indication": "disease",
            "phase": "Preclinical/Phase 1/2/3",
            "modality": "small molecule/antibody/etc",
            "target": "target",
            "expectedMilestone": "Phase X by Q2 2024"
          }
        ],
        "recentActivity": [
          {
            "date": "YYYY-MM-DD",
            "type": "trial/partnership/funding/regulatory",
            "title": "Event title",
            "description": "Detailed description",
            "impact": "high/medium/low"
          }
        ],
        "manufacturing": {
          "hasGMPFacilities": true/false,
          "facilities": ["location1"],
          "cdmoPartners": ["CDMO1", "CDMO2"],
          "manufacturingStrategy": "outsourced/hybrid/internal"
        },
        "intellectualProperty": {
          "patentCount": number,
          "recentPatents": [
            {
              "title": "patent title",
              "filingDate": "YYYY-MM-DD",
              "abstract": "brief description"
            }
          ]
        },
        "therapeuticAreas": ["oncology", "neurology"],
        "competitiveAdvantages": ["advantage1", "advantage2"],
        "risks": ["risk1", "risk2"],
        "cdmoNeed": {
          "likelihood": "high/medium/low",
          "reasoning": "explanation",
          "timeline": "Q1 2024"
        },
        "dataQuality": {
          "completeness": 0.0 to 1.0,
          "lastUpdated": "YYYY-MM-DD",
          "sources": ["source1", "source2"]
        }
      }`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a pharmaceutical business intelligence expert. Provide comprehensive, accurate data about companies. Always respond with valid JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 3000
      });

      const response = completion.choices[0].message.content;
      const data = JSON.parse(this.extractJSON(response));
      
      console.log(`Successfully enriched ${companyName} with comprehensive data`);
      return data;
      
    } catch (error) {
      console.error('Company enrichment error:', error);
      return {
        entityType: 'company',
        company: { name: companyName },
        financials: { fundingRounds: [] },
        dataQuality: { completeness: 0 }
      };
    }
  }

  static extractJSON(text) {
    // Try to extract JSON from the response
    let jsonStr = text;
    
    // Remove markdown code blocks
    if (text.includes('```json')) {
      const match = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (match) jsonStr = match[1];
    } else if (text.includes('```')) {
      const match = text.match(/```\s*([\s\S]*?)\s*```/);
      if (match) jsonStr = match[1];
    }
    
    // Find JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    return jsonStr;
  }
}

// Update the main enrichment endpoint to use smart enrichment
async function enhancedEnrichmentEndpoint(companyId) {
  try {
    const company = await Company.findById(companyId);
    if (!company) {
      throw new Error('Company not found');
    }

    console.log(`Starting smart enrichment for ${company.name}...`);
    
    // Use smart enrichment that handles any entity type
    const enrichmentData = await SmartEnrichmentService.identifyAndEnrich(company.name);
    
    if (!enrichmentData) {
      return { success: false, message: 'Could not enrich entity' };
    }

    // Handle different entity types
    if (enrichmentData.entityType === 'individual') {
      // This is a person - update with their affiliated company if found
      if (enrichmentData.affiliatedCompany?.name) {
        console.log(`${company.name} is an individual affiliated with ${enrichmentData.affiliatedCompany.name}`);
        
        // Update the company record with the actual company data
        company.name = enrichmentData.affiliatedCompany.name;
        company.domain = enrichmentData.affiliatedCompany.domain;
        company.website = enrichmentData.affiliatedCompany.website;
        company.employeeCount = enrichmentData.affiliatedCompany.employeeCount;
        
        // Add the person as a contact
        await Contact.create({
          company: company._id,
          name: enrichmentData.person.name,
          title: enrichmentData.person.title || enrichmentData.person.role,
          email: enrichmentData.person.email,
          linkedinUrl: enrichmentData.person.linkedinUrl,
          source: 'AI Enrichment'
        });
      }
    } else {
      // This is a company - process normally
      const companyData = enrichmentData.company;
      const financials = enrichmentData.financials;
      const personnel = enrichmentData.personnel;
      
      // Update company with all enriched data
      if (companyData) {
        company.domain = companyData.domain || company.domain;
        company.website = companyData.website || company.website;
        company.headquarters = companyData.headquarters || company.headquarters;
        company.foundedYear = companyData.foundedYear || company.foundedYear;
      }
      
      if (personnel) {
        company.employeeCount = personnel.employeeCount || company.employeeCount;
        company.employeeBand = personnel.employeeBand || company.employeeBand;
      }
      
      if (enrichmentData.manufacturing) {
        company.hasInternalGMP = enrichmentData.manufacturing.hasGMPFacilities;
      }
      
      company.recentEvents = enrichmentData.recentActivity || [];
      company.lastEnriched = new Date();
      await company.save();
      
      // Add funding rounds
      if (financials?.fundingRounds) {
        for (const round of financials.fundingRounds) {
          await Funding.findOneAndUpdate(
            { company: company._id, date: round.date, roundType: round.roundType },
            { ...round, source: 'AI Enrichment' },
            { upsert: true }
          );
        }
      }
      
      // Add executives as contacts
      if (personnel?.executives) {
        for (const exec of personnel.executives) {
          await Contact.findOneAndUpdate(
            { company: company._id, name: exec.name },
            {
              title: exec.title,
              linkedinUrl: exec.linkedinUrl,
              source: 'AI Enrichment'
            },
            { upsert: true }
          );
        }
      }
      
      // Add pipeline as molecules
      if (enrichmentData.pipeline) {
        for (const drug of enrichmentData.pipeline) {
          await Molecule.findOneAndUpdate(
            { company: company._id, name: drug.name },
            {
              indication: drug.indication,
              developmentStage: drug.phase,
              modality: drug.modality,
              target: drug.target
            },
            { upsert: true }
          );
        }
      }
    }
    
    // Calculate CDMO need score
    const cdmoScore = enrichmentData.cdmoNeed?.likelihood === 'high' ? 90 :
                     enrichmentData.cdmoNeed?.likelihood === 'medium' ? 60 : 30;
    
    return {
      success: true,
      enrichmentType: enrichmentData.entityType,
      dataCompleteness: enrichmentData.dataQuality?.completeness || 0,
      cdmoNeedScore: cdmoScore,
      summary: {
        fundingAdded: enrichmentData.financials?.fundingRounds?.length || 0,
        contactsAdded: enrichmentData.personnel?.executives?.length || 0,
        pipelineAdded: enrichmentData.pipeline?.length || 0,
        eventsAdded: enrichmentData.recentActivity?.length || 0
      }
    };
    
  } catch (error) {
    console.error('Enhanced enrichment error:', error);
    return { success: false, error: error.message };
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SmartEnrichmentService,
    enhancedEnrichmentEndpoint
  };
}


// Enhanced Data Discovery Services with Patents, RSS, and Advanced Analysis



// Patent Search Service using USPTO and other sources
class PatentSearchService {
  static async searchCompanyPatents(companyName, options = {}) {
    const { 
      sinceDays = 365,
      includeApplications = true,
      includeGrants = true
    } = options;
    
    const patents = [];
    
    try {
      // Search USPTO PatentsView API
      const usptoPatents = await this.searchUSPTO(companyName, sinceDays);
      patents.push(...usptoPatents);
      
      // Search European Patent Office
      const epoPatents = await this.searchEPO(companyName, sinceDays);
      patents.push(...epoPatents);
      
      // Search WIPO Global Brand Database
      const wipoPatents = await this.searchWIPO(companyName, sinceDays);
      patents.push(...wipoPatents);
      
      // Analyze patents for pharmaceutical relevance
      const analyzedPatents = await this.analyzePatents(patents);
      
      console.log(`Found ${analyzedPatents.length} patents for ${companyName}`);
      return analyzedPatents;
      
    } catch (error) {
      console.error('Patent search error:', error);
      return patents;
    }
  }
  
  static async searchUSPTO(assignee, sinceDays) {
    try {
      const baseUrl = 'https://api.patentsview.org/patents/query';
      const sinceDate = dayjs().subtract(sinceDays, 'day').format('YYYY-MM-DD');
      
      const query = {
        q: {
          _and: [
            { _begins: { assignee_organization: assignee } },
            { _gte: { patent_date: sinceDate } }
          ]
        },
        f: [
          'patent_number', 'patent_title', 'patent_abstract', 'patent_date',
          'assignee_organization', 'inventor_first_name', 'inventor_last_name',
          'cpc_section', 'cpc_subsection', 'patent_num_claims', 'patent_type',
          'application_number', 'filing_date', 'priority_date',
          'patent_processing_time', 'uspc_mainclass', 'cited_patent_number'
        ],
        s: [{ patent_date: 'desc' }],
        o: { per_page: 100 }
      };
      
      const response = await axios.post(baseUrl, query, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });
      
      const patents = response.data?.patents || [];
      
      return patents.map(p => ({
        source: 'USPTO',
        patentNumber: p.patent_number,
        title: p.patent_title,
        abstract: p.patent_abstract,
        filingDate: p.filing_date,
        grantDate: p.patent_date,
        assignee: p.assignee_organization,
        inventors: this.formatInventors(p),
        claims: p.patent_num_claims,
        classifications: {
          cpc: `${p.cpc_section}${p.cpc_subsection}`,
          uspc: p.uspc_mainclass
        },
        type: p.patent_type,
        processingTime: p.patent_processing_time,
        citedPatents: p.cited_patent_number,
        url: `https://patents.google.com/patent/US${p.patent_number}`
      }));
      
    } catch (error) {
      console.error('USPTO search error:', error);
      return [];
    }
  }
  
  static async searchEPO(applicant, sinceDays) {
    try {
      // EPO OPS API requires authentication
      if (!process.env.EPO_CONSUMER_KEY) return [];
      
      const authUrl = 'https://ops.epo.org/3.2/auth/accesstoken';
      const authResponse = await axios.post(authUrl, 
        'grant_type=client_credentials',
        {
          auth: {
            username: process.env.EPO_CONSUMER_KEY,
            password: process.env.EPO_SECRET_KEY
          },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );
      
      const token = authResponse.data.access_token;
      
      // Search for patents
      const searchUrl = 'https://ops.epo.org/3.2/rest-services/published-data/search';
      const query = `pa="${applicant}" AND pd>=${dayjs().subtract(sinceDays, 'day').format('YYYYMMDD')}`;
      
      const response = await axios.get(searchUrl, {
        params: { q: query, Range: '1-100' },
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      
      // Parse and return EPO patents
      return this.parseEPOResponse(response.data);
      
    } catch (error) {
      console.error('EPO search error:', error);
      return [];
    }
  }
  
  static async analyzePatents(patents) {
    return patents.map(patent => {
      const abstract = (patent.abstract || '').toLowerCase();
      const title = (patent.title || '').toLowerCase();
      const text = title + ' ' + abstract;
      
      // Pharmaceutical relevance scoring
      const pharmaKeywords = {
        high: [
          'pharmaceutical', 'drug', 'therapeutic', 'treatment', 'clinical',
          'formulation', 'compound', 'antibody', 'vaccine', 'gene therapy',
          'cell therapy', 'biologics', 'biosimilar', 'monoclonal'
        ],
        medium: [
          'synthesis', 'purification', 'crystallization', 'process',
          'manufacture', 'production', 'scale-up', 'gmp', 'quality',
          'stability', 'bioavailability', 'pharmacokinetic'
        ],
        low: [
          'diagnostic', 'assay', 'screening', 'biomarker', 'target',
          'pathway', 'mechanism', 'receptor', 'enzyme', 'protein'
        ]
      };
      
      let relevanceScore = 0;
      let relevanceFactors = [];
      
      pharmaKeywords.high.forEach(keyword => {
        if (text.includes(keyword)) {
          relevanceScore += 10;
          relevanceFactors.push(keyword);
        }
      });
      
      pharmaKeywords.medium.forEach(keyword => {
        if (text.includes(keyword)) {
          relevanceScore += 5;
          relevanceFactors.push(keyword);
        }
      });
      
      pharmaKeywords.low.forEach(keyword => {
        if (text.includes(keyword)) {
          relevanceScore += 2;
          relevanceFactors.push(keyword);
        }
      });
      
      // Check for process chemistry relevance
      const processChemistry = /process|synthesis|manufacture|crystalliz|purif|scale/i.test(text);
      const drugDelivery = /formulat|delivery|dosage|release|bioavailab/i.test(text);
      const novelCompound = /novel|new|compound|molecule|derivative|analog/i.test(text);
      
      return {
        ...patent,
        pharmaceuticalRelevance: relevanceScore,
        relevanceLevel: relevanceScore >= 30 ? 'High' : relevanceScore >= 15 ? 'Medium' : 'Low',
        relevanceFactors: [...new Set(relevanceFactors)],
        isProcessChemistry: processChemistry,
        isDrugDelivery: drugDelivery,
        isNovelCompound: novelCompound,
        cdmoRelevant: processChemistry || drugDelivery
      };
    });
  }
  
  static formatInventors(patent) {
    const inventors = [];
    if (patent.inventor_first_name && patent.inventor_last_name) {
      // Handle multiple inventors if they're arrays
      if (Array.isArray(patent.inventor_first_name)) {
        for (let i = 0; i < patent.inventor_first_name.length; i++) {
          inventors.push(`${patent.inventor_first_name[i]} ${patent.inventor_last_name[i]}`);
        }
      } else {
        inventors.push(`${patent.inventor_first_name} ${patent.inventor_last_name}`);
      }
    }
    return inventors;
  }
}

// RSS Feed Monitor for News and Funding Announcements
class RSSFeedMonitor {
  constructor() {
    this.parser = new Parser({
      customFields: {
        feed: ['subtitle', 'copyright'],
        item: ['media:content', 'content:encoded', 'category']
      }
    });
    
    this.feeds = [
      // Pharmaceutical news sources
      { url: 'https://www.fiercebiotech.com/rss/xml', category: 'biotech_news' },
      { url: 'https://www.fiercepharma.com/rss/xml', category: 'pharma_news' },
      { url: 'https://www.biopharmadive.com/feeds/news/', category: 'biopharma_news' },
      { url: 'https://endpts.com/feed/', category: 'endpoints_news' },
      { url: 'https://www.biospace.com/rss/', category: 'biospace_news' },
      { url: 'https://www.pharmtech.com/rss', category: 'pharmtech' },
      { url: 'https://www.pharmaceutical-technology.com/feed/', category: 'pharma_tech' },
      { url: 'https://www.drugdiscoverytoday.com/rss', category: 'drug_discovery' },
      
      // Funding and investment feeds
      { url: 'https://www.crunchbase.com/rss', category: 'crunchbase' },
      { url: 'https://www.globenewswire.com/RssFeed/industry/4000/Biotechnology', category: 'biotech_pr' },
      { url: 'https://www.prnewswire.com/rss/biotechnology-pharmaceuticals-news.rss', category: 'pharma_pr' },
      { url: 'https://www.businesswire.com/portal/site/home/news/industries/health/pharmaceutical/', category: 'business_wire' },
      
      // Regulatory and clinical trial news
      { url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/fda-newsroom/rss.xml', category: 'fda_news' },
      { url: 'https://www.ema.europa.eu/en/news-events/rss-feeds', category: 'ema_news' },
      { url: 'https://clinicaltrials.gov/ct2/rss.xml?rcv_d=14&type=Intr&cond=&count=100', category: 'new_trials' },
      
      // Venture capital and investment
      { url: 'https://pitchbook.com/news/rss', category: 'vc_news' },
      { url: 'https://www.venturecapitaljournal.com/rss/', category: 'vc_journal' }
    ];
  }
  
  async scanAllFeeds(keywords = []) {
    const allArticles = [];
    
    for (const feedConfig of this.feeds) {
      try {
        const articles = await this.scanFeed(feedConfig, keywords);
        allArticles.push(...articles);
        await sleep(500); // Be polite between feeds
      } catch (error) {
        console.error(`Error scanning ${feedConfig.category}:`, error.message);
      }
    }
    
    // Deduplicate by title
    const uniqueArticles = this.deduplicateArticles(allArticles);
    
    // Analyze articles for relevant information
    const analyzedArticles = await this.analyzeArticles(uniqueArticles);
    
    return analyzedArticles;
  }
  
  async scanFeed(feedConfig, keywords = []) {
    try {
      const feed = await this.parser.parseURL(feedConfig.url);
      const articles = [];
      
      for (const item of feed.items) {
        const article = {
          title: item.title,
          link: item.link,
          pubDate: item.pubDate || item.isoDate,
          content: item.contentSnippet || item.content || item['content:encoded'] || '',
          category: feedConfig.category,
          source: feed.title,
          guid: item.guid || item.link
        };
        
        // Check if article matches any keywords
        if (keywords.length > 0) {
          const text = `${article.title} ${article.content}`.toLowerCase();
          const matches = keywords.filter(keyword => text.includes(keyword.toLowerCase()));
          if (matches.length > 0) {
            article.matchedKeywords = matches;
            articles.push(article);
          }
        } else {
          articles.push(article);
        }
      }
      
      return articles;
    } catch (error) {
      console.error(`Feed parsing error for ${feedConfig.url}:`, error);
      return [];
    }
  }
  
  async analyzeArticles(articles) {
    return articles.map(article => {
      const text = `${article.title} ${article.content}`.toLowerCase();
      
      // Extract funding information
      const fundingPatterns = [
        /\$(\d+(?:\.\d+)?)\s*(million|m\b)/gi,
        /\$(\d+(?:\.\d+)?)\s*(billion|b\b)/gi,
        /raised\s+\$(\d+(?:\.\d+)?)/gi,
        /funding.*\$(\d+(?:\.\d+)?)/gi,
        /series\s+([a-e])\s+(?:funding|round)/gi,
        /seed\s+(?:funding|round)/gi
      ];
      
      let fundingAmount = null;
      let fundingRound = null;
      
      fundingPatterns.forEach(pattern => {
        const match = pattern.exec(text);
        if (match) {
          if (match[2]) {
            const multiplier = match[2].toLowerCase().startsWith('b') ? 1000000000 : 1000000;
            fundingAmount = parseFloat(match[1]) * multiplier;
          } else if (match[1] && pattern.source.includes('series')) {
            fundingRound = `Series ${match[1].toUpperCase()}`;
          }
        }
      });
      
      // Extract company names
      const companyPatterns = [
        /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:announced|raised|received|secured)/g,
        /(?:company|startup|firm)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g
      ];
      
      const companies = new Set();
      companyPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(article.title)) !== null) {
          companies.add(match[1]);
        }
      });
      
      // Extract drug/molecule mentions
      const drugPatterns = [
        /(?:drug|compound|molecule|antibody|therapeutic)\s+([A-Z]+[-\d]+)/gi,
        /([A-Z]{2,}[-\d]+)\s+(?:showed|demonstrated|achieved)/gi
      ];
      
      const molecules = new Set();
      drugPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          molecules.add(match[1]);
        }
      });
      
      // Detect article type
      const types = [];
      if (fundingAmount || fundingRound) types.push('funding');
      if (/clinical\s+trial|phase\s+[123i]/i.test(text)) types.push('clinical_trial');
      if (/fda|ema|approval|clearance/i.test(text)) types.push('regulatory');
      if (/partnership|collaboration|agreement/i.test(text)) types.push('partnership');
      if (/acquisition|merger|acquire/i.test(text)) types.push('m&a');
      if (/patent/i.test(text)) types.push('patent');
      
      return {
        ...article,
        analysis: {
          fundingAmount,
          fundingRound,
          companies: Array.from(companies),
          molecules: Array.from(molecules),
          types,
          relevanceScore: this.calculateRelevance(text),
          isPhase1Related: /phase\s+1|phase\s+i\b|first.in.human/i.test(text),
          isCDMORelated: /cdmo|contract\s+manufact|cmo\b|outsourc/i.test(text)
        }
      };
    });
  }
  
  calculateRelevance(text) {
    let score = 0;
    
    const highValueTerms = [
      'phase 1', 'first-in-human', 'ind', 'clinical trial',
      'funding', 'raised', 'series', 'investment',
      'cdmo', 'contract manufacturing', 'outsourcing'
    ];
    
    highValueTerms.forEach(term => {
      if (text.includes(term)) score += 10;
    });
    
    const mediumValueTerms = [
      'drug', 'therapeutic', 'antibody', 'molecule',
      'fda', 'ema', 'approval', 'partnership',
      'biotech', 'pharmaceutical'
    ];
    
    mediumValueTerms.forEach(term => {
      if (text.includes(term)) score += 5;
    });
    
    return score;
  }
  
  deduplicateArticles(articles) {
    const seen = new Set();
    return articles.filter(article => {
      const key = article.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// Advanced Funding Discovery Service
class AdvancedFundingDiscovery {
  static async discoverFunding(companyName) {
    const fundingData = [];
    
    try {
      // 1. Search SEC EDGAR for public companies
      const secData = await this.searchSEC(companyName);
      fundingData.push(...secData);
      
      // 2. Search Crunchbase (if API key available)
      if (process.env.CRUNCHBASE_API_KEY) {
        const cbData = await this.searchCrunchbase(companyName);
        fundingData.push(...cbData);
      }
      
      // 3. Search PitchBook (if API access available)
      if (process.env.PITCHBOOK_API_KEY) {
        const pbData = await this.searchPitchBook(companyName);
        fundingData.push(...pbData);
      }
      
      // 4. Scan RSS feeds for funding announcements
      const rssMonitor = new RSSFeedMonitor();
      const articles = await rssMonitor.scanAllFeeds([companyName]);
      const fundingArticles = articles.filter(a => a.analysis.types.includes('funding'));
      
      fundingArticles.forEach(article => {
        if (article.analysis.fundingAmount) {
          fundingData.push({
            date: article.pubDate,
            amountUSD: article.analysis.fundingAmount,
            roundType: article.analysis.fundingRound || 'Unknown',
            source: article.source,
            sourceUrl: article.link,
            confidence: 0.7
          });
        }
      });
      
      // 5. Use AI to find and verify funding
      const aiData = await this.searchWithAI(companyName);
      fundingData.push(...aiData);
      
      // Deduplicate and sort by date
      const uniqueFunding = this.deduplicateFunding(fundingData);
      uniqueFunding.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      return uniqueFunding;
      
    } catch (error) {
      console.error('Advanced funding discovery error:', error);
      return fundingData;
    }
  }
  
  static async searchSEC(companyName) {
    try {
      // SEC EDGAR API
      const baseUrl = 'https://data.sec.gov/submissions/';
      const searchUrl = 'https://www.sec.gov/cgi-bin/browse-edgar';
      
      // First, search for the company CIK
      const searchParams = {
        company: companyName,
        output: 'json',
        action: 'getcompany'
      };
      
      const searchResponse = await axios.get(searchUrl, { params: searchParams });
      
      if (!searchResponse.data?.results?.length) return [];
      
      const cik = searchResponse.data.results[0].cik;
      
      // Get company filings
      const filingResponse = await axios.get(`${baseUrl}CIK${cik.padStart(10, '0')}.json`, {
        headers: {
          'User-Agent': 'PhaseDiscovery/1.0 (research@example.com)'
        }
      });
      
      const filings = filingResponse.data?.filings?.recent || {};
      const fundingData = [];
      
      // Look for S-1, 8-K, and other relevant forms
      const relevantForms = ['S-1', '8-K', '10-K', '10-Q', 'S-3', 'F-1'];
      
      filings.form?.forEach((form, index) => {
        if (relevantForms.includes(form)) {
          // Parse filing for funding information
          const filing = {
            form: form,
            date: filings.filingDate[index],
            accessionNumber: filings.accessionNumber[index],
            primaryDocument: filings.primaryDocument[index]
          };
          
          // You would need to fetch and parse the actual filing document
          // This is a simplified version
          if (form === 'S-1' || form === 'F-1') {
            // IPO filing
            fundingData.push({
              date: filing.date,
              roundType: 'IPO',
              source: 'SEC EDGAR',
              sourceUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accessionNumber}/${filing.primaryDocument}`,
              confidence: 0.95
            });
          }
        }
      });
      
      return fundingData;
      
    } catch (error) {
      console.error('SEC search error:', error);
      return [];
    }
  }
  
  static async searchCrunchbase(companyName) {
    try {
      const apiKey = process.env.CRUNCHBASE_API_KEY;
      const baseUrl = 'https://api.crunchbase.com/v4/entities/organizations';
      
      // Search for company
      const searchResponse = await axios.get(baseUrl, {
        params: {
          user_key: apiKey,
          name: companyName,
          field_ids: 'funding_rounds,funding_total,last_funding_at,last_funding_type'
        },
        headers: { 'X-cb-user-key': apiKey }
      });
      
      const org = searchResponse.data?.entities?.[0];
      if (!org) return [];
      
      // Get detailed funding rounds
      const fundingUrl = `${baseUrl}/${org.properties.identifier.permalink}/funding_rounds`;
      const fundingResponse = await axios.get(fundingUrl, {
        headers: { 'X-cb-user-key': apiKey }
      });
      
      return fundingResponse.data?.entities?.map(round => ({
        date: round.properties.announced_on,
        amountUSD: round.properties.money_raised?.value_usd,
        roundType: round.properties.funding_type,
        leadInvestor: round.properties.lead_investor_identifiers?.[0]?.value,
        investors: round.properties.investor_identifiers?.map(i => i.value),
        source: 'Crunchbase',
        sourceUrl: `https://www.crunchbase.com/funding_round/${round.properties.identifier.permalink}`,
        confidence: 0.9
      })) || [];
      
    } catch (error) {
      console.error('Crunchbase search error:', error);
      return [];
    }
  }
  
  static async searchWithAI(companyName) {
    if (!openai) return [];
    
    try {
      const prompt = `Find all funding rounds for the pharmaceutical/biotech company "${companyName}" from the last 3 years.
        
        Search for:
        1. Seed, Series A/B/C/D/E rounds
        2. IPOs or public offerings
        3. Private placements
        4. Debt financing
        5. Grants and awards
        
        For each round, provide:
        - Date (YYYY-MM-DD format)
        - Amount in USD
        - Round type
        - Lead investor
        - All participating investors
        - Source of information
        
        RESPOND ONLY WITH A JSON ARRAY:
        [
          {
            "date": "YYYY-MM-DD",
            "amountUSD": number,
            "roundType": "string",
            "leadInvestor": "string",
            "investors": ["investor1", "investor2"],
            "source": "source name",
            "confidence": 0.0 to 1.0
          }
        ]`;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a financial research specialist. Provide accurate funding data based on publicly available information."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });
      
      const response = completion.choices[0].message.content;
      
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return data.map(round => ({ ...round, source: round.source || 'AI Research' }));
      }
      
      return [];
      
    } catch (error) {
      console.error('AI funding search error:', error);
      return [];
    }
  }
  
  static deduplicateFunding(fundingData) {
    const seen = new Map();
    
    fundingData.forEach(round => {
      const key = `${round.date}-${round.roundType}-${round.amountUSD || 'unknown'}`;
      const existing = seen.get(key);
      
      if (!existing || round.confidence > existing.confidence) {
        seen.set(key, round);
      }
    });
    
    return Array.from(seen.values());
  }
}

// Comprehensive AI Analysis Service
class ComprehensiveAIAnalysis {
  static async analyzeCompany(companyData) {
    if (!openai) return null;
    
    try {
      const prompt = `Perform a comprehensive analysis of the pharmaceutical company based on this data:
        
        Company: ${companyData.company.name}
        Employees: ${companyData.company.employeeCount || 'Unknown'}
        Founded: ${companyData.company.foundedYear || 'Unknown'}
        
        Clinical Trials: ${companyData.trials?.length || 0} trials
        - Phase 1 trials: ${companyData.trials?.filter(t => t.phase?.includes('Phase 1')).length || 0}
        - Recruiting: ${companyData.trials?.filter(t => t.status === 'Recruiting').length || 0}
        
        Pipeline: ${companyData.molecules?.map(m => `${m.name} (${m.developmentStage})`).join(', ') || 'Unknown'}
        
        Funding: ${companyData.funding?.map(f => `${f.roundType} $${f.amountUSD/1000000}M (${f.date})`).join(', ') || 'No data'}
        
        Patents: ${companyData.patents?.length || 0} recent patents
        
        Provide a comprehensive analysis including:
        
        1. CDMO OPPORTUNITY ASSESSMENT
           - Likelihood to outsource manufacturing (0-100%)
           - Timeline for CDMO need (immediate/6 months/12 months/18+ months)
           - Estimated manufacturing budget
           - Specific services needed (API, formulation, fill-finish, etc.)
           - Decision-making factors
        
        2. COMPETITIVE POSITION
           - Unique advantages
           - Key differentiators
           - Market position
           - Competitive threats
        
        3. FINANCIAL HEALTH
           - Burn rate estimate
           - Runway (months)
           - Ability to pay for services
           - Funding outlook
        
        4. TECHNICAL ASSESSMENT
           - Molecule complexity
           - Manufacturing challenges
           - Regulatory pathway
           - Technical risks
        
        5. BUSINESS DEVELOPMENT STRATEGY
           - Key decision makers to target
           - Optimal approach angle
           - Value propositions to emphasize
           - Potential objections and responses
        
        6. RISK ASSESSMENT
           - Program risks
           - Financial risks
           - Competitive risks
           - Regulatory risks
        
        7. PARTNERSHIP READINESS
           - Current partnerships
           - Partnership needs
           - Deal structure preferences
        
        Format as JSON with numerical scores where applicable.`;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a pharmaceutical industry expert consultant specializing in CDMO business development and competitive intelligence."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.4,
        max_tokens: 3000
      });
      
      const response = completion.choices[0].message.content;
      
      // Parse the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return null;
      
    } catch (error) {
      console.error('Comprehensive analysis error:', error);
      return null;
    }
  }
}

// Add these to your main server endpoints:

// Search patents endpoint
app.post('/api/patents/search', async (req, res) => {
  try {
    const { companyName, sinceDays = 365 } = req.body;
    
    console.log(`Searching patents for ${companyName}...`);
    const patents = await PatentSearchService.searchCompanyPatents(companyName, { sinceDays });
    
    // Store relevant patents in database
    for (const patent of patents.filter(p => p.pharmaceuticalRelevance > 10)) {
      await Patent.findOneAndUpdate(
        { patentNumber: patent.patentNumber },
        {
          ...patent,
          company: req.body.companyId
        },
        { upsert: true }
      );
    }
    
    res.json({
      success: true,
      count: patents.length,
      relevant: patents.filter(p => p.pharmaceuticalRelevance > 10).length,
      patents
    });
    
  } catch (error) {
    console.error('Patent search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// RSS feed scanning endpoint
app.post('/api/news/scan', async (req, res) => {
  try {
    const { keywords = [], categories = [] } = req.body;
    
    console.log('Scanning RSS feeds...');
    const monitor = new RSSFeedMonitor();
    const articles = await monitor.scanAllFeeds(keywords);
    
    // Filter by categories if specified
    let filtered = articles;
    if (categories.length > 0) {
      filtered = articles.filter(a => categories.includes(a.category));
    }
    
    // Extract companies and funding
    const companies = new Set();
    const fundingEvents = [];
    
    filtered.forEach(article => {
      article.analysis.companies.forEach(c => companies.add(c));
      if (article.analysis.fundingAmount) {
        fundingEvents.push({
          company: article.analysis.companies[0],
          amount: article.analysis.fundingAmount,
          round: article.analysis.fundingRound,
          date: article.pubDate,
          source: article.source,
          url: article.link
        });
      }
    });
    
    res.json({
      success: true,
      articlesFound: filtered.length,
      companiesDiscovered: Array.from(companies),
      fundingEvents,
      articles: filtered.slice(0, 100) // Limit to 100 most recent
    });
    
  } catch (error) {
    console.error('RSS scan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Advanced funding discovery endpoint
app.post('/api/funding/discover', async (req, res) => {
  try {
    const { companyName } = req.body;
    
    console.log(`Discovering funding for ${companyName}...`);
    const funding = await AdvancedFundingDiscovery.discoverFunding(companyName);
    
    res.json({
      success: true,
      rounds: funding.length,
      totalRaised: funding.reduce((sum, r) => sum + (r.amountUSD || 0), 0),
      funding
    });
    
  } catch (error) {
    console.error('Funding discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Comprehensive AI analysis endpoint
app.post('/api/analysis/comprehensive', async (req, res) => {
  try {
    const { companyId } = req.body;
    
    // Gather all data
    const company = await Company.findById(companyId);
    const trials = await Trial.find({ company: companyId });
    const molecules = await Molecule.find({ company: companyId });
    const funding = await Funding.find({ company: companyId });
    const patents = await Patent.find({ company: companyId });
    const contacts = await Contact.find({ company: companyId });
    
    const companyData = {
      company: company.toObject(),
      trials,
      molecules,
      funding,
      patents,
      contacts
    };
    
    console.log(`Running comprehensive AI analysis for ${company.name}...`);
    const analysis = await ComprehensiveAIAnalysis.analyzeCompany(companyData);
    
    // Store analysis results
    await Analysis.findOneAndUpdate(
      { company: companyId },
      {
        company: companyId,
        analysis,
        generatedAt: new Date()
      },
      { upsert: true }
    );
    
    res.json({
      success: true,
      analysis
    });
    
  } catch (error) {
    console.error('Comprehensive analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});


// Enhanced Contact Discovery Service with better GPT handling
class ContactDiscoveryService {
  static async findContacts(companyName, companyDomain) {
    const contacts = [];
    
    // Try Hunter.io first if we have a domain
    if (process.env.HUNTER_API_KEY && companyDomain) {
      try {
        const hunterContacts = await this.searchHunterIO(companyDomain);
        contacts.push(...hunterContacts);
      } catch (err) {
        console.log('Hunter.io search failed:', err.message);
      }
    }
    
    // If no contacts yet, try GPT
    if (contacts.length === 0 && openai) {
      try {
        const gptData = await this.searchWithGPT(companyName);
        
        // If GPT found a domain and we haven't tried Hunter yet
        if (gptData.domain && !companyDomain && process.env.HUNTER_API_KEY) {
          try {
            const hunterContacts = await this.searchHunterIO(gptData.domain);
            contacts.push(...hunterContacts);
          } catch (err) {
            console.log('Hunter.io with GPT domain failed:', err.message);
          }
        }
        
        // Add GPT contacts if any
        if (gptData.contacts && Array.isArray(gptData.contacts)) {
          contacts.push(...gptData.contacts);
        }
      } catch (err) {
        console.log('GPT contact search failed:', err.message);
      }
    }
    
    // Deduplicate contacts
    const uniqueContacts = [];
    const seenEmails = new Set();
    const seenNames = new Set();
    
    for (const contact of contacts) {
      const email = contact.email?.toLowerCase();
      const name = contact.name?.toLowerCase();
      
      if (email && !seenEmails.has(email)) {
        seenEmails.add(email);
        uniqueContacts.push(contact);
      } else if (!email && name && !seenNames.has(name)) {
        seenNames.add(name);
        uniqueContacts.push(contact);
      }
    }
    
    console.log(`Found ${uniqueContacts.length} unique contacts for ${companyName}`);
    return uniqueContacts;
  }

  static async searchHunterIO(domain) {
    if (!process.env.HUNTER_API_KEY || !domain) return [];
    
    try {
      const url = `https://api.hunter.io/v2/domain-search`;
      const params = {
        domain: domain,
        api_key: process.env.HUNTER_API_KEY,
        limit: 20,
        type: 'personal',
        seniority: 'senior,executive',
        department: 'management,executive,operations'
      };

      const response = await axios.get(url, { params, timeout: 10000 });
      const emails = response.data?.data?.emails || [];

      console.log(`Hunter.io found ${emails.length} contacts for ${domain}`);

      return emails.map(e => ({
        name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        title: e.position,
        email: e.value,
        department: e.department,
        confidence: e.confidence / 100,
        source: 'Hunter.io',
        linkedinUrl: e.linkedin,
        phone: e.phone_number
      })).filter(c => c.name && c.email);
    } catch (error) {
      console.error('Hunter.io search error:', error.message);
      return [];
    }
  }

  static async searchWithGPT(companyName) {
    if (!openai) return { contacts: [], domain: null };
    
    try {
      const prompt = `For the pharmaceutical/biotech company "${companyName}", find:
        1. Company website/domain (if it exists)
        2. Key executives (CEO, COO, CFO, VP, Directors) with their titles
        3. LinkedIn profiles if publicly available
        
        IMPORTANT: If this appears to be a person's name rather than a company, or if you cannot find information, return empty arrays.
        
        You MUST respond with ONLY valid JSON in this format:
        {
          "domain": "example.com" or null,
          "contacts": [
            {"name": "John Doe", "title": "CEO", "linkedinUrl": "https://linkedin.com/in/johndoe"}
          ] or []
        }
        
        DO NOT include any explanatory text outside the JSON.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a business intelligence assistant. Respond only with valid JSON. If information is not available, use null values or empty arrays."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 800
      });

      const response = completion.choices[0].message.content;
      
      try {
        // Extract JSON from response
        let jsonStr = response;
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
        
        return JSON.parse(jsonStr);
      } catch (parseError) {
        console.log('Could not parse GPT contact response');
        return { contacts: [], domain: null };
      }
    } catch (error) {
      console.error('GPT contact search error:', error.message);
      return { contacts: [], domain: null };
    }
  }
}

// Export for use in main server file
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ComprehensiveEnrichmentService,
    ContactDiscoveryService
  };
}

// Scoring Engine
class ScoringEngine {
  static async calculateScore(companyId) {
    try {
      const company = await Company.findById(companyId);
      if (!company) return null;

      const trials = await Trial.find({ company: companyId });
      const funding = await Funding.find({ company: companyId }).sort({ date: -1 });
      const molecules = await Molecule.find({ company: companyId });

      const scores = {
        phase1Readiness: 0,
        funding: 0,
        outsourcingLikelihood: 0,
        moleculeQuality: 0,
        timing: 0
      };

      // Phase 1 Readiness
      const phase1Trials = trials.filter(t => t.phase?.includes('Phase 1'));
      if (phase1Trials.length > 0) {
        scores.phase1Readiness += 15;
        if (phase1Trials.some(t => t.status === 'Not yet recruiting')) scores.phase1Readiness += 10;
        if (phase1Trials.some(t => t.hasUSSites)) scores.phase1Readiness += 5;
      }

      // Funding Score
      const recentFunding = funding.filter(f => 
        dayjs(f.date).isAfter(dayjs().subtract(18, 'month'))
      );
      if (recentFunding.length > 0) {
        scores.funding += 10;
        const totalAmount = recentFunding.reduce((sum, f) => sum + (f.amountUSD || 0), 0);
        if (totalAmount > 50000000) scores.funding += 10;
        if (totalAmount > 100000000) scores.funding += 5;
      }

      // Outsourcing Likelihood
      const employeeCount = company.employeeCount || 0;
      if (employeeCount > 0 && employeeCount <= 50) scores.outsourcingLikelihood += 15;
      else if (employeeCount <= 250) scores.outsourcingLikelihood += 10;
      else if (employeeCount <= 500) scores.outsourcingLikelihood += 5;
      
      if (company.hasInternalGMP === false) scores.outsourcingLikelihood += 10;

      // Molecule Quality
      if (molecules.filter(m => m.structureAvailable).length > 0) scores.moleculeQuality += 5;
      if (molecules.filter(m => m.target).length > 0) scores.moleculeQuality += 3;
      if (molecules.length > 0) scores.moleculeQuality += 2;

      // Timing Score
      const oldestTrial = trials
        .filter(t => t.startDate)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))[0];
      
      if (oldestTrial) {
        const yearsInClinic = dayjs().diff(dayjs(oldestTrial.startDate), 'year');
        if (yearsInClinic < 1) scores.timing += 10;
        else if (yearsInClinic < 2) scores.timing += 5;
        else if (yearsInClinic >= 3) scores.timing -= 10;
      } else {
        scores.timing += 5;
      }

      const overallScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
      
      let priorityTier = 'C';
      if (overallScore >= 70) priorityTier = 'A';
      else if (overallScore >= 50) priorityTier = 'B';

      await Score.findOneAndUpdate(
        { company: companyId },
        {
          company: companyId,
          overallScore,
          phase1ReadinessScore: scores.phase1Readiness,
          fundingScore: scores.funding,
          outsourcingLikelihoodScore: scores.outsourcingLikelihood,
          moleculeQualityScore: scores.moleculeQuality,
          timingScore: scores.timing,
          canPay: recentFunding.length > 0,
          needsCDMO: scores.outsourcingLikelihood >= 15,
          isStale: scores.timing < 0,
          priorityTier,
          scoreComponents: scores,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      return { companyId, overallScore, priorityTier, ...scores };
    } catch (err) {
      console.error('Error calculating score:', err);
      return null;
    }
  }
}

// API Routes

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const stats = {
      status: 'healthy',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      counts: {
        companies: await Company.countDocuments(),
        trials: await Trial.countDocuments(),
        molecules: await Molecule.countDocuments(),
        funding: await Funding.countDocuments(),
        contacts: await Contact.countDocuments()
      }
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const stats = {
      companies: await Company.countDocuments(),
      trials: await Trial.countDocuments(),
      phase1Trials: await Trial.countDocuments({ phase: /Phase 1/ }),
      molecules: await Molecule.countDocuments(),
      funding: await Funding.countDocuments(),
      contacts: await Contact.countDocuments(),
      tierA: await Score.countDocuments({ priorityTier: 'A' }),
      tierB: await Score.countDocuments({ priorityTier: 'B' }),
      needsCDMO: await Score.countDocuments({ needsCDMO: true }),
      recentActivity: {
        companies: await Company.countDocuments({
          createdAt: { $gte: dayjs().subtract(7, 'day').toDate() }
        }),
        trials: await Trial.countDocuments({
          createdAt: { $gte: dayjs().subtract(7, 'day').toDate() }
        })
      }
    };
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced company enrichment endpoint
app.post('/api/companies/:id/enrich-funding', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    console.log(`Starting comprehensive enrichment for ${company.name}...`);
    
    // Get comprehensive data from GPT
    const enrichmentData = await ComprehensiveEnrichmentService.enrichCompany(company.name);
    
    if (!enrichmentData) {
      return res.status(500).json({ error: 'Failed to enrich company data' });
    }

    // Update company with enriched data
    if (enrichmentData.domain) company.domain = enrichmentData.domain;
    if (enrichmentData.website) company.website = enrichmentData.website;
    if (enrichmentData.headquarters) company.headquarters = enrichmentData.headquarters;
    if (enrichmentData.employeeCount) company.employeeCount = enrichmentData.employeeCount;
    if (enrichmentData.employeeBand) company.employeeBand = enrichmentData.employeeBand;
    if (enrichmentData.hasGMPFacilities !== null) company.hasInternalGMP = enrichmentData.hasGMPFacilities;
    if (enrichmentData.recentEvents) company.recentEvents = enrichmentData.recentEvents;
    company.lastEnriched = new Date();
    await company.save();

    // Add funding rounds
    let fundingAdded = 0;
    if (enrichmentData.fundingRounds) {
      for (const round of enrichmentData.fundingRounds) {
        const existing = await Funding.findOne({
          company: company._id,
          date: round.date,
          roundType: round.roundType
        });

        if (!existing && round.amountUSD) {
          await Funding.create({
            company: company._id,
            ...round,
            source: 'GPT-4 Research'
          });
          fundingAdded++;
        }
      }
    }

    // Find and add contacts
    console.log(`Finding contacts for ${company.name}...`);
    const contacts = await ContactDiscoveryService.findContacts(company.name, company.domain || enrichmentData.domain);
    
    let contactsAdded = 0;
    for (const contact of contacts) {
      // Filter for relevant titles
      if (!/CEO|CFO|COO|VP|Director|Head|Chief|President|Executive/i.test(contact.title || '')) continue;
      
      const existing = await Contact.findOne({
        company: company._id,
        $or: [
          { email: contact.email },
          { name: contact.name, title: contact.title }
        ]
      });

      if (!existing) {
        await Contact.create({
          company: company._id,
          ...contact
        });
        contactsAdded++;
      }
    }

    // Recalculate score
    await ScoringEngine.calculateScore(company._id);

    res.json({ 
      success: true,
      enrichmentSummary: {
        fundingAdded,
        contactsAdded,
        employeeCount: enrichmentData.employeeCount,
        recentEvents: enrichmentData.recentEvents?.length || 0,
        domain: enrichmentData.domain,
        hasGMP: enrichmentData.hasGMPFacilities
      }
    });
  } catch (error) {
    console.error('Error enriching company:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get company details
app.get('/api/companies/:id', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const [trials, molecules, funding, contacts, score] = await Promise.all([
      Trial.find({ company: company._id }).populate('molecule'),
      Molecule.find({ company: company._id }),
      Funding.find({ company: company._id }).sort({ date: -1 }),
      Contact.find({ company: company._id }),
      Score.findOne({ company: company._id })
    ]);

    res.json({
      company,
      trials,
      molecules,
      funding,
      contacts,
      score
    });
  } catch (error) {
    console.error('Error fetching company details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get companies list
app.get('/api/companies', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      minScore = 0,
      priorityTier,
      needsCDMO,
      search,
      sortBy = 'score'
    } = req.query;

    const query = {};
    const scoreQuery = {};

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    if (minScore) {
      scoreQuery.overallScore = { $gte: parseFloat(minScore) };
    }

    if (priorityTier) {
      scoreQuery.priorityTier = priorityTier;
    }

    if (needsCDMO !== undefined) {
      scoreQuery.needsCDMO = needsCDMO === 'true';
    }

    const scores = await Score.find(scoreQuery).select('company');
    const companyIds = scores.map(s => s.company);
    
    if (Object.keys(scoreQuery).length > 0) {
      query._id = { $in: companyIds };
    }

    const companies = await Company.find(query)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const enrichedCompanies = await Promise.all(companies.map(async (company) => {
      const [trials, molecules, funding, score, contacts] = await Promise.all([
        Trial.countDocuments({ company: company._id, phase: /Phase 1/ }),
        Molecule.countDocuments({ company: company._id }),
        Funding.find({ company: company._id }).sort({ date: -1 }).limit(1),
        Score.findOne({ company: company._id }),
        Contact.countDocuments({ company: company._id })
      ]);

      return {
        ...company.toObject(),
        phase1Count: trials,
        moleculeCount: molecules,
        lastFunding: funding[0],
        score: score,
        contactCount: contacts
      };
    }));

    const total = await Company.countDocuments(query);

    res.json({
      companies: enrichedCompanies,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch trials endpoint
app.post('/api/trials/fetch', async (req, res) => {
  try {
    const { sinceDays = 90, maxResults = 100 } = req.body;
    
    console.log('Fetching clinical trials...');
    const trials = await ClinicalTrialsAPI.fetchPhase1Trials({ 
      sinceDays, 
      maxResults 
    });
    
    let companiesProcessed = 0;
    let trialsAdded = 0;
    let errors = [];

    for (const trial of trials) {
      if (!trial.sponsor || !trial.trialId) continue;

      try {
        let company = await Company.findOne({ name: trial.sponsor });
        if (!company) {
          company = await Company.create({
            name: trial.sponsor,
            country: trial.locationCountries?.[0],
            hasInternalGMP: trial.sponsorClass === 'INDUSTRY' ? false : null
          });
          companiesProcessed++;
        }

        let molecule = null;
        const drugInterventions = (trial.interventions || []).filter(i => 
          i.InterventionType === 'Drug' || i.InterventionType === 'Biological'
        );

        if (drugInterventions.length > 0) {
          const moleculeName = drugInterventions[0].InterventionName;
          molecule = await Molecule.findOneAndUpdate(
            { company: company._id, name: moleculeName },
            {
              name: moleculeName,
              modality: drugInterventions[0].InterventionType,
              indication: trial.conditions?.join(', '),
              developmentStage: 'Phase 1'
            },
            { upsert: true, new: true }
          );
        }

        const existingTrial = await Trial.findOne({ 
          trialId: trial.trialId,
          registry: trial.registry 
        });
        
        if (!existingTrial) {
          await Trial.create({
            company: company._id,
            molecule: molecule?._id,
            ...trial
          });
          trialsAdded++;
        }

        await ScoringEngine.calculateScore(company._id);
        
      } catch (err) {
        console.error(`Error processing trial ${trial.trialId}:`, err.message);
        errors.push({ trialId: trial.trialId, error: err.message });
      }
    }

    res.json({ 
      success: true, 
      companiesProcessed, 
      trialsAdded,
      totalFetched: trials.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error fetching trials:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch PubChem endpoint
app.post('/api/pubchem/fetch', async (req, res) => {
  try {
    const { days = 7, limit = 50 } = req.body;
    
    console.log('Fetching PubChem substances...');
    const substances = await PubChemAPI.fetchRecentSubstances({ days, limit });
    
    let companiesProcessed = 0;
    let moleculesAdded = 0;
    let errors = [];

    for (const substance of substances) {
      if (!substance.depositor || substance.depositor === 'Unknown') continue;

      if (/enamine|chembridge|sigma|aldrich|mcule|molport/i.test(substance.depositor)) {
        console.log(`Skipping vendor: ${substance.depositor}`);
        continue;
      }

      try {
        let company = await Company.findOne({ name: substance.depositor });
        if (!company) {
          company = await Company.create({
            name: substance.depositor
          });
          companiesProcessed++;
        }

        for (const cid of substance.cids.slice(0, 5)) {
          const existingMolecule = await Molecule.findOne({
            company: company._id,
            pubchemCid: cid
          });
          
          if (!existingMolecule) {
            await Molecule.create({
              company: company._id,
              pubchemCid: cid,
              pubchemSid: substance.sid,
              depositor: substance.depositor,
              developmentStage: 'Preclinical',
              structureAvailable: true
            });
            moleculesAdded++;
          }
        }
      } catch (err) {
        console.error(`Error processing substance ${substance.sid}:`, err.message);
        errors.push({ sid: substance.sid, error: err.message });
      }
    }

    res.json({ 
      success: true, 
      companiesProcessed, 
      moleculesAdded,
      substancesFetched: substances.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error in PubChem fetch:', error);
    res.json({ 
      success: false,
      error: error.message,
      companiesProcessed: 0,
      moleculesAdded: 0,
      substancesFetched: 0
    });
  }
});

// Start server
const PORT = process.env.PORT || 5055;
app.listen(PORT, () => {
  console.log(`🚀 Phase 1 Discovery Platform running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/phlow.html`);
  console.log(`🔧 API: http://localhost:${PORT}/api/health`);
});