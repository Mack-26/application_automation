/**
 * Application history tracking - prevents reapplying to the same jobs
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from './logger';

const logger = getLogger();

interface AppliedJob {
  company: string;
  role: string;
  url: string;
  applied_at: string;
  status: 'submitted' | 'partial' | 'failed';
  notes?: string;
}

interface ApplicationHistory {
  last_updated: string;
  total_applications: number;
  jobs: AppliedJob[];
}

const HISTORY_FILE = path.resolve(__dirname, '../../logs/application-history.json');

/**
 * Load application history from file
 */
function loadHistory(): ApplicationHistory {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    logger.warn(`Could not load application history: ${err}`);
  }
  
  return {
    last_updated: new Date().toISOString(),
    total_applications: 0,
    jobs: [],
  };
}

/**
 * Save application history to file
 */
function saveHistory(history: ApplicationHistory): void {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    history.last_updated = new Date().toISOString();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    logger.error(`Could not save application history: ${err}`);
  }
}

/**
 * Normalize URL for comparison (remove tracking params, etc.)
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove common tracking parameters
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('ref');
    parsed.searchParams.delete('source');
    return parsed.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Check if a job has already been applied to
 */
export function hasApplied(url: string): boolean {
  const history = loadHistory();
  const normalizedUrl = normalizeUrl(url);
  
  return history.jobs.some(job => {
    const jobUrl = normalizeUrl(job.url);
    return jobUrl === normalizedUrl || 
           jobUrl.includes(normalizedUrl) || 
           normalizedUrl.includes(jobUrl);
  });
}

/**
 * Check if a job has already been applied to and return details
 */
export function getApplicationStatus(url: string): AppliedJob | null {
  const history = loadHistory();
  const normalizedUrl = normalizeUrl(url);
  
  return history.jobs.find(job => {
    const jobUrl = normalizeUrl(job.url);
    return jobUrl === normalizedUrl || 
           jobUrl.includes(normalizedUrl) || 
           normalizedUrl.includes(jobUrl);
  }) || null;
}

/**
 * Record a job application
 */
export function recordApplication(
  company: string,
  role: string,
  url: string,
  status: 'submitted' | 'partial' | 'failed',
  notes?: string
): void {
  const history = loadHistory();
  
  // Check if already exists
  const normalizedUrl = normalizeUrl(url);
  const existingIndex = history.jobs.findIndex(job => {
    const jobUrl = normalizeUrl(job.url);
    return jobUrl === normalizedUrl;
  });
  
  const application: AppliedJob = {
    company,
    role,
    url,
    applied_at: new Date().toISOString(),
    status,
    notes,
  };
  
  if (existingIndex >= 0) {
    // Update existing
    history.jobs[existingIndex] = application;
  } else {
    // Add new
    history.jobs.push(application);
    history.total_applications++;
  }
  
  saveHistory(history);
  logger.info(`[History] Recorded application: ${company} - ${role} (${status})`);
}

/**
 * Get application statistics
 */
export function getStats(): { total: number; submitted: number; partial: number; failed: number } {
  const history = loadHistory();
  
  return {
    total: history.jobs.length,
    submitted: history.jobs.filter(j => j.status === 'submitted').length,
    partial: history.jobs.filter(j => j.status === 'partial').length,
    failed: history.jobs.filter(j => j.status === 'failed').length,
  };
}

/**
 * List all applied jobs
 */
export function listApplications(): AppliedJob[] {
  const history = loadHistory();
  return history.jobs;
}

/**
 * Print application history summary
 */
export function printHistorySummary(): void {
  const stats = getStats();
  
  console.log('\n--- Application History ---');
  console.log(`Total applications: ${stats.total}`);
  console.log(`  ✓ Submitted: ${stats.submitted}`);
  console.log(`  ◐ Partial: ${stats.partial}`);
  console.log(`  ✗ Failed: ${stats.failed}`);
  console.log('---------------------------\n');
}

export default {
  hasApplied,
  getApplicationStatus,
  recordApplication,
  getStats,
  listApplications,
  printHistorySummary,
};

