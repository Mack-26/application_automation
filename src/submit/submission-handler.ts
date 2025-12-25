/**
 * Form submission and validation module
 */

import { getBrowserManager } from '../browser/browser-manager';
import { getLogger } from '../log/logger';
import { getSuccessIndicators } from '../normalize/ats-detector';
import { checkRequiredFields } from '../autofill/form-filler';

const logger = getLogger();

/**
 * Find and click the submit button
 */
async function findAndClickSubmit(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  // Common submit button selectors
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'button:has-text("Send")',
    '[data-testid="submit"]',
    '[data-qa="submit"]',
    '.submit-button',
    '#submit',
    'button.btn-primary:has-text("Submit")',
    'button.btn-primary:has-text("Apply")',
  ];
  
  for (const selector of submitSelectors) {
    try {
      const button = await page.$(selector);
      
      if (button) {
        const isVisible = await button.isVisible();
        const isEnabled = await button.isEnabled();
        
        if (isVisible && isEnabled) {
          logger.debug(`Found submit button: ${selector}`);
          
          // Scroll into view
          await button.scrollIntoViewIfNeeded();
          
          // Click the button
          await button.click();
          
          return true;
        }
      }
    } catch {
      continue;
    }
  }
  
  return false;
}

/**
 * Detect if submission was successful
 */
export async function detectSubmissionSuccess(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  const indicators = getSuccessIndicators();
  
  // Wait for page to update
  await page.waitForTimeout(2000);
  
  // Check URL change (many ATSs redirect to success page)
  const currentUrl = page.url().toLowerCase();
  if (
    currentUrl.includes('success') ||
    currentUrl.includes('thank') ||
    currentUrl.includes('confirm') ||
    currentUrl.includes('complete')
  ) {
    return true;
  }
  
  // Check page content
  const pageText = await page.textContent('body') || '';
  const lowerText = pageText.toLowerCase();
  
  // Check for success indicators in page text
  const successPhrases = [
    'thank you',
    'application submitted',
    'application received',
    'successfully applied',
    'application complete',
    'we received your application',
    'your application has been submitted',
  ];
  
  for (const phrase of successPhrases) {
    if (lowerText.includes(phrase)) {
      return true;
    }
  }
  
  // Check specific selectors
  for (const indicator of indicators) {
    try {
      if (indicator.startsWith("text='") || indicator.startsWith('text="')) {
        const searchText = indicator.replace(/^text=['"]|['"]$/g, '');
        if (lowerText.includes(searchText.toLowerCase())) {
          return true;
        }
      } else {
        const element = await page.$(indicator);
        if (element && await element.isVisible()) {
          return true;
        }
      }
    } catch {
      continue;
    }
  }
  
  return false;
}

/**
 * Detect submission errors
 */
export async function detectSubmissionError(): Promise<string | null> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  // Common error selectors
  const errorSelectors = [
    '.error-message',
    '.alert-danger',
    '.form-error',
    '[role="alert"]',
    '.validation-error',
    '.field-error',
  ];
  
  for (const selector of errorSelectors) {
    try {
      const element = await page.$(selector);
      if (element && await element.isVisible()) {
        const text = await element.textContent();
        if (text && text.trim()) {
          return text.trim();
        }
      }
    } catch {
      continue;
    }
  }
  
  // Check for required field errors
  const missingFields = await checkRequiredFields();
  if (missingFields.length > 0) {
    return `Missing required fields: ${missingFields.join(', ')}`;
  }
  
  return null;
}

/**
 * Validate form before submission
 */
export async function validateBeforeSubmit(): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Check for missing required fields
  const missingFields = await checkRequiredFields();
  if (missingFields.length > 0) {
    errors.push(`Missing required fields: ${missingFields.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Submit the application
 */
export async function submitApplication(): Promise<{
  success: boolean;
  error?: string;
}> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  logger.info('Validating form before submission...');
  
  // Validate first
  const validation = await validateBeforeSubmit();
  if (!validation.valid) {
    logger.warn('Form validation failed');
    return {
      success: false,
      error: validation.errors.join('; '),
    };
  }
  
  logger.info('Submitting application...');
  
  // Take pre-submission screenshot
  await browser.takeScreenshot('pre-submit');
  
  // Try to find and click submit
  const clicked = await findAndClickSubmit();
  
  if (!clicked) {
    return {
      success: false,
      error: 'Could not find submit button',
    };
  }
  
  // Wait for response
  try {
    await page.waitForTimeout(3000);
  } catch {
    // Timeout is okay
  }
  
  // Take post-submission screenshot
  await browser.takeScreenshot('post-submit');
  
  // Check for success
  if (await detectSubmissionSuccess()) {
    logger.info('Application submitted successfully');
    return { success: true };
  }
  
  // Check for errors
  const submissionError = await detectSubmissionError();
  if (submissionError) {
    return {
      success: false,
      error: submissionError,
    };
  }
  
  // Uncertain state
  return {
    success: false,
    error: 'Could not confirm submission status',
  };
}

/**
 * Attempt submission with retry
 */
export async function submitWithRetry(maxRetries: number = 2): Promise<{
  success: boolean;
  error?: string;
  attempts: number;
}> {
  let attempts = 0;
  let lastError: string | undefined;
  
  while (attempts < maxRetries) {
    attempts++;
    
    const result = await submitApplication();
    
    if (result.success) {
      return {
        success: true,
        attempts,
      };
    }
    
    lastError = result.error;
    
    // If it's a validation error, don't retry
    if (lastError?.includes('Missing required fields')) {
      break;
    }
    
    if (attempts < maxRetries) {
      logger.warn(`Submission attempt ${attempts} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return {
    success: false,
    error: lastError,
    attempts,
  };
}

export default {
  submitApplication,
  submitWithRetry,
  detectSubmissionSuccess,
  detectSubmissionError,
  validateBeforeSubmit,
};

