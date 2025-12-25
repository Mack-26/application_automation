/**
 * Configuration loader module
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CandidateProfile, ATSMappings, Settings } from '../types';

const CONFIG_DIR = path.resolve(__dirname, '../../config');

/**
 * Load and parse a JSON configuration file
 */
function loadJsonConfig<T>(filename: string): T {
  const filePath = path.join(CONFIG_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Load candidate profile configuration
 */
export function loadCandidateProfile(): CandidateProfile {
  return loadJsonConfig<CandidateProfile>('candidate-profile.json');
}

/**
 * Load ATS mappings configuration
 */
export function loadATSMappings(): ATSMappings {
  return loadJsonConfig<ATSMappings>('ats-mappings.json');
}

/**
 * Load application settings
 */
export function loadSettings(): Settings {
  return loadJsonConfig<Settings>('settings.json');
}

/**
 * Get the absolute path to the resume file
 */
export function getResumePath(profile: CandidateProfile): string | null {
  if (!profile.resume?.file_path) {
    return null;
  }
  
  // Handle relative paths from project root
  const resumePath = profile.resume.file_path.startsWith('./')
    ? path.resolve(__dirname, '../..', profile.resume.file_path)
    : profile.resume.file_path;
  
  if (!fs.existsSync(resumePath)) {
    console.warn(`Resume file not found at: ${resumePath}`);
    return null;
  }
  
  return resumePath;
}

/**
 * Validate candidate profile has required fields
 */
export function validateCandidateProfile(profile: CandidateProfile): string[] {
  const errors: string[] = [];
  
  if (!profile.personal.first_name) errors.push('First name is required');
  if (!profile.personal.last_name) errors.push('Last name is required');
  if (!profile.personal.email) errors.push('Email is required');
  if (!profile.personal.phone) errors.push('Phone is required');
  
  if (profile.education.length === 0) {
    errors.push('At least one education entry is required');
  }
  
  return errors;
}

export default {
  loadCandidateProfile,
  loadATSMappings,
  loadSettings,
  getResumePath,
  validateCandidateProfile,
};

