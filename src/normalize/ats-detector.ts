/**
 * ATS (Applicant Tracking System) detection module
 */

import type { Job, ATSType, ATSMappings, ATSPattern } from '../types';
import { loadATSMappings } from '../config';

let cachedMappings: ATSMappings | null = null;

/**
 * Get ATS mappings (cached)
 */
function getMappings(): ATSMappings {
  if (!cachedMappings) {
    cachedMappings = loadATSMappings();
  }
  return cachedMappings;
}

/**
 * Detect ATS type from a URL
 */
export function detectATS(url: string): ATSType {
  const lowerUrl = url.toLowerCase();
  const mappings = getMappings();
  
  // Check each ATS pattern in order
  const atsTypes: ATSType[] = ['greenhouse', 'lever', 'workday', 'ashby', 'icims'];
  
  for (const ats of atsTypes) {
    const pattern = mappings.patterns[ats];
    if (pattern.urlPattern && lowerUrl.includes(pattern.urlPattern)) {
      return ats;
    }
  }
  
  return 'custom';
}

/**
 * Get ATS configuration for a detected type
 */
export function getATSConfig(atsType: ATSType): ATSPattern {
  const mappings = getMappings();
  return mappings.patterns[atsType];
}

/**
 * Get login detection selectors
 */
export function getLoginIndicators(): string[] {
  const mappings = getMappings();
  return mappings.loginIndicators;
}

/**
 * Get CAPTCHA detection selectors
 */
export function getCaptchaIndicators(): string[] {
  const mappings = getMappings();
  return mappings.captchaIndicators;
}

/**
 * Get email verification detection selectors
 */
export function getEmailVerificationIndicators(): string[] {
  const mappings = getMappings();
  return mappings.emailVerificationIndicators;
}

/**
 * Get success page indicators
 */
export function getSuccessIndicators(): string[] {
  const mappings = getMappings();
  return mappings.successIndicators;
}

/**
 * Normalize a job with ATS information
 */
export function normalizeJob(job: Job): Job & { ats: ATSType } {
  return {
    ...job,
    ats: detectATS(job.apply_url),
  };
}

/**
 * Normalize multiple jobs with ATS information
 */
export function normalizeJobs(jobs: Job[]): (Job & { ats: ATSType })[] {
  return jobs.map(normalizeJob);
}

/**
 * Group jobs by ATS type for batch processing
 */
export function groupJobsByATS(jobs: Job[]): Map<ATSType, Job[]> {
  const groups = new Map<ATSType, Job[]>();
  
  for (const job of jobs) {
    const ats = detectATS(job.apply_url);
    const existing = groups.get(ats) || [];
    existing.push(job);
    groups.set(ats, existing);
  }
  
  return groups;
}

/**
 * Get field selectors for a specific field and ATS
 */
export function getFieldSelectors(atsType: ATSType, fieldName: string): string[] {
  const config = getATSConfig(atsType);
  const atsSelectors = config.fieldMappings[fieldName] || [];
  
  // If not found in ATS-specific config, fall back to custom
  if (atsSelectors.length === 0 && atsType !== 'custom') {
    const customConfig = getATSConfig('custom');
    return customConfig.fieldMappings[fieldName] || [];
  }
  
  return atsSelectors;
}

/**
 * Get resume upload selectors for an ATS
 */
export function getResumeSelectors(atsType: ATSType): string[] {
  const config = getATSConfig(atsType);
  return config.resumeSelectors;
}

export default {
  detectATS,
  getATSConfig,
  getLoginIndicators,
  getCaptchaIndicators,
  getEmailVerificationIndicators,
  getSuccessIndicators,
  normalizeJob,
  normalizeJobs,
  groupJobsByATS,
  getFieldSelectors,
  getResumeSelectors,
};

