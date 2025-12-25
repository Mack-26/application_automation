/**
 * Form field extraction - extracts all form fields for AI processing
 */

import { Page, ElementHandle } from 'playwright';
import { getBrowserManager } from '../browser/browser-manager';
import { getLogger } from '../log/logger';

const logger = getLogger();

export interface ExtractedField {
  id: string;
  name: string;
  selector: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'date' | 'number';
  label: string;
  placeholder: string;
  required: boolean;
  currentValue: string;
  options?: { value: string; text: string }[]; // For select/radio
  groupName?: string; // For radio buttons
}

export interface ExtractedForm {
  url: string;
  title: string;
  fields: ExtractedField[];
  totalFields: number;
  requiredFields: number;
}

/**
 * Extract all form fields from the current page
 */
export async function extractFormFields(): Promise<ExtractedForm> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  logger.info('[FormExtractor] === Starting Form Field Extraction ===');
  
  const url = page.url();
  const title = await page.title();
  logger.info(`[FormExtractor] Page: ${title}`);
  logger.info(`[FormExtractor] URL: ${url}`);
  
  const fields: ExtractedField[] = [];
  
  // Step 1: Extract text inputs
  logger.info('[FormExtractor] Step 1: Extracting text inputs...');
  try {
    const textInputs = await extractTextInputs(page);
    fields.push(...textInputs);
    logger.info(`[FormExtractor]   ✓ Found ${textInputs.length} text inputs`);
    for (const f of textInputs) {
      logger.debug(`[FormExtractor]     - "${f.label || f.name || f.id}" (${f.type})`);
    }
  } catch (error) {
    logger.error(`[FormExtractor]   ✗ Error extracting text inputs: ${error}`);
  }
  
  // Step 2: Extract textareas
  logger.info('[FormExtractor] Step 2: Extracting textareas...');
  try {
    const textareas = await extractTextareas(page);
    fields.push(...textareas);
    logger.info(`[FormExtractor]   ✓ Found ${textareas.length} textareas`);
    for (const f of textareas) {
      logger.debug(`[FormExtractor]     - "${f.label || f.name || f.id}"`);
    }
  } catch (error) {
    logger.error(`[FormExtractor]   ✗ Error extracting textareas: ${error}`);
  }
  
  // Step 3: Extract native select dropdowns
  logger.info('[FormExtractor] Step 3: Extracting native select dropdowns...');
  try {
    const selects = await extractNativeSelects(page);
    fields.push(...selects);
    logger.info(`[FormExtractor]   ✓ Found ${selects.length} native selects`);
    for (const f of selects) {
      const optCount = f.options?.length || 0;
      logger.debug(`[FormExtractor]     - "${f.label || f.name || f.id}" (${optCount} options)`);
    }
  } catch (error) {
    logger.error(`[FormExtractor]   ✗ Error extracting selects: ${error}`);
  }
  
  // Step 4: Extract custom dropdowns (React-Select, etc.) - with timeout
  logger.info('[FormExtractor] Step 4: Extracting custom dropdowns...');
  try {
    const customDropdowns = await extractCustomDropdownsSafe(page);
    fields.push(...customDropdowns);
    logger.info(`[FormExtractor]   ✓ Found ${customDropdowns.length} custom dropdowns`);
    for (const f of customDropdowns) {
      const optCount = f.options?.length || 0;
      logger.debug(`[FormExtractor]     - "${f.label || f.id}" (${optCount} options)`);
    }
  } catch (error) {
    logger.error(`[FormExtractor]   ✗ Error extracting custom dropdowns: ${error}`);
  }
  
  // Step 5: Extract radio button groups
  logger.info('[FormExtractor] Step 5: Extracting radio button groups...');
  try {
    const radioGroups = await extractRadioGroups(page);
    fields.push(...radioGroups);
    logger.info(`[FormExtractor]   ✓ Found ${radioGroups.length} radio groups`);
    for (const f of radioGroups) {
      const optCount = f.options?.length || 0;
      logger.debug(`[FormExtractor]     - "${f.label || f.groupName}" (${optCount} options)`);
    }
  } catch (error) {
    logger.error(`[FormExtractor]   ✗ Error extracting radio groups: ${error}`);
  }
  
  // Step 6: Extract checkboxes
  logger.info('[FormExtractor] Step 6: Extracting checkboxes...');
  try {
    const checkboxes = await extractCheckboxes(page);
    fields.push(...checkboxes);
    logger.info(`[FormExtractor]   ✓ Found ${checkboxes.length} checkboxes`);
    for (const f of checkboxes) {
      logger.debug(`[FormExtractor]     - "${f.label}" (${f.currentValue})`);
    }
  } catch (error) {
    logger.error(`[FormExtractor]   ✗ Error extracting checkboxes: ${error}`);
  }
  
  // Deduplicate by selector
  const uniqueFields = deduplicateFields(fields);
  
  const result: ExtractedForm = {
    url,
    title,
    fields: uniqueFields,
    totalFields: uniqueFields.length,
    requiredFields: uniqueFields.filter(f => f.required).length,
  };
  
  logger.info('[FormExtractor] === Extraction Complete ===');
  logger.info(`[FormExtractor] Total: ${result.totalFields} unique fields (${result.requiredFields} required)`);
  
  // Log summary of all fields
  logger.info('[FormExtractor] Field Summary:');
  for (let i = 0; i < uniqueFields.length; i++) {
    const f = uniqueFields[i];
    const req = f.required ? '*' : '';
    const val = f.currentValue ? ` = "${f.currentValue.substring(0, 30)}"` : '';
    logger.info(`[FormExtractor]   ${i + 1}. [${f.type}] "${f.label || f.name || f.id}"${req}${val}`);
  }
  
  return result;
}

/**
 * Extract text inputs
 */
async function extractTextInputs(page: Page): Promise<ExtractedField[]> {
  return page.$$eval(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"])',
    (elements) => {
      return elements
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(el => {
          const input = el as HTMLInputElement;
          const id = input.id || '';
          const name = input.name || '';
          const type = input.type || 'text';
          
          // Skip hidden inputs
          if (type === 'hidden') return null;
          
          // Get label
          let label = input.getAttribute('aria-label') || input.placeholder || '';
          if (!label && id) {
            const labelEl = document.querySelector(`label[for="${id}"]`);
            if (labelEl) label = labelEl.textContent?.trim() || '';
          }
          if (!label) {
            const parent = input.closest('div, label, fieldset');
            if (parent) {
              const labelEl = parent.querySelector('label, .label, [class*="label"]');
              if (labelEl && !labelEl.querySelector('input')) {
                label = labelEl.textContent?.trim() || '';
              }
            }
          }
          
          // Clean up label
          label = label.replace(/\s+/g, ' ').trim();
          
          return {
            id,
            name,
            selector: id ? `#${CSS.escape(id)}` : (name ? `[name="${name}"]` : ''),
            type: type as any,
            label,
            placeholder: input.placeholder || '',
            required: input.required || input.getAttribute('aria-required') === 'true',
            currentValue: input.value || '',
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null && !!f.selector);
    }
  );
}

/**
 * Extract textareas
 */
async function extractTextareas(page: Page): Promise<ExtractedField[]> {
  return page.$$eval(
    'textarea',
    (elements) => {
      return elements
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(el => {
          const textarea = el as HTMLTextAreaElement;
          const id = textarea.id || '';
          const name = textarea.name || '';
          
          let label = textarea.getAttribute('aria-label') || textarea.placeholder || '';
          if (!label && id) {
            const labelEl = document.querySelector(`label[for="${id}"]`);
            if (labelEl) label = labelEl.textContent?.trim() || '';
          }
          if (!label) {
            const parent = textarea.closest('div, fieldset');
            if (parent) {
              const labelEl = parent.querySelector('label, .label');
              if (labelEl) label = labelEl.textContent?.trim() || '';
            }
          }
          
          return {
            id,
            name,
            selector: id ? `#${CSS.escape(id)}` : (name ? `[name="${name}"]` : ''),
            type: 'textarea' as const,
            label: label.replace(/\s+/g, ' ').trim(),
            placeholder: textarea.placeholder || '',
            required: textarea.required,
            currentValue: textarea.value || '',
          };
        })
        .filter(f => f.selector);
    }
  );
}

/**
 * Extract native select dropdowns
 */
async function extractNativeSelects(page: Page): Promise<ExtractedField[]> {
  return page.$$eval(
    'select',
    (elements) => {
      return elements
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(el => {
          const select = el as HTMLSelectElement;
          const id = select.id || '';
          const name = select.name || '';
          
          let label = select.getAttribute('aria-label') || '';
          if (!label && id) {
            const labelEl = document.querySelector(`label[for="${id}"]`);
            if (labelEl) label = labelEl.textContent?.trim() || '';
          }
          if (!label) {
            const parent = select.closest('div[class*="field"], div[class*="form"]');
            if (parent) {
              const labelEl = parent.querySelector('label');
              if (labelEl) label = labelEl.textContent?.trim() || '';
            }
          }
          
          const options = Array.from(select.options).map(opt => ({
            value: opt.value,
            text: opt.textContent?.trim() || '',
          }));
          
          return {
            id,
            name,
            selector: id ? `#${CSS.escape(id)}` : (name ? `[name="${name}"]` : ''),
            type: 'select' as const,
            label: label.replace(/\s+/g, ' ').trim(),
            placeholder: '',
            required: select.required,
            currentValue: select.value || '',
            options,
          };
        })
        .filter(f => f.selector);
    }
  );
}

/**
 * Extract custom dropdowns safely with limits
 */
async function extractCustomDropdownsSafe(page: Page): Promise<ExtractedField[]> {
  const fields: ExtractedField[] = [];
  
  // More specific selectors for known dropdown patterns
  const dropdownSelectors = [
    '[class*="react-select"]:not(option)',
    '[class*="Select__control"]',
    '[role="combobox"][aria-haspopup="listbox"]',
    '[data-testid*="select"]',
  ];
  
  for (const selector of dropdownSelectors) {
    try {
      const containers = await page.$$(selector);
      logger.debug(`[FormExtractor]   Checking "${selector}": ${containers.length} found`);
      
      // Limit to 10 per selector type
      for (const container of containers.slice(0, 10)) {
        try {
          const field = await extractSingleDropdown(page, container);
          if (field) {
            fields.push(field);
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  
  return fields;
}

/**
 * Extract a single custom dropdown without clicking
 */
async function extractSingleDropdown(page: Page, container: ElementHandle): Promise<ExtractedField | null> {
  try {
    // Get basic info without clicking
    const info = await container.evaluate(el => {
      const htmlEl = el as HTMLElement;
      
      // Get ID
      const id = htmlEl.id || htmlEl.getAttribute('data-testid') || '';
      
      // Get label from various sources
      let label = htmlEl.getAttribute('aria-label') || '';
      if (!label) {
        const parent = htmlEl.closest('div[class*="field"], div[class*="form-group"], fieldset, label');
        if (parent) {
          const labelEl = parent.querySelector('label, [class*="label"]');
          if (labelEl && !labelEl.contains(htmlEl)) {
            label = labelEl.textContent?.trim() || '';
          }
        }
      }
      
      // Get current value
      let currentValue = '';
      const valueEl = htmlEl.querySelector('[class*="single-value"], [class*="placeholder"], [class*="value"]');
      if (valueEl) {
        currentValue = valueEl.textContent?.trim() || '';
      }
      
      // Check if it has an associated input
      const input = htmlEl.querySelector('input');
      const inputId = input?.id || '';
      const inputName = input?.name || '';
      
      return { id, label, currentValue, inputId, inputName };
    });
    
    // Skip if no useful info
    if (!info.label && !info.id) {
      return null;
    }
    
    // Try to get options from aria attributes or visible options
    const options = await getDropdownOptionsWithoutClick(container);
    
    const selector = info.inputId 
      ? `#${CSS.escape(info.inputId)}` 
      : (info.id ? `#${CSS.escape(info.id)}` : '');
    
    if (!selector) return null;
    
    return {
      id: info.id || info.inputId,
      name: info.inputName,
      selector,
      type: 'select',
      label: info.label.replace(/\s+/g, ' ').trim(),
      placeholder: '',
      required: false,
      currentValue: info.currentValue,
      options,
    };
  } catch {
    return null;
  }
}

/**
 * Get dropdown options without clicking (from existing DOM)
 */
async function getDropdownOptionsWithoutClick(container: ElementHandle): Promise<{ value: string; text: string }[]> {
  try {
    return await container.evaluate((node) => {
      const el = node as HTMLElement;
      const options: { value: string; text: string }[] = [];
      
      // Check for options in aria attributes
      const listboxId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      if (listboxId) {
        const listbox = document.getElementById(listboxId);
        if (listbox) {
          const opts = listbox.querySelectorAll('[role="option"], option, li');
          opts.forEach((opt: Element) => {
            const text = opt.textContent?.trim();
            if (text) {
              options.push({ value: text, text });
            }
          });
        }
      }
      
      // Check for existing visible options
      const visibleOpts = el.querySelectorAll('[role="option"], [class*="option"]');
      visibleOpts.forEach((opt: Element) => {
        const text = opt.textContent?.trim();
        if (text && !options.find(o => o.text === text)) {
          options.push({ value: text, text });
        }
      });
      
      return options.slice(0, 20);
    });
  } catch {
    return [];
  }
}

/**
 * Extract radio button groups
 */
async function extractRadioGroups(page: Page): Promise<ExtractedField[]> {
  const fields: ExtractedField[] = [];
  
  try {
    // Get unique radio group names
    const groupNames = await page.$$eval(
      'input[type="radio"]',
      (elements) => {
        const visible = elements.filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        return [...new Set(visible.map(el => (el as HTMLInputElement).name).filter(n => n))];
      }
    );
    
    logger.debug(`[FormExtractor]   Found ${groupNames.length} radio groups: ${groupNames.join(', ')}`);
    
    for (const groupName of groupNames) {
      try {
        const groupData = await page.$$eval(
          `input[type="radio"][name="${groupName}"]`,
          (elements) => {
            const radios = elements as HTMLInputElement[];
            
            // Get group label from fieldset or parent
            let label = '';
            const first = radios[0];
            if (first) {
              const fieldset = first.closest('fieldset');
              if (fieldset) {
                const legend = fieldset.querySelector('legend');
                label = legend?.textContent?.trim() || '';
              }
              if (!label) {
                const parent = first.closest('div[class*="field"], div[class*="question"], div[class*="form"]');
                if (parent) {
                  const labelEl = parent.querySelector('label:not([for]), [class*="label"], h3, h4, legend');
                  if (labelEl) label = labelEl.textContent?.trim() || '';
                }
              }
            }
            
            const options = radios.map(radio => {
              let optLabel = '';
              if (radio.id) {
                const labelEl = document.querySelector(`label[for="${radio.id}"]`);
                optLabel = labelEl?.textContent?.trim() || '';
              }
              if (!optLabel) {
                const parent = radio.closest('label');
                if (parent) {
                  optLabel = parent.textContent?.trim() || '';
                }
              }
              
              return {
                value: radio.value,
                text: optLabel || radio.value,
              };
            });
            
            const checked = radios.find(r => r.checked);
            
            return {
              label: label.replace(/\s+/g, ' ').trim(),
              options,
              currentValue: checked?.value || '',
              required: radios.some(r => r.required),
            };
          }
        );
        
        fields.push({
          id: groupName,
          name: groupName,
          selector: `input[type="radio"][name="${groupName}"]`,
          type: 'radio',
          label: groupData.label,
          placeholder: '',
          required: groupData.required,
          currentValue: groupData.currentValue,
          options: groupData.options,
          groupName,
        });
      } catch {
        continue;
      }
    }
  } catch (error) {
    logger.debug(`[FormExtractor]   Error in radio extraction: ${error}`);
  }
  
  return fields;
}

/**
 * Extract checkboxes
 */
async function extractCheckboxes(page: Page): Promise<ExtractedField[]> {
  return page.$$eval(
    'input[type="checkbox"]',
    (elements) => {
      return elements
        .filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(el => {
          const checkbox = el as HTMLInputElement;
          const id = checkbox.id || '';
          const name = checkbox.name || '';
          
          let label = '';
          if (id) {
            const labelEl = document.querySelector(`label[for="${id}"]`);
            if (labelEl) label = labelEl.textContent?.trim() || '';
          }
          if (!label) {
            const parent = checkbox.closest('label');
            if (parent) label = parent.textContent?.trim() || '';
          }
          if (!label) {
            const parent = checkbox.closest('div');
            if (parent) {
              const labelEl = parent.querySelector('label, span');
              if (labelEl) label = labelEl.textContent?.trim() || '';
            }
          }
          
          return {
            id,
            name,
            selector: id ? `#${CSS.escape(id)}` : (name ? `[name="${name}"]` : ''),
            type: 'checkbox' as const,
            label: label.replace(/\s+/g, ' ').trim(),
            placeholder: '',
            required: checkbox.required,
            currentValue: checkbox.checked ? 'checked' : 'unchecked',
          };
        })
        .filter(f => f.selector && f.label);
    }
  );
}

/**
 * Deduplicate fields by selector
 */
function deduplicateFields(fields: ExtractedField[]): ExtractedField[] {
  const seen = new Set<string>();
  const unique: ExtractedField[] = [];
  
  for (const field of fields) {
    const key = field.selector || field.label;
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(field);
    }
  }
  
  return unique;
}

/**
 * Format extracted form for LLM prompt
 */
export function formatFormForLLM(form: ExtractedForm): string {
  let prompt = `Form URL: ${form.url}\nForm Title: ${form.title}\n\n`;
  prompt += `Total Fields: ${form.totalFields} (${form.requiredFields} required)\n\n`;
  prompt += `FIELDS TO FILL:\n`;
  prompt += `================\n\n`;
  
  for (let i = 0; i < form.fields.length; i++) {
    const field = form.fields[i];
    prompt += `${i + 1}. ${field.label || field.name || field.id}\n`;
    prompt += `   Type: ${field.type}`;
    if (field.required) prompt += ` (REQUIRED)`;
    prompt += `\n`;
    
    if (field.placeholder) {
      prompt += `   Hint: ${field.placeholder}\n`;
    }
    
    if (field.options && field.options.length > 0) {
      prompt += `   Options:\n`;
      for (const opt of field.options.slice(0, 10)) {
        prompt += `     - ${opt.text}\n`;
      }
      if (field.options.length > 10) {
        prompt += `     ... and ${field.options.length - 10} more\n`;
      }
    }
    
    if (field.currentValue) {
      prompt += `   Current Value: ${field.currentValue}\n`;
    }
    
    prompt += `\n`;
  }
  
  return prompt;
}

export default {
  extractFormFields,
  formatFormForLLM,
};
