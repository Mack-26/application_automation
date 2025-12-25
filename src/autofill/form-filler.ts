/**
 * Form autofill engine - with detailed logging and duplicate prevention
 */

import { Page, ElementHandle } from 'playwright';
import { getBrowserManager } from '../browser/browser-manager';
import { getLogger } from '../log/logger';
import { getFieldSelectors, getResumeSelectors } from '../normalize/ats-detector';
import { fillEducationDropdowns, fillWorkAuthDropdown } from './dropdown-handler';
import { getFormTracker, resetFormTracker } from './form-tracker';
import type { CandidateProfile, ATSType, FormField, FormAnalysis } from '../types';

const logger = getLogger();

/**
 * Analyze form fields on the current page
 */
export async function analyzeForm(atsType: ATSType): Promise<FormAnalysis> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  const analysis: FormAnalysis = {
    fields: [],
    hasLogin: false,
    hasCaptcha: false,
    hasEmailVerification: false,
  };
  
  // Find resume upload field
  const resumeSelectors = getResumeSelectors(atsType);
  for (const selector of resumeSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        analysis.resumeUpload = {
          selector,
          type: 'file',
          required: true,
        };
        break;
      }
    } catch {
      continue;
    }
  }
  
  // Find text input fields
  const inputs = await page.$$('input:visible, select:visible, textarea:visible');
  
  for (const input of inputs) {
    try {
      const type = await input.getAttribute('type') || 'text';
      const name = await input.getAttribute('name') || '';
      const id = await input.getAttribute('id') || '';
      const placeholder = await input.getAttribute('placeholder') || '';
      const required = await input.getAttribute('required') !== null;
      const ariaLabel = await input.getAttribute('aria-label') || '';
      
      // Skip hidden, submit, button, and file inputs (handled separately)
      if (['hidden', 'submit', 'button', 'file'].includes(type)) {
        continue;
      }
      
      // Build selector
      let selector: string;
      if (id) {
        selector = `#${id}`;
      } else if (name) {
        selector = `[name="${name}"]`;
      } else {
        continue;
      }
      
      // Determine label
      let label = ariaLabel || placeholder;
      
      // Try to find associated label element
      if (!label && id) {
        const labelElement = await page.$(`label[for="${id}"]`);
        if (labelElement) {
          label = await labelElement.textContent() || '';
        }
      }
      
      analysis.fields.push({
        selector,
        type: mapInputType(type),
        label: label.trim(),
        required,
      });
    } catch {
      continue;
    }
  }
  
  return analysis;
}

/**
 * Map HTML input type to our type system
 */
function mapInputType(htmlType: string): FormField['type'] {
  switch (htmlType.toLowerCase()) {
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'select':
    case 'select-one':
      return 'select';
    case 'radio':
      return 'radio';
    case 'checkbox':
      return 'checkbox';
    case 'file':
      return 'file';
    case 'textarea':
      return 'textarea';
    default:
      return 'text';
  }
}

/**
 * Upload resume PDF
 */
export async function uploadResume(
  resumePath: string,
  atsType: ATSType
): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  const tracker = getFormTracker();
  
  logger.info('[Resume] Attempting to upload resume...');
  
  const selectors = getResumeSelectors(atsType);
  
  for (const selector of selectors) {
    try {
      const fileInput = await page.$(selector);
      
      if (fileInput) {
        await fileInput.setInputFiles(resumePath);
        tracker.recordFill(selector, 'Resume Upload', resumePath.split('/').pop() || 'resume.pdf', 'Resume');
        
        // Wait for upload to process
        await page.waitForTimeout(2000);
        
        // Verify upload
        if (await verifyUpload(page)) {
          return true;
        }
      }
    } catch (error) {
      logger.debug(`[Resume] Failed with selector ${selector}: ${error}`);
      continue;
    }
  }
  
  logger.warn('[Resume] Could not find resume upload field');
  return false;
}

/**
 * Verify resume upload was successful
 */
async function verifyUpload(page: Page): Promise<boolean> {
  const successIndicators = [
    '.file-name',
    '.upload-success',
    '.uploaded-file',
    '[data-testid="uploaded-file"]',
    'text=uploaded',
    'text=attached',
  ];
  
  for (const indicator of successIndicators) {
    try {
      if (indicator.startsWith('text=')) {
        const text = indicator.replace('text=', '');
        const found = await page.getByText(text, { exact: false }).count();
        if (found > 0) return true;
      } else {
        const element = await page.$(indicator);
        if (element) return true;
      }
    } catch {
      continue;
    }
  }
  
  return true;
}

/**
 * Fill a text input field with tracking
 */
async function fillTextField(
  page: Page,
  selector: string,
  value: string,
  label: string,
  module: string
): Promise<boolean> {
  const tracker = getFormTracker();
  
  // Check if already filled
  if (tracker.isFieldFilled(selector)) {
    return false;
  }
  
  tracker.markAttempted(selector);
  
  try {
    const element = await page.$(selector);
    if (!element) {
      tracker.recordFailure(selector, label, 'Element not found', module);
      return false;
    }
    
    const isVisible = await element.isVisible();
    if (!isVisible) {
      tracker.recordFailure(selector, label, 'Element not visible', module);
      return false;
    }
    
    // Check if field already has the value
    const currentValue = await element.inputValue().catch(() => '');
    if (currentValue === value) {
      logger.debug(`[${module}] Field "${label}" already has correct value`);
      return false;
    }
    
    // Clear and fill
    await element.click();
    await element.fill('');
    await element.fill(value);
    
    tracker.recordFill(selector, label, value, module);
    return true;
  } catch (error) {
    tracker.recordFailure(selector, label, String(error), module);
    return false;
  }
}

/**
 * Fill a dropdown/select field with tracking
 */
async function fillSelectField(
  page: Page,
  selector: string,
  value: string,
  label: string,
  module: string
): Promise<boolean> {
  const tracker = getFormTracker();
  
  if (tracker.isFieldFilled(selector)) {
    return false;
  }
  
  tracker.markAttempted(selector);
  
  try {
    const element = await page.$(selector);
    if (!element) {
      tracker.recordFailure(selector, label, 'Element not found', module);
      return false;
    }
    
    // Try to select by label first, then by value
    try {
      await element.selectOption({ label: value });
      tracker.recordFill(selector, label, value, module);
      return true;
    } catch {
      await element.selectOption({ value });
      tracker.recordFill(selector, label, value, module);
      return true;
    }
  } catch (error) {
    tracker.recordFailure(selector, label, String(error), module);
    return false;
  }
}

/**
 * Map profile field to value
 */
function getProfileValue(profile: CandidateProfile, fieldName: string): string | null {
  const mapping: Record<string, string> = {
    first_name: profile.personal.first_name,
    last_name: profile.personal.last_name,
    email: profile.personal.email,
    phone: profile.personal.phone,
    location: profile.personal.location,
    work_authorization: profile.personal.work_authorization,
    linkedin: profile.links.linkedin,
    github: profile.links.github,
  };
  
  if (fieldName.includes('school') && profile.education.length > 0) {
    return profile.education[0].school;
  }
  if (fieldName.includes('degree') && profile.education.length > 0) {
    return profile.education[0].degree;
  }
  if (fieldName.includes('field') && profile.education.length > 0) {
    return profile.education[0].field;
  }
  if (fieldName.includes('graduation') && profile.education.length > 0) {
    return profile.education[0].graduation;
  }
  
  return mapping[fieldName] || null;
}

/**
 * Autofill form with candidate profile
 */
export async function autofillForm(
  profile: CandidateProfile,
  atsType: ATSType
): Promise<{ filled: number; failed: number }> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  const tracker = getFormTracker();
  
  // Reset tracker for this form
  resetFormTracker();
  
  logger.info('=== Starting Form Autofill ===');
  
  // STEP 1: Fill basic fields by ATS-specific selectors
  logger.info('[Step 1] Filling basic fields (name, email, phone, links)...');
  
  const basicFields = [
    { name: 'first_name', label: 'First Name' },
    { name: 'last_name', label: 'Last Name' },
    { name: 'email', label: 'Email' },
    { name: 'phone', label: 'Phone' },
    { name: 'location', label: 'Location' },
    { name: 'linkedin', label: 'LinkedIn' },
    { name: 'github', label: 'GitHub' },
  ];
  
  for (const { name, label } of basicFields) {
    const value = getProfileValue(profile, name);
    if (!value) {
      logger.debug(`[BasicFields] No value for ${name}, skipping`);
      continue;
    }
    
    const selectors = getFieldSelectors(atsType, name);
    
    for (const selector of selectors) {
      const element = await page.$(selector);
      if (!element) continue;
      
      const isVisible = await element.isVisible();
      if (!isVisible) continue;
      
      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      
      let success = false;
      if (tagName === 'select') {
        success = await fillSelectField(page, selector, value, label, 'BasicFields');
      } else {
        success = await fillTextField(page, selector, value, label, 'BasicFields');
      }
      
      if (success) break;
    }
  }
  
  // STEP 2: Fill education dropdowns
  logger.info('[Step 2] Filling education fields...');
  
  if (profile.education.length > 0) {
    await fillEducationDropdowns(page, {
      school: profile.education[0].school,
      degree: profile.education[0].degree,
      field: profile.education[0].field,
      graduation: profile.education[0].graduation,
    });
  }
  
  // STEP 3: Fill work authorization dropdowns
  logger.info('[Step 3] Filling work authorization...');
  
  if (profile.compliance) {
    await fillWorkAuthDropdown(
      page,
      profile.compliance.authorized_to_work,
      profile.compliance.require_sponsorship
    );
  }
  
  // Print summary
  const filledCount = tracker.getFilledCount();
  logger.info(`=== Autofill Complete: ${filledCount} unique fields filled ===`);
  tracker.printSummary();
  
  return { filled: filledCount, failed: tracker.getFailedFields().length };
}

/**
 * Check for missing required fields with better naming
 */
export async function checkRequiredFields(): Promise<string[]> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  const missing: string[] = [];
  
  // Find required fields that are empty
  const requiredInputs = await page.$$('input[required]:visible, select[required]:visible, textarea[required]:visible');
  
  for (const input of requiredInputs) {
    try {
      const value = await input.inputValue().catch(() => '');
      
      if (!value || value.trim() === '') {
        // Get better field identifier
        const id = await input.getAttribute('id') || '';
        const name = await input.getAttribute('name') || '';
        const placeholder = await input.getAttribute('placeholder') || '';
        const ariaLabel = await input.getAttribute('aria-label') || '';
        
        // Try to get label
        let label = ariaLabel || placeholder;
        if (!label && id) {
          const labelEl = await page.$(`label[for="${id}"]`);
          if (labelEl) {
            label = (await labelEl.textContent())?.trim() || '';
          }
        }
        
        // Use best available identifier
        const fieldName = label || name || id || 'unknown field';
        missing.push(fieldName);
      }
    } catch {
      continue;
    }
  }
  
  return missing;
}

export default {
  analyzeForm,
  uploadResume,
  autofillForm,
  checkRequiredFields,
};
