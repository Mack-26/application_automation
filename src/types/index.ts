/**
 * Core type definitions for the Job Application Agent
 */

// Candidate Profile Types
export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface PersonalInfo {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  phone_digits?: string;       // 10-digit number only (e.g., "7344179955")
  phone_country_code?: string; // e.g., "+1"
  phone_device_type?: string;  // e.g., "Mobile"
  location: string;
  address?: Address;
  work_authorization: string;
  willing_to_relocate?: boolean;
  start_date?: string;
  salary_expectation?: string;
  hourly_rate?: string;
  internship_dates?: string;
}

export interface Education {
  school: string;
  degree: string;
  field: string;
  graduation: string; // YYYY-MM format
  gpa?: string;
}

export interface WorkExperience {
  company: string;
  title: string;
  location: string;
  start_date: string;    // YYYY-MM format
  end_date: string;      // YYYY-MM or "Present"
  current?: boolean;
  description: string[]; // Bullet points
}

export interface Skills {
  languages: string[];
  ml: string[];
  tools: string[];
}

export interface Links {
  github: string;
  linkedin: string;
  portfolio?: string;
  website?: string;
}

export interface ComplianceInfo {
  require_sponsorship: boolean;
  authorized_to_work: boolean;
  is_veteran: boolean;
  veteran_status: string;
  disability_status: string;
  gender?: string;
  race_ethnicity?: string;
  lgbtq?: string;
}

export interface ApplicationDefaults {
  referral_source: string;
  how_did_you_hear: string;
  willing_to_background_check: boolean;
  willing_to_drug_test: boolean;
  available_for_interview: boolean;
  can_work_weekends?: boolean;
  has_reliable_transportation?: boolean;
  was_referred?: boolean;
  referrer_name?: string;
}

export interface AIResponseConfig {
  enabled: boolean;
  provider: string;
  model: string;
  templates: Record<string, string>;
}

export interface ResumeAsset {
  file_path: string;
  file_name: string;
  mime: string;
}

export interface CandidateProfile {
  personal: PersonalInfo;
  education: Education[];
  work_experience?: WorkExperience[];
  skills: Skills;
  links: Links;
  compliance?: ComplianceInfo;
  application_defaults?: ApplicationDefaults;
  resume?: ResumeAsset;
  ai_responses?: AIResponseConfig;
}

// Job Types
export interface Job {
  company: string;
  role: string;
  location: string;
  apply_url: string;
  source: 'github';
  date_posted?: string;
  sponsorship?: boolean;
}

// ATS Types
export type ATSType = 'greenhouse' | 'lever' | 'workday' | 'ashby' | 'icims' | 'custom';

export interface ATSPattern {
  urlPattern: string | null;
  name: string;
  resumeSelectors: string[];
  fieldMappings: Record<string, string[]>;
}

export interface ATSMappings {
  patterns: Record<ATSType, ATSPattern>;
  loginIndicators: string[];
  captchaIndicators: string[];
  emailVerificationIndicators: string[];
  successIndicators: string[];
}

// Application Status Types
export type ApplicationStatus = 'pending' | 'in_progress' | 'submitted' | 'failed' | 'partial' | 'skipped';

export interface ApplicationResult {
  company: string;
  role: string;
  ats: ATSType;
  status: ApplicationStatus;
  issue?: string;
  timestamp: string;
  duration_ms?: number;
  screenshots?: string[];
}

// Checkpoint Types
export type CheckpointType = 'login' | 'email_verification' | 'captcha' | 'manual_input';

export interface Checkpoint {
  type: CheckpointType;
  message: string;
  detected_at: string;
  resolved_at?: string;
}

// Settings Types
export interface BrowserSettings {
  headless: boolean;
  slowMo: number;
  timeout: number;
  viewport: {
    width: number;
    height: number;
  };
}

export interface JobSourceSettings {
  repository: string;
  branch: string;
  readmePath: string;
}

export interface ApplicationSettings {
  maxRetries: number;
  retryDelay: number;
  pauseOnError: boolean;
  autoSubmit: boolean;
}

export interface LoggingSettings {
  level: 'debug' | 'info' | 'warn' | 'error';
  outputDir: string;
  saveScreenshots: boolean;
}

export interface Settings {
  browser: BrowserSettings;
  jobSource: JobSourceSettings;
  application: ApplicationSettings;
  logging: LoggingSettings;
}

// Form Field Types
export interface FormField {
  selector: string;
  type: 'text' | 'email' | 'tel' | 'select' | 'radio' | 'checkbox' | 'file' | 'textarea';
  label?: string;
  required: boolean;
  value?: string;
}

export interface FormAnalysis {
  resumeUpload?: FormField;
  fields: FormField[];
  hasLogin: boolean;
  hasCaptcha: boolean;
  hasEmailVerification: boolean;
}

