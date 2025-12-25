/**
 * AI-powered form filling using OpenAI or Hugging Face
 */

import { Page } from 'playwright';
import { getBrowserManager } from '../browser/browser-manager';
import { getLogger } from '../log/logger';
import { extractFormFields, formatFormForLLM, ExtractedForm, ExtractedField } from './form-extractor';
import { getFormTracker } from './form-tracker';
import type { CandidateProfile, Job } from '../types';
const logger = getLogger();

type AIProvider = 'openai' | 'huggingface';

interface AIGeneratedAnswer {
  fieldIndex: number;
  fieldLabel: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning?: string;
}

interface AIFormResponse {
  answers: AIGeneratedAnswer[];
  fieldsSkipped: string[];
  notes: string;
}

interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

/**
 * Generate the system prompt for the AI
 */
function getSystemPrompt(): string {
  return `You are an expert job application assistant. Your task is to fill out job application forms accurately and professionally.

RULES:
1. For text fields, provide concise, professional answers
2. For dropdowns/select fields, choose the EXACT option text from the provided options
3. For Yes/No questions, answer "Yes" or "No" exactly
4. For checkboxes, answer "check" or "uncheck"
5. Skip fields that are already filled correctly
6. For demographic questions (gender, race, veteran status, disability), use "Decline to self-identify" or similar if available
7. Be honest - don't claim qualifications the candidate doesn't have
8. For "Why this company" or essay questions, write 2-3 sentences max
9. Match the answer to the CORRECT field - read field labels carefully
10. The current year is 2025, internships are for Summer 2026

PHONE NUMBER RULES (IMPORTANT):
- "Phone Device Type" → Select "Mobile"
- "Country Phone Code" → Select "United States of America (+1)" or similar US option
- "Phone Number" field (when country code is separate) → Use ONLY 10 digits, no formatting: e.g., "7344179955"
- "Phone Extension" → Leave empty or skip
- If there's only ONE phone field with no country code field nearby, use full format: "+1 (734) 417-9955"

CRITICAL: fieldIndex must match the field number shown (1, 2, 3, etc). Field 1 = fieldIndex 1, Field 2 = fieldIndex 2.

IMPORTANT: For dropdown fields, you MUST choose from the EXACT options provided. Do not invent options.

Respond in JSON format:
{
  "answers": [
    {
      "fieldIndex": <number matching the field number shown>,
      "fieldLabel": "<exact label of the field>",
      "answer": "<your answer>",
      "confidence": "high|medium|low",
      "reasoning": "<brief explanation if needed>"
    }
  ],
  "fieldsSkipped": ["<labels of fields to skip>"],
  "notes": "<any important notes>"
}`;
}

/**
 * Generate the user prompt with form and profile data
 */
function getUserPrompt(
  form: ExtractedForm,
  profile: CandidateProfile,
  job: Job
): string {
  const formText = formatFormForLLM(form);
  
  let profileText = `
CANDIDATE PROFILE:
==================
Name: ${profile.personal.first_name} ${profile.personal.last_name}
Email: ${profile.personal.email}
Phone: ${profile.personal.phone}
Location: ${profile.personal.location}

Education:
${profile.education.map(e => `  - ${e.degree} in ${e.field} from ${e.school} (${e.graduation})`).join('\n')}

Skills:
  - Languages: ${profile.skills.languages.join(', ')}
  - ML/AI: ${profile.skills.ml.join(', ')}
  - Tools: ${profile.skills.tools.join(', ')}

Links:
  - GitHub: ${profile.links.github}
  - LinkedIn: ${profile.links.linkedin}
`;

  if (profile.compliance) {
    profileText += `
Work Authorization:
  - Authorized to work in US: ${profile.compliance.authorized_to_work ? 'Yes' : 'No'}
  - Requires sponsorship: ${profile.compliance.require_sponsorship ? 'Yes' : 'No'}
  - Veteran status: ${profile.compliance.veteran_status}
  - Disability status: ${profile.compliance.disability_status}
`;
  }

  // Add relocation preference
  profileText += `
Preferences:
  - Willing to relocate: ${profile.personal.willing_to_relocate ? 'Yes' : 'No'}
`;

  // Add referral info
  if (profile.application_defaults) {
    profileText += `  - Was referred by employee: ${profile.application_defaults.was_referred ? 'Yes' : 'No'}
`;
    if (profile.application_defaults.referrer_name) {
      profileText += `  - Referrer name: ${profile.application_defaults.referrer_name}
`;
    }
  }

  if (profile.personal.hourly_rate) {
    profileText += `  - Hourly rate expectation: $${profile.personal.hourly_rate}/hr\n`;
  }

  if (profile.personal.internship_dates) {
    profileText += `  - Internship availability: ${profile.personal.internship_dates}\n`;
  }

  const jobText = `
JOB DETAILS:
============
Company: ${job.company}
Role: ${job.role}
Location: ${job.location}
Current Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
Target Internship: Summer 2026
`;

  return `${jobText}\n${profileText}\n${formText}\n\nPlease generate answers for all unfilled fields. Match each answer to the CORRECT field by its number. For fields that are already filled correctly, add them to fieldsSkipped.`;
}

/**
 * Call AI API to generate form answers (supports OpenAI and Hugging Face)
 */
async function callAI(
  systemPrompt: string,
  userPrompt: string,
  config: AIConfig
): Promise<AIFormResponse> {
  if (config.provider === 'huggingface') {
    return callHuggingFace(systemPrompt, userPrompt, config.apiKey, config.model);
  } else {
    return callOpenAI(systemPrompt, userPrompt, config.apiKey, config.model);
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  model: string = 'gpt-4o-mini'
): Promise<AIFormResponse> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  return JSON.parse(content) as AIFormResponse;
}

/**
 * Call Hugging Face Inference API via router with provider
 */
async function callHuggingFace(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  model: string = 'meta-llama/Llama-3.1-8B-Instruct'
): Promise<AIFormResponse> {
  // Use chat messages format (like OpenAI)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, just the JSON object.' },
  ];

  // HuggingFace router endpoint (OpenAI-compatible)
  const apiUrl = 'https://router.huggingface.co/v1/chat/completions';
  
  // Model with provider suffix (model:provider format)
  const modelWithProvider = `${model}:featherless-ai`;
  
  logger.info(`[AI] Calling HuggingFace model: ${modelWithProvider}`);
  
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelWithProvider,
      messages: messages,
      max_tokens: 4000,
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[AI] Hugging Face API error: ${response.status}`);
    logger.error(`[AI] Response: ${errorText}`);
    throw new Error(`Hugging Face API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  
  // OpenAI-compatible chat completions format
  const content = data.choices?.[0]?.message?.content || '';
  
  if (!content) {
    throw new Error('No content in Hugging Face response');
  }
  
  logger.debug(`[AI] Response content length: ${content.length}`);
  
  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error(`[AI] Could not extract JSON from response: ${content.substring(0, 500)}`);
    throw new Error('Could not extract JSON from Hugging Face response');
  }
  
  try {
    return JSON.parse(jsonMatch[0]) as AIFormResponse;
  } catch (parseError) {
    logger.error(`[AI] JSON parse error: ${parseError}`);
    logger.debug(`[AI] Raw response: ${content.substring(0, 1000)}`);
    throw new Error('Failed to parse Hugging Face response as JSON');
  }
}


/**
 * Apply AI-generated answers to the form
 */
async function applyAnswersToForm(
  page: Page,
  form: ExtractedForm,
  aiResponse: AIFormResponse
): Promise<{ filled: number; failed: number }> {
  const tracker = getFormTracker();
  let filled = 0;
  let failed = 0;

  for (const answer of aiResponse.answers) {
    // AI returns 1-based index (matching prompt numbering), convert to 0-based
    const fieldIndex = answer.fieldIndex - 1;
    const field = form.fields[fieldIndex];
    if (!field || fieldIndex < 0) {
      logger.warn(`[AI] Field index ${answer.fieldIndex} (0-based: ${fieldIndex}) not found`);
      failed++;
      continue;
    }

    // Skip if already filled by tracker
    if (tracker.isFieldFilled(field.selector)) {
      logger.debug(`[AI] Skipping already filled: ${field.label}`);
      continue;
    }

    try {
      const success = await fillField(page, field, answer.answer);
      
      if (success) {
        tracker.recordFill(field.selector, field.label || field.name, answer.answer, 'AI');
        filled++;
      } else {
        tracker.recordFailure(field.selector, field.label || field.name, 'Could not fill', 'AI');
        failed++;
      }
    } catch (error) {
      logger.error(`[AI] Error filling ${field.label}: ${error}`);
      failed++;
    }

    // Minimal delay between fills (reduced from 200ms)
    await page.waitForTimeout(50);
  }

  return { filled, failed };
}

/**
 * Fill a single field based on its type
 */
async function fillField(
  page: Page,
  field: ExtractedField,
  value: string
): Promise<boolean> {
  try {
    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
      case 'number':
      case 'date':
        return await fillTextInput(page, field.selector, value);
      
      case 'textarea':
        return await fillTextarea(page, field.selector, value);
      
      case 'select':
        return await fillSelect(page, field, value);
      
      case 'radio':
        return await fillRadio(page, field, value);
      
      case 'checkbox':
        return await fillCheckbox(page, field.selector, value);
      
      default:
        logger.warn(`[AI] Unknown field type: ${field.type}`);
        return false;
    }
  } catch (error) {
    logger.debug(`[AI] Fill error for ${field.label}: ${error}`);
    return false;
  }
}

async function fillTextInput(page: Page, selector: string, value: string): Promise<boolean> {
  const element = await page.$(selector);
  if (!element) return false;
  
  // Check if field has a dropdown trigger nearby (Greenhouse pattern)
  const hasDropdownTrigger = await element.evaluate((el) => {
    const parent = el.closest('.field') || el.closest('[class*="field"]') || el.parentElement;
    if (!parent) return false;
    
    // Look for dropdown indicators
    const indicators = [
      parent.querySelector('[class*="select"]'),
      parent.querySelector('[class*="dropdown"]'),
      parent.querySelector('[class*="arrow"]'),
      parent.querySelector('[class*="caret"]'),
      parent.querySelector('button'),
      parent.querySelector('[role="combobox"]'),
    ];
    return indicators.some(i => i !== null);
  });
  
  // Click the field first
  await element.click();
  // Wait for dropdown to appear (max 200ms)
  await Promise.race([
    page.waitForSelector('[role="listbox"], [class*="dropdown-menu"]:visible', { timeout: 200 }).catch(() => null),
    page.waitForTimeout(50)
  ]);
  
  // Check if dropdown appeared after clicking
  const dropdownAppeared = await page.evaluate(() => {
    const dropdownSelectors = [
      '[class*="autocomplete"]:not([style*="display: none"])',
      '[class*="dropdown-menu"]:not([style*="display: none"])',
      '[class*="select__menu"]',
      '[role="listbox"]',
      '[class*="suggestions"]',
      'ul.select-dropdown',
      '[class*="typeahead"]',
      '.dropdown-content:not(.hidden)',
    ];
    for (const sel of dropdownSelectors) {
      const dropdown = document.querySelector(sel);
      if (dropdown) {
        const style = window.getComputedStyle(dropdown);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return true;
        }
      }
    }
    return false;
  });
  
  if (hasDropdownTrigger || dropdownAppeared) {
    logger.debug(`[AI] Detected dropdown field, trying to select: ${value}`);
    
    // Type to filter (if it's a typeahead/autocomplete)
    await element.fill('');
    await element.type(value.substring(0, 20), { delay: 20 }); // Type first 20 chars to filter
    // Wait for options to appear (max 200ms)
    await Promise.race([
      page.waitForSelector('[role="option"]:visible, li[role="option"]:visible', { timeout: 200 }).catch(() => null),
      page.waitForTimeout(100)
    ]);
    
    // Try to find and click a matching option
    const optionClicked = await tryClickDropdownOption(page, value);
    if (optionClicked) {
      logger.debug(`[AI] Successfully clicked dropdown option`);
      return true;
    }
    
    // Try clicking the first visible option if exact match not found
    const firstOptionClicked = await tryClickFirstOption(page);
    if (firstOptionClicked) {
      logger.debug(`[AI] Clicked first available option`);
      return true;
    }
    
    // Last resort: press Enter or arrow down + Enter
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    
    logger.debug(`[AI] Used keyboard to select dropdown option`);
  } else {
    // Regular text input
    await element.fill('');
    await element.fill(value);
  }
  
  return true;
}

/**
 * Try to click the first visible dropdown option
 */
async function tryClickFirstOption(page: Page): Promise<boolean> {
  const firstOptionSelectors = [
    '[role="option"]:first-child',
    '[class*="option"]:first-child',
    '[class*="autocomplete"] li:first-child',
    '[class*="dropdown"] li:first-child',
    'ul li:first-child',
  ];
  
  for (const selector of firstOptionSelectors) {
    try {
      const option = await page.$(selector);
      if (option) {
        const isVisible = await option.isVisible();
        if (isVisible) {
          await option.click();
          // No delay needed
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
 * Try to click a dropdown option matching the value
 */
async function tryClickDropdownOption(page: Page, value: string): Promise<boolean> {
  const optionSelectors = [
    '[role="option"]',
    '[class*="autocomplete"] li',
    '[class*="dropdown"] li',
    '[class*="option"]',
    '[class*="suggestion"]',
    '[class*="select__option"]',
    'ul li[data-value]',
    'ul li[class*="item"]',
  ];
  
  const lowerValue = value.toLowerCase();
  
  for (const selector of optionSelectors) {
    try {
      const options = await page.$$(selector);
      for (const option of options) {
        const text = await option.textContent();
        if (text) {
          const lowerText = text.toLowerCase().trim();
          // Match if text contains value or value contains text
          if (lowerText.includes(lowerValue) || lowerValue.includes(lowerText) || lowerText === lowerValue) {
            await option.click();
            // No delay needed
            return true;
          }
        }
      }
    } catch {
      continue;
    }
  }
  
  return false;
}

async function fillTextarea(page: Page, selector: string, value: string): Promise<boolean> {
  const element = await page.$(selector);
  if (!element) return false;
  
  await element.click();
  await element.fill('');
  await element.fill(value);
  return true;
}

async function fillSelect(page: Page, field: ExtractedField, value: string): Promise<boolean> {
  // Try native select first
  try {
    const element = await page.$(field.selector);
    if (element) {
      const tagName = await element.evaluate(el => (el as HTMLElement).tagName.toLowerCase());
      if (tagName === 'select') {
        // Try to match option
        if (field.options) {
          const match = field.options.find(o => 
            o.text.toLowerCase() === value.toLowerCase() ||
            o.text.toLowerCase().includes(value.toLowerCase()) ||
            value.toLowerCase().includes(o.text.toLowerCase())
          );
          if (match) {
            await element.selectOption({ value: match.value });
            return true;
          }
        }
        await element.selectOption({ label: value });
        return true;
      }
    }
  } catch {}

  // Try custom dropdown
  try {
    const container = await page.$(field.selector) || 
                      await page.$(`[id="${field.id}"]`) ||
                      await page.$(`[aria-label*="${field.label}"]`);
    
    if (container) {
      await container.click();
      await page.waitForTimeout(300);

      // Find and click matching option
      const options = await page.$$('[role="option"]:visible, [class*="option"]:visible');
      for (const opt of options) {
        const text = await opt.textContent();
        if (text && (
          text.toLowerCase().includes(value.toLowerCase()) ||
          value.toLowerCase().includes(text.toLowerCase())
        )) {
          await opt.click();
          return true;
        }
      }

      await page.keyboard.press('Escape');
    }
  } catch {}

  return false;
}

async function fillRadio(page: Page, field: ExtractedField, value: string): Promise<boolean> {
  if (!field.groupName) return false;
  
  const radios = await page.$$(`input[type="radio"][name="${field.groupName}"]`);
  
  for (const radio of radios) {
    const radioValue = await radio.getAttribute('value');
    const id = await radio.getAttribute('id');
    
    let label = '';
    if (id) {
      const labelEl = await page.$(`label[for="${id}"]`);
      if (labelEl) {
        label = (await labelEl.textContent()) || '';
      }
    }
    
    if (
      radioValue?.toLowerCase() === value.toLowerCase() ||
      label.toLowerCase().includes(value.toLowerCase()) ||
      value.toLowerCase().includes(label.toLowerCase())
    ) {
      await radio.click();
      return true;
    }
  }
  
  return false;
}

async function fillCheckbox(page: Page, selector: string, value: string): Promise<boolean> {
  const element = await page.$(selector);
  if (!element) return false;
  
  const isChecked = await element.isChecked();
  const shouldCheck = value.toLowerCase() === 'check' || value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
  
  if (isChecked !== shouldCheck) {
    await element.click();
  }
  
  return true;
}

/**
 * Main AI form filling function
 */
export async function fillFormWithAI(
  profile: CandidateProfile,
  job: Job,
  config: AIConfig
): Promise<{ filled: number; failed: number; form: ExtractedForm }> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  logger.info(`[AI] Starting AI-powered form filling (${config.provider}: ${config.model})...`);
  
  // Step 1: Extract form fields
  const form = await extractFormFields();
  
  if (form.fields.length === 0) {
    logger.warn('[AI] No form fields found');
    return { filled: 0, failed: 0, form };
  }
  
  // Step 2: Generate AI answers
  logger.info(`[AI] Generating answers for ${form.fields.length} fields...`);
  
  const systemPrompt = getSystemPrompt();
  const userPrompt = getUserPrompt(form, profile, job);
  
  const aiResponse = await callAI(systemPrompt, userPrompt, config);
  
  logger.info(`[AI] Generated ${aiResponse.answers.length} answers`);
  
  if (aiResponse.notes) {
    logger.info(`[AI] Notes: ${aiResponse.notes}`);
  }
  
  // Step 3: Apply answers to form
  const result = await applyAnswersToForm(page, form, aiResponse);
  
  logger.info(`[AI] Form filling complete: ${result.filled} filled, ${result.failed} failed`);
  
  return { ...result, form };
}

/**
 * Check if AI filling is configured
 */
export function isAIEnabled(profile: CandidateProfile): boolean {
  if (!profile.ai_responses?.enabled) return false;
  
  const provider = profile.ai_responses?.provider || 'openai';
  if (provider === 'huggingface') {
    return !!process.env.HUGGINGFACE_API_KEY;
  }
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Get AI configuration from profile or environment
 */
export function getAIConfig(profile: CandidateProfile): AIConfig | null {
  if (!profile.ai_responses?.enabled) return null;
  
  const provider = (profile.ai_responses?.provider || 'openai') as AIProvider;
  
  let apiKey: string | undefined;
  let defaultModel: string;
  
  if (provider === 'huggingface') {
    apiKey = process.env.HUGGINGFACE_API_KEY;
    defaultModel = 'meta-llama/Llama-3.1-8B-Instruct';
  } else {
    apiKey = process.env.OPENAI_API_KEY;
    defaultModel = 'gpt-4o-mini';
  }
  
  
  if (!apiKey) {
    logger.warn(`[AI] ${provider.toUpperCase()} API key not found. Set ${provider === 'huggingface' ? 'HUGGINGFACE_API_KEY' : 'OPENAI_API_KEY'} environment variable.`);
    return null;
  }
  
  const model = profile.ai_responses?.model || defaultModel;
  
  return { provider, apiKey, model };
}

/**
 * Generate AI answers for a form (standalone function for UI)
 */
export async function generateAIAnswers(
  formText: string,
  profile: CandidateProfile,
  job: Job,
  aiConfig: AIConfig
): Promise<Array<{ fieldIndex: number; value: string }>> {
  // Get primary education
  const primaryEdu = profile.education[0];
  
  // Create user prompt
  let profileText = `
CANDIDATE PROFILE:
==================
Name: ${profile.personal.first_name} ${profile.personal.last_name}
Email: ${profile.personal.email}
Phone: ${profile.personal.phone || 'Not provided'}

Education:
  - ${primaryEdu ? `${primaryEdu.degree} in ${primaryEdu.field} from ${primaryEdu.school} (${primaryEdu.graduation})` : 'Not provided'}

Links:
  - GitHub: ${profile.links.github || 'Not provided'}
  - LinkedIn: ${profile.links.linkedin || 'Not provided'}

Work Authorization: ${profile.personal.work_authorization || 'Authorized to work'}
Requires Sponsorship: ${profile.compliance?.require_sponsorship ? 'Yes' : 'No'}

JOB BEING APPLIED TO:
=====================
Company: ${job.company}
Position: ${job.role}
Location: ${job.location}

Current Year: 2025
Internship Year: Summer 2026

FORM FIELDS TO FILL:
====================
${formText}
`;

  const systemPrompt = getSystemPrompt();
  
  let aiResponse: AIFormResponse;
  
  if (aiConfig.provider === 'huggingface') {
    aiResponse = await callHuggingFace(systemPrompt, profileText, aiConfig.apiKey, aiConfig.model);
  } else {
    aiResponse = await callOpenAI(systemPrompt, profileText, aiConfig.apiKey, aiConfig.model);
  }
  
  // Convert to simple array format
  return aiResponse.answers.map(a => ({
    fieldIndex: a.fieldIndex,
    value: a.answer,
  }));
}

/**
 * Export fill functions for use by overlay UI
 */
export { fillTextInput };

export async function fillSelectDropdown(page: Page, selector: string, value: string): Promise<boolean> {
  const element = await page.$(selector);
  if (!element) return false;
  
  try {
    await element.selectOption({ label: value });
    return true;
  } catch {
    // Try by value
    try {
      await element.selectOption({ value });
      return true;
    } catch {
      return false;
    }
  }
}

export async function fillCustomDropdown(page: Page, selector: string, value: string): Promise<boolean> {
  // Click to open dropdown
  const element = await page.$(selector);
  if (!element) return false;
  
  await element.click();
  await page.waitForTimeout(300);
  
  // Type to filter
  await page.keyboard.type(value.substring(0, 20), { delay: 30 });
  await page.waitForTimeout(400);
  
  // Try to click matching option
  const clicked = await tryClickDropdownOption(page, value);
  if (clicked) return true;
  
  // Try first option
  const firstClicked = await tryClickFirstOption(page);
  if (firstClicked) return true;
  
  // Fall back to keyboard
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  
  return true;
}

export default {
  fillFormWithAI,
  extractFormFields,
  isAIEnabled,
  getAIConfig,
  generateAIAnswers,
  fillTextInput,
  fillSelectDropdown,
  fillCustomDropdown,
};

