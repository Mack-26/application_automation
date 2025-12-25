/**
 * Advanced question handler for form fields
 * Handles compliance questions, dropdowns, and open-ended questions
 */

import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { getBrowserManager } from '../browser/browser-manager';
import { getLogger } from '../log/logger';
import type { CandidateProfile, Job } from '../types';

const logger = getLogger();

interface DropdownMapping {
  patterns: string[];
  options?: Record<string, string[]>;
  profile_field: string;
  value_map?: Record<string, string>;
}

interface TextFieldMapping {
  patterns: string[];
  profile_field: string;
}

interface OpenEndedQuestion {
  patterns: string[];
  template_key?: string;
  default_value?: string;
  requires_ai: boolean;
  max_length?: number;
}

interface FormQuestions {
  dropdown_mappings: Record<string, DropdownMapping>;
  text_field_mappings: Record<string, TextFieldMapping>;
  open_ended_questions: Record<string, OpenEndedQuestion>;
}

let cachedQuestions: FormQuestions | null = null;

/**
 * Load form questions configuration
 */
function loadFormQuestions(): FormQuestions {
  if (cachedQuestions) return cachedQuestions;
  
  const configPath = path.resolve(__dirname, '../../config/form-questions.json');
  const content = fs.readFileSync(configPath, 'utf-8');
  cachedQuestions = JSON.parse(content);
  return cachedQuestions!;
}

/**
 * Get nested value from profile using dot notation
 */
function getProfileValue(profile: CandidateProfile, fieldPath: string): string | boolean | undefined {
  const parts = fieldPath.split('.');
  let value: unknown = profile;
  
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    
    // Handle array notation like education[0]
    const arrayMatch = part.match(/(\w+)\[(\d+)\]/);
    if (arrayMatch) {
      const [, arrName, index] = arrayMatch;
      value = (value as Record<string, unknown>)[arrName];
      if (Array.isArray(value)) {
        value = value[parseInt(index)];
      }
    } else {
      value = (value as Record<string, unknown>)[part];
    }
  }
  
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

/**
 * Check if label matches any pattern
 */
function matchesPattern(label: string, patterns: string[]): boolean {
  const lowerLabel = label.toLowerCase();
  return patterns.some(pattern => {
    if (pattern.includes('.*')) {
      // Regex pattern
      const regex = new RegExp(pattern, 'i');
      return regex.test(lowerLabel);
    }
    return lowerLabel.includes(pattern.toLowerCase());
  });
}

/**
 * Find best matching option for a select/dropdown
 */
async function findMatchingOption(
  page: Page,
  selector: string,
  targetValue: string,
  optionMatches?: Record<string, string[]>
): Promise<string | null> {
  try {
    const options = await page.$$eval(`${selector} option`, (opts) =>
      opts.map(o => ({ value: o.getAttribute('value') || '', text: o.textContent || '' }))
    );
    
    const lowerTarget = targetValue.toLowerCase();
    
    // If we have specific option matches, use them
    if (optionMatches) {
      for (const [key, matches] of Object.entries(optionMatches)) {
        if (matches.some(m => lowerTarget.includes(m.toLowerCase()))) {
          // Find option that matches this key
          const opt = options.find(o => 
            o.text.toLowerCase().includes(key) || 
            o.value.toLowerCase().includes(key) ||
            matches.some(m => o.text.toLowerCase().includes(m.toLowerCase()))
          );
          if (opt) return opt.value;
        }
      }
    }
    
    // Direct text match
    const exactMatch = options.find(o => 
      o.text.toLowerCase() === lowerTarget || 
      o.value.toLowerCase() === lowerTarget
    );
    if (exactMatch) return exactMatch.value;
    
    // Partial match
    const partialMatch = options.find(o => 
      o.text.toLowerCase().includes(lowerTarget) || 
      lowerTarget.includes(o.text.toLowerCase())
    );
    if (partialMatch) return partialMatch.value;
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Handle a dropdown/select field
 */
async function handleDropdown(
  page: Page,
  element: { selector: string; label: string },
  profile: CandidateProfile
): Promise<boolean> {
  const questions = loadFormQuestions();
  const label = element.label.toLowerCase();
  
  for (const [key, mapping] of Object.entries(questions.dropdown_mappings)) {
    if (matchesPattern(label, mapping.patterns)) {
      let value = getProfileValue(profile, mapping.profile_field);
      
      if (value === undefined) continue;
      
      // Apply value mapping if exists
      if (mapping.value_map && typeof value === 'boolean') {
        value = mapping.value_map[String(value)];
      }
      
      const stringValue = String(value);
      const optionValue = await findMatchingOption(
        page,
        element.selector,
        stringValue,
        mapping.options
      );
      
      if (optionValue) {
        try {
          await page.selectOption(element.selector, optionValue);
          logger.debug(`Filled dropdown ${key}: ${stringValue}`);
          return true;
        } catch (err) {
          logger.debug(`Failed to select option for ${key}: ${err}`);
        }
      }
    }
  }
  
  return false;
}

/**
 * Handle a text input field based on label matching
 */
async function handleTextField(
  page: Page,
  element: { selector: string; label: string },
  profile: CandidateProfile
): Promise<boolean> {
  const questions = loadFormQuestions();
  const label = element.label.toLowerCase();
  
  for (const [key, mapping] of Object.entries(questions.text_field_mappings)) {
    if (matchesPattern(label, mapping.patterns)) {
      const value = getProfileValue(profile, mapping.profile_field);
      
      if (value === undefined || value === '') continue;
      
      try {
        await page.fill(element.selector, String(value));
        logger.debug(`Filled text field ${key}: ${String(value).substring(0, 30)}...`);
        return true;
      } catch (err) {
        logger.debug(`Failed to fill ${key}: ${err}`);
      }
    }
  }
  
  return false;
}

/**
 * Handle radio button groups
 */
async function handleRadioGroup(
  page: Page,
  groupName: string,
  label: string,
  profile: CandidateProfile
): Promise<boolean> {
  const questions = loadFormQuestions();
  const lowerLabel = label.toLowerCase();
  
  for (const [key, mapping] of Object.entries(questions.dropdown_mappings)) {
    if (matchesPattern(lowerLabel, mapping.patterns)) {
      let value = getProfileValue(profile, mapping.profile_field);
      
      if (value === undefined) continue;
      
      if (mapping.value_map && typeof value === 'boolean') {
        value = mapping.value_map[String(value)];
      }
      
      const stringValue = String(value).toLowerCase();
      
      // Find radio button with matching value or label
      const radios = await page.$$(`input[type="radio"][name="${groupName}"]`);
      
      for (const radio of radios) {
        const radioValue = await radio.getAttribute('value');
        const radioId = await radio.getAttribute('id');
        
        // Try to get label text
        let radioLabel = '';
        if (radioId) {
          const labelEl = await page.$(`label[for="${radioId}"]`);
          if (labelEl) {
            radioLabel = (await labelEl.textContent()) || '';
          }
        }
        
        const matches = 
          radioValue?.toLowerCase().includes(stringValue) ||
          radioLabel.toLowerCase().includes(stringValue) ||
          (mapping.options && Object.entries(mapping.options).some(([optKey, optMatches]) => {
            if (optMatches.some(m => stringValue.includes(m.toLowerCase()))) {
              return radioValue?.toLowerCase().includes(optKey) ||
                     radioLabel.toLowerCase().includes(optKey) ||
                     optMatches.some(m => radioLabel.toLowerCase().includes(m.toLowerCase()));
            }
            return false;
          }));
        
        if (matches) {
          try {
            await radio.click();
            logger.debug(`Selected radio ${key}: ${radioLabel || radioValue}`);
            return true;
          } catch {
            continue;
          }
        }
      }
    }
  }
  
  return false;
}

/**
 * Generate response for open-ended questions using templates
 */
export function generateTemplateResponse(
  templateKey: string,
  profile: CandidateProfile,
  job: Job
): string {
  const aiConfig = profile.ai_responses;
  
  if (!aiConfig?.templates?.[templateKey]) {
    return '';
  }
  
  let response = aiConfig.templates[templateKey];
  
  // Replace placeholders
  const replacements: Record<string, string> = {
    '{company}': job.company,
    '{role}': job.role,
    '{first_name}': profile.personal.first_name,
    '{last_name}': profile.personal.last_name,
    '{school}': profile.education[0]?.school || '',
    '{degree}': profile.education[0]?.degree || '',
    '{field}': profile.education[0]?.field || '',
    '{skills}': profile.skills.languages.slice(0, 3).join(', '),
  };
  
  for (const [placeholder, value] of Object.entries(replacements)) {
    response = response.replace(new RegExp(placeholder, 'g'), value);
  }
  
  return response;
}

/**
 * Handle open-ended text areas (why company, cover letter, etc.)
 */
async function handleOpenEndedQuestion(
  page: Page,
  element: { selector: string; label: string },
  profile: CandidateProfile,
  job: Job
): Promise<{ handled: boolean; needsReview: boolean }> {
  const questions = loadFormQuestions();
  const label = element.label.toLowerCase();
  
  for (const [key, config] of Object.entries(questions.open_ended_questions)) {
    if (matchesPattern(label, config.patterns)) {
      let response = '';
      
      if (config.template_key) {
        response = generateTemplateResponse(config.template_key, profile, job);
      } else if (config.default_value !== undefined) {
        response = config.default_value;
      }
      
      if (response) {
        // Truncate if needed
        if (config.max_length && response.length > config.max_length) {
          response = response.substring(0, config.max_length - 3) + '...';
        }
        
        try {
          await page.fill(element.selector, response);
          logger.debug(`Filled open-ended ${key} (${response.length} chars)`);
          
          return {
            handled: true,
            needsReview: config.requires_ai, // Flag for human review if AI-generated
          };
        } catch (err) {
          logger.debug(`Failed to fill ${key}: ${err}`);
        }
      }
      
      return { handled: false, needsReview: true };
    }
  }
  
  return { handled: false, needsReview: false };
}

/**
 * Process all compliance and additional questions on the page
 */
export async function handleAdditionalQuestions(
  profile: CandidateProfile,
  job: Job
): Promise<{ filled: number; needsReview: boolean }> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  let filled = 0;
  let needsReview = false;
  
  // Find all form elements with labels
  const formElements = await page.$$eval(
    'input:visible, select:visible, textarea:visible',
    (elements) => {
      return elements.map(el => {
        const id = el.getAttribute('id') || '';
        const name = el.getAttribute('name') || '';
        const type = el.getAttribute('type') || el.tagName.toLowerCase();
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        
        // Get associated label
        let label = ariaLabel || placeholder;
        if (!label && id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl) label = labelEl.textContent || '';
        }
        
        // Try parent label
        if (!label) {
          const parentLabel = el.closest('label');
          if (parentLabel) label = parentLabel.textContent || '';
        }
        
        return {
          selector: id ? `#${id}` : (name ? `[name="${name}"]` : ''),
          type,
          label: label.trim(),
          name,
        };
      }).filter(el => el.selector && el.label);
    }
  );
  
  // Process dropdowns/selects
  for (const element of formElements.filter(e => e.type === 'select' || e.type === 'select-one')) {
    if (await handleDropdown(page, element, profile)) {
      filled++;
    }
  }
  
  // Process text inputs
  for (const element of formElements.filter(e => ['text', 'email', 'tel', 'url', 'number'].includes(e.type))) {
    if (await handleTextField(page, element, profile)) {
      filled++;
    }
  }
  
  // Process textareas (open-ended questions)
  for (const element of formElements.filter(e => e.type === 'textarea')) {
    const result = await handleOpenEndedQuestion(page, element, profile, job);
    if (result.handled) filled++;
    if (result.needsReview) needsReview = true;
  }
  
  // Process radio button groups
  const radioGroups = new Set(
    formElements.filter(e => e.type === 'radio').map(e => e.name)
  );
  
  for (const groupName of radioGroups) {
    // Find the group's label (usually a fieldset legend or nearby heading)
    const groupLabel = await page.$eval(
      `fieldset:has(input[name="${groupName}"]) legend, 
       div:has(input[name="${groupName}"]) > label:first-child`,
      (el) => el?.textContent || ''
    ).catch(() => '');
    
    if (groupLabel) {
      if (await handleRadioGroup(page, groupName, groupLabel, profile)) {
        filled++;
      }
    }
  }
  
  logger.info(`Handled ${filled} additional questions${needsReview ? ' (review recommended)' : ''}`);
  
  return { filled, needsReview };
}

export default {
  handleAdditionalQuestions,
  generateTemplateResponse,
};

