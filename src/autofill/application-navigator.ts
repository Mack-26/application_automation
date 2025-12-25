/**
 * Application Navigator
 * 
 * Handles navigation from job listing pages to actual application forms.
 * Detects when Apply buttons need to be clicked and handles account creation flows.
 */

import { getBrowserManager } from '../browser/browser-manager';
import { getLogger } from '../log/logger';
import type { Page } from 'playwright';

const logger = getLogger();

/**
 * Indicators that we're on a job LISTING page, not an application form
 */
const JOB_LISTING_INDICATORS = {
  // Search/filter elements (indicate listing page, not application)
  searchFields: [
    'input[placeholder*="Search by Keyword"]',
    'input[placeholder*="Search by Location"]',
    'input[name*="searchKeyword"]',
    'select[aria-label*="Job Function"]',
    'select[aria-label*="Brand"]',
    'select[aria-label*="Job Type"]',
    '[data-testid="job-search"]',
    '.job-search-form',
    '.job-filters',
  ],
  
  // Job details elements (indicate we need to apply)
  jobDetailsIndicators: [
    '.job-description',
    '.job-details',
    '[class*="jobDescription"]',
    '[class*="job-detail"]',
    '[data-testid="job-description"]',
    'section[aria-label*="Job Description"]',
  ],
};

/**
 * Common Apply button selectors
 */
const APPLY_BUTTON_SELECTORS = [
  // Primary Apply buttons
  'button:has-text("Apply")',
  'a:has-text("Apply")',
  'button:has-text("Apply Now")',
  'a:has-text("Apply Now")',
  'button:has-text("Apply for this job")',
  'a:has-text("Apply for this job")',
  'button:has-text("Apply for Job")',
  'a:has-text("Apply for Job")',
  'button:has-text("Apply to this job")',
  'a:has-text("Apply to this job")',
  'button:has-text("Submit Application")',
  
  // Class-based selectors
  '[class*="apply-button"]',
  '[class*="applyButton"]',
  '[class*="apply_button"]',
  '[data-testid="apply-button"]',
  '[data-automation="apply-button"]',
  
  // ID-based selectors
  '#apply-button',
  '#applyButton',
  '#apply',
  
  // Generic button/link with apply in href
  'a[href*="apply"]',
  'button[aria-label*="Apply"]',
  'a[aria-label*="Apply"]',
  
  // SuccessFactors specific
  'a[data-careersite-propertyid="apply"]',
  'button[data-careersite-propertyid="apply"]',
  '.applyLink',
  '.apply-link',
];

/**
 * Account creation/login selectors
 */
const ACCOUNT_CREATION_INDICATORS = [
  // Create account buttons/links
  'button:has-text("Create Account")',
  'a:has-text("Create Account")',
  'button:has-text("Sign Up")',
  'a:has-text("Sign Up")',
  'button:has-text("Register")',
  'a:has-text("Register")',
  'button:has-text("Create an Account")',
  'a:has-text("New User")',
  'a:has-text("Create Profile")',
  
  // Form fields for registration
  '[name="confirmPassword"]',
  '[name="confirm_password"]',
  '[name="passwordConfirm"]',
  
  // Sign in/up toggle
  '[class*="signup"]',
  '[class*="register"]',
];

/**
 * Application form indicators (we're on the right page)
 */
const APPLICATION_FORM_INDICATORS = [
  // Personal info fields
  'input[name*="firstName"]',
  'input[name*="first_name"]',
  'input[name*="lastName"]',
  'input[name*="last_name"]',
  'input[name*="email"]',
  'input[name*="phone"]',
  
  // Resume upload
  'input[type="file"]',
  '[class*="resume-upload"]',
  '[class*="resumeUpload"]',
  'button:has-text("Upload Resume")',
  'button:has-text("Upload CV")',
  
  // Application-specific
  'form[class*="application"]',
  'form[id*="application"]',
  '[class*="application-form"]',
  '[class*="applicationForm"]',
  
  // Greenhouse specific
  '#application-form',
  '#application',
  '.application-form',
  
  // Lever specific
  '.posting-application',
  '.application-page',
  
  // Workday specific
  '[data-automation-id="applicationForm"]',
  
  // Generic form with education/experience
  'input[name*="school"]',
  'input[name*="university"]',
  'input[name*="degree"]',
  'input[name*="company"]',
];

/**
 * Detect if we're on a job listing page (not application form)
 */
export async function isJobListingPage(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  let searchFieldCount = 0;
  let applicationFieldCount = 0;
  
  // Count search/filter fields (indicate listing page)
  for (const selector of JOB_LISTING_INDICATORS.searchFields) {
    try {
      const elements = await page.$$(selector);
      const visibleCount: number[] = await Promise.all(
        elements.map(async el => await el.isVisible() ? 1 : 0)
      );
      searchFieldCount += visibleCount.reduce((a, b) => a + b, 0);
    } catch {
      continue;
    }
  }
  
  // Count application form fields
  for (const selector of APPLICATION_FORM_INDICATORS) {
    try {
      const elements = await page.$$(selector);
      const visibleCount: number[] = await Promise.all(
        elements.map(async el => await el.isVisible() ? 1 : 0)
      );
      applicationFieldCount += visibleCount.reduce((a, b) => a + b, 0);
    } catch {
      continue;
    }
  }
  
  logger.debug(`[Navigator] Search fields: ${searchFieldCount}, Application fields: ${applicationFieldCount}`);
  
  // If we have search fields and very few application fields, it's a listing page
  if (searchFieldCount > 2 && applicationFieldCount < 3) {
    return true;
  }
  
  // Check URL patterns
  const url = page.url();
  if (url.includes('/job/') && !url.includes('/apply')) {
    // On a job details page, not application
    return true;
  }
  
  return false;
}

/**
 * Detect if we're on an application form page
 */
export async function isApplicationFormPage(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  let foundCount = 0;
  
  for (const selector of APPLICATION_FORM_INDICATORS) {
    try {
      const element = await page.$(selector);
      if (element && await element.isVisible()) {
        foundCount++;
        if (foundCount >= 2) {
          return true;
        }
      }
    } catch {
      continue;
    }
  }
  
  // Also check for at least name + email fields
  try {
    const hasNameField = await page.$('input[name*="name" i], input[placeholder*="name" i]');
    const hasEmailField = await page.$('input[type="email"], input[name*="email" i]');
    
    if (hasNameField && hasEmailField) {
      return true;
    }
  } catch {
    // Continue
  }
  
  return false;
}

/**
 * Detect if account creation is required
 */
export async function detectAccountCreation(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  // Check page text for account creation prompts
  const pageText = await page.textContent('body') || '';
  const lowerText = pageText.toLowerCase();
  
  const accountPhrases = [
    'create an account',
    'create account',
    'sign up to apply',
    'register to apply',
    'new user? register',
    'already have an account?',
    'create your profile',
    'set up your profile',
  ];
  
  for (const phrase of accountPhrases) {
    if (lowerText.includes(phrase)) {
      logger.debug(`[Navigator] Account creation indicator found: "${phrase}"`);
      return true;
    }
  }
  
  // Check for account creation form elements
  for (const selector of ACCOUNT_CREATION_INDICATORS) {
    try {
      const element = await page.$(selector);
      if (element && await element.isVisible()) {
        logger.debug(`[Navigator] Account creation element found: ${selector}`);
        return true;
      }
    } catch {
      continue;
    }
  }
  
  return false;
}

/**
 * Find and click the Apply button
 * Returns true if successful
 */
export async function clickApplyButton(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  logger.info('[Navigator] Looking for Apply button...');
  
  for (const selector of APPLY_BUTTON_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      
      for (const element of elements) {
        if (await element.isVisible()) {
          const text = await element.textContent() || '';
          
          // Skip if it's clearly not an apply button
          if (text.toLowerCase().includes('sign in') || 
              text.toLowerCase().includes('login') ||
              text.toLowerCase().includes('search')) {
            continue;
          }
          
          logger.info(`[Navigator] Found Apply button: "${text.trim()}" (${selector})`);
          
          // Click the button
          await element.click();
          
          // Wait for navigation or page change
          await page.waitForTimeout(2000);
          
          // Check if URL changed or new content loaded
          const newUrl = page.url();
          logger.info(`[Navigator] After click, URL: ${newUrl}`);
          
          return true;
        }
      }
    } catch (error) {
      logger.debug(`[Navigator] Error with selector ${selector}: ${error}`);
      continue;
    }
  }
  
  // Try broader text search
  try {
    const applyButton = await page.locator('button, a').filter({ hasText: /^Apply/i }).first();
    if (await applyButton.isVisible()) {
      const text = await applyButton.textContent() || 'Apply';
      logger.info(`[Navigator] Found Apply button via text search: "${text.trim()}"`);
      await applyButton.click();
      await page.waitForTimeout(2000);
      return true;
    }
  } catch {
    // Continue
  }
  
  logger.warn('[Navigator] Could not find Apply button');
  return false;
}

/**
 * Wait for application form to load after clicking Apply
 */
export async function waitForApplicationForm(timeoutMs: number = 10000): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  logger.info('[Navigator] Waiting for application form to load...');
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    // Check if we're now on an application form
    if (await isApplicationFormPage()) {
      logger.info('[Navigator] Application form detected');
      return true;
    }
    
    // Check for account creation
    if (await detectAccountCreation()) {
      logger.info('[Navigator] Account creation required');
      return true; // We found a page that needs user action
    }
    
    // Wait a bit before checking again
    await page.waitForTimeout(500);
  }
  
  logger.warn('[Navigator] Timeout waiting for application form');
  return false;
}

/**
 * Navigate to actual application form
 * This handles clicking Apply buttons and waiting for the form
 * 
 * Returns object with status and whether user action is needed
 */
export async function navigateToApplicationForm(): Promise<{
  success: boolean;
  needsAccountCreation: boolean;
  needsLogin: boolean;
  message: string;
}> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  const result = {
    success: false,
    needsAccountCreation: false,
    needsLogin: false,
    message: '',
  };
  
  // First, check if we're already on an application form
  if (await isApplicationFormPage()) {
    logger.info('[Navigator] Already on application form');
    result.success = true;
    result.message = 'Already on application form';
    return result;
  }
  
  // Check if we're on a job listing page
  if (await isJobListingPage()) {
    logger.info('[Navigator] On job listing page, looking for Apply button...');
    
    // Try to click the Apply button
    const clicked = await clickApplyButton();
    
    if (!clicked) {
      result.message = 'Could not find Apply button on job listing page';
      return result;
    }
    
    // Wait for navigation
    await page.waitForTimeout(2000);
  }
  
  // Check for account creation requirement
  if (await detectAccountCreation()) {
    result.needsAccountCreation = true;
    result.message = 'Account creation required - please create an account in the browser';
    logger.info('[Navigator] ' + result.message);
    return result;
  }
  
  // Check for login requirement
  const pageText = await page.textContent('body') || '';
  const lowerText = pageText.toLowerCase();
  
  if (lowerText.includes('sign in') && lowerText.includes('password')) {
    result.needsLogin = true;
    result.message = 'Login required - please sign in to the application system';
    logger.info('[Navigator] ' + result.message);
    return result;
  }
  
  // Wait for application form
  const formLoaded = await waitForApplicationForm(10000);
  
  if (formLoaded) {
    // Final check - is it an application form or account page?
    if (await detectAccountCreation()) {
      result.needsAccountCreation = true;
      result.message = 'Account creation required';
    } else if (await isApplicationFormPage()) {
      result.success = true;
      result.message = 'Successfully navigated to application form';
    } else {
      result.message = 'Unknown page state after navigation';
    }
  } else {
    result.message = 'Timeout waiting for application form';
  }
  
  return result;
}

/**
 * Get page state summary for logging
 */
export async function getPageStateSummary(): Promise<string> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  const url = page.url();
  const title = await page.title();
  
  const isListing = await isJobListingPage();
  const isApplication = await isApplicationFormPage();
  const needsAccount = await detectAccountCreation();
  
  const parts = [
    `URL: ${url}`,
    `Title: ${title}`,
    `State: ${isListing ? 'Job Listing' : isApplication ? 'Application Form' : needsAccount ? 'Account Creation' : 'Unknown'}`,
  ];
  
  return parts.join(' | ');
}

export default {
  isJobListingPage,
  isApplicationFormPage,
  detectAccountCreation,
  clickApplyButton,
  waitForApplicationForm,
  navigateToApplicationForm,
  getPageStateSummary,
};

