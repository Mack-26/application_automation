/**
 * Advanced dropdown handler for custom select components
 * Handles React-Select, Lever, Greenhouse, and other custom dropdowns
 */

import { Page, ElementHandle } from 'playwright';
import { getLogger } from '../log/logger';
import { getFormTracker } from './form-tracker';

const logger = getLogger();

interface DropdownOption {
  text: string;
  value?: string;
  element?: ElementHandle;
}

/**
 * Try to select from a native HTML select element
 */
async function tryNativeSelect(
  page: Page,
  selector: string,
  targetValue: string
): Promise<boolean> {
  try {
    const element = await page.$(selector);
    if (!element) return false;
    
    const tagName = await element.evaluate(el => el.tagName.toLowerCase());
    if (tagName !== 'select') return false;
    
    // Get all options
    const options = await page.$$eval(`${selector} option`, opts =>
      opts.map(o => ({
        value: o.getAttribute('value') || '',
        text: (o.textContent || '').trim().toLowerCase()
      }))
    );
    
    const lowerTarget = targetValue.toLowerCase();
    
    // Find matching option
    const match = options.find(o =>
      o.text === lowerTarget ||
      o.text.includes(lowerTarget) ||
      lowerTarget.includes(o.text) ||
      o.value.toLowerCase() === lowerTarget
    );
    
    if (match) {
      await page.selectOption(selector, match.value);
      logger.debug(`Native select: selected "${match.text}"`);
      return true;
    }
    
    return false;
  } catch (err) {
    logger.debug(`Native select failed: ${err}`);
    return false;
  }
}

/**
 * Handle custom dropdown (click to open, then select from list)
 */
async function tryCustomDropdown(
  page: Page,
  container: ElementHandle,
  targetValue: string
): Promise<boolean> {
  try {
    const lowerTarget = targetValue.toLowerCase();
    
    // Find clickable trigger element
    const triggerSelectors = [
      '[class*="select"]',
      '[class*="dropdown"]',
      '[role="combobox"]',
      '[role="listbox"]',
      'button',
      '[class*="trigger"]',
      '[class*="control"]',
    ];
    
    let trigger: ElementHandle | null = null;
    
    // First try clicking the container itself
    try {
      await container.click();
      await page.waitForTimeout(300);
    } catch {
      // Try finding a trigger inside
      for (const sel of triggerSelectors) {
        trigger = await container.$(sel);
        if (trigger) {
          try {
            await trigger.click();
            await page.waitForTimeout(300);
            break;
          } catch {
            continue;
          }
        }
      }
    }
    
    // Wait for dropdown options to appear
    await page.waitForTimeout(500);
    
    // Find dropdown options (could be in a portal/overlay)
    const optionSelectors = [
      '[role="option"]',
      '[class*="option"]',
      '[class*="menu-item"]',
      '[class*="list-item"]',
      '[class*="dropdown-item"]',
      'li[id*="option"]',
      'li[class*="select"]',
      'div[id*="option"]',
    ];
    
    // Search in entire page (options might be in a portal)
    for (const optSel of optionSelectors) {
      const options = await page.$$(optSel);
      
      if (options.length > 0) {
        for (const opt of options) {
          const text = await opt.textContent();
          if (text && text.toLowerCase().includes(lowerTarget)) {
            await opt.click();
            logger.debug(`Custom dropdown: selected "${text.trim()}"`);
            return true;
          }
        }
        
        // Try partial match
        for (const opt of options) {
          const text = await opt.textContent();
          if (text) {
            const lowerText = text.toLowerCase();
            // Check if any word matches
            const targetWords = lowerTarget.split(/\s+/);
            const textWords = lowerText.split(/\s+/);
            
            if (targetWords.some(tw => textWords.some(txtW => txtW.includes(tw) || tw.includes(txtW)))) {
              await opt.click();
              logger.debug(`Custom dropdown: selected "${text.trim()}" (partial match)`);
              return true;
            }
          }
        }
      }
    }
    
    // Close dropdown if nothing selected (press Escape)
    await page.keyboard.press('Escape');
    
    return false;
  } catch (err) {
    logger.debug(`Custom dropdown failed: ${err}`);
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
}

/**
 * Handle searchable/typeahead dropdown
 */
async function tryTypeaheadDropdown(
  page: Page,
  container: ElementHandle,
  targetValue: string
): Promise<boolean> {
  try {
    // Find input inside the container
    const input = await container.$('input');
    if (!input) return false;
    
    // Clear and type the value
    await input.click();
    await page.waitForTimeout(200);
    await input.fill('');
    await input.type(targetValue, { delay: 50 });
    
    // Wait for results
    await page.waitForTimeout(800);
    
    // Find and click first matching option
    const optionSelectors = [
      '[role="option"]',
      '[class*="option"]:not([class*="no-option"])',
      '[class*="menu-item"]',
      'li[id*="option"]',
    ];
    
    for (const optSel of optionSelectors) {
      const options = await page.$$(optSel);
      if (options.length > 0) {
        // Click first visible option
        for (const opt of options) {
          const isVisible = await opt.isVisible();
          if (isVisible) {
            const text = await opt.textContent();
            await opt.click();
            logger.debug(`Typeahead dropdown: selected "${text?.trim()}"`);
            return true;
          }
        }
      }
    }
    
    // Try pressing Enter if autocomplete
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    
    return false;
  } catch (err) {
    logger.debug(`Typeahead dropdown failed: ${err}`);
    return false;
  }
}

/**
 * Main function to fill any type of dropdown
 */
export async function fillDropdown(
  page: Page,
  selector: string,
  targetValue: string,
  label?: string
): Promise<boolean> {
  logger.debug(`Attempting to fill dropdown: ${label || selector} with "${targetValue}"`);
  
  // Try native select first
  if (await tryNativeSelect(page, selector, targetValue)) {
    return true;
  }
  
  // Get the element/container
  const element = await page.$(selector);
  if (!element) {
    logger.debug(`Dropdown element not found: ${selector}`);
    return false;
  }
  
  // Try finding the dropdown container (might be a parent)
  let container = element;
  
  // Check if element is inside a dropdown container
  const parentContainer = await element.$('xpath=ancestor::div[contains(@class, "select") or contains(@class, "dropdown")][1]');
  if (parentContainer) {
    container = parentContainer;
  }
  
  // Try typeahead first (if there's an input)
  const hasInput = await container.$('input') !== null;
  if (hasInput) {
    if (await tryTypeaheadDropdown(page, container, targetValue)) {
      return true;
    }
  }
  
  // Try custom dropdown
  if (await tryCustomDropdown(page, container, targetValue)) {
    return true;
  }
  
  logger.debug(`Could not fill dropdown: ${label || selector}`);
  return false;
}

/**
 * Fill education-related dropdowns
 */
export async function fillEducationDropdowns(
  page: Page,
  education: {
    school: string;
    degree: string;
    field?: string;
    graduation: string; // YYYY-MM format
  }
): Promise<number> {
  let filled = 0;
  
  // Parse graduation date
  const [gradYear, gradMonth] = education.graduation.split('-');
  const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[parseInt(gradMonth)] || '';
  
  // Common degree mappings
  const degreeMap: Record<string, string[]> = {
    "Bachelor's": ["bachelor", "bs", "ba", "b.s.", "b.a.", "undergraduate"],
    "Master's": ["master", "ms", "ma", "m.s.", "m.a.", "graduate"],
    "PhD": ["phd", "ph.d.", "doctorate", "doctoral"],
    "Associate's": ["associate", "aa", "as", "a.a.", "a.s."],
    "High School": ["high school", "hs", "diploma"],
  };
  
  // Find and fill education-related dropdowns by label
  const dropdownContainers = await page.$$('[class*="select"], [class*="dropdown"], [role="combobox"], select');
  
  for (const container of dropdownContainers) {
    // Try to find associated label
    const id = await container.getAttribute('id');
    const name = await container.getAttribute('name');
    const ariaLabel = await container.getAttribute('aria-label');
    const placeholder = await container.getAttribute('placeholder') ||
                        await container.$eval('input', (el) => el.placeholder).catch(() => '') ||
                        await container.$eval('[class*="placeholder"]', (el) => el.textContent).catch(() => '');
    
    let label = ariaLabel || placeholder || '';
    
    // Try to find label element
    if (!label && id) {
      const labelEl = await page.$(`label[for="${id}"]`);
      if (labelEl) {
        label = (await labelEl.textContent()) || '';
      }
    }
    
    // Try parent/sibling label
    if (!label) {
      const parentLabel = await container.$('xpath=ancestor::div[1]//label | preceding-sibling::label[1]');
      if (parentLabel) {
        label = (await parentLabel.textContent()) || '';
      }
    }
    
    const lowerLabel = label.toLowerCase();
    
    // School/University dropdown
    if (lowerLabel.includes('school') || lowerLabel.includes('university') || lowerLabel.includes('institution')) {
      const tracker = getFormTracker();
      const selector = id ? `#${id}` : (name ? `[name="${name}"]` : '');
      
      if (tracker.isFieldFilled(selector || 'school')) continue;
      
      if (selector && await fillDropdown(page, selector, education.school, label)) {
        tracker.recordFill(selector, label || 'School', education.school, 'Education');
        filled++;
        continue;
      }
      if (await tryTypeaheadDropdown(page, container, education.school)) {
        tracker.recordFill(selector || 'school', label || 'School', education.school, 'Education');
        filled++;
        continue;
      }
    }
    
    // Degree dropdown
    if (lowerLabel.includes('degree') || lowerLabel.includes('education level')) {
      const tracker = getFormTracker();
      const selector = id ? `#${id}` : (name ? `[name="${name}"]` : '');
      
      if (tracker.isFieldFilled(selector || 'degree')) continue;
      
      let degreeValue = education.degree;
      for (const [key, aliases] of Object.entries(degreeMap)) {
        if (education.degree.toLowerCase().includes(key.toLowerCase()) ||
            aliases.some(a => education.degree.toLowerCase().includes(a))) {
          degreeValue = key;
          break;
        }
      }
      
      if (selector && await fillDropdown(page, selector, degreeValue, label)) {
        tracker.recordFill(selector, label || 'Degree', degreeValue, 'Education');
        filled++;
        continue;
      }
      if (await tryCustomDropdown(page, container, degreeValue)) {
        tracker.recordFill(selector || 'degree', label || 'Degree', degreeValue, 'Education');
        filled++;
        continue;
      }
    }
    
    // Major/Field of Study dropdown
    if (lowerLabel.includes('major') || lowerLabel.includes('field') || lowerLabel.includes('concentration')) {
      if (education.field) {
        const selector = id ? `#${id}` : (name ? `[name="${name}"]` : '');
        if (selector && await fillDropdown(page, selector, education.field, label)) {
          filled++;
          continue;
        }
      }
    }
    
    // End date month / Graduation month
    if (lowerLabel.includes('month') || (lowerLabel.includes('end') && lowerLabel.includes('date'))) {
      const selector = id ? `#${id}` : (name ? `[name="${name}"]` : '');
      if (selector && await fillDropdown(page, selector, monthName, label)) {
        filled++;
        continue;
      }
      if (await tryCustomDropdown(page, container, monthName)) {
        filled++;
        continue;
      }
    }
    
    // End date year / Graduation year
    if (lowerLabel.includes('year') || lowerLabel.includes('graduation')) {
      const selector = id ? `#${id}` : (name ? `[name="${name}"]` : '');
      // Try as dropdown
      if (selector && await fillDropdown(page, selector, gradYear, label)) {
        filled++;
        continue;
      }
      // Try as text input
      try {
        const input = await container.$('input');
        if (input) {
          await input.fill(gradYear);
          filled++;
          continue;
        }
      } catch {}
    }
  }
  
  return filled;
}

/**
 * Fill work authorization dropdown
 */
export async function fillWorkAuthDropdown(
  page: Page,
  authorizedToWork: boolean,
  requiresSponsorship: boolean
): Promise<boolean> {
  let filled = false;
  
  // Find all form fields (dropdowns and their containers)
  const formFields = await page.$$('[class*="field"], [class*="form-group"], [class*="question"], div:has(select), div:has([role="combobox"])');
  
  for (const field of formFields) {
    const labelText = await field.textContent() || '';
    const lowerLabel = labelText.toLowerCase();
    
    // Skip if already processed or no relevant question
    if (!lowerLabel.includes('authorized') && 
        !lowerLabel.includes('sponsor') && 
        !lowerLabel.includes('visa') &&
        !lowerLabel.includes('legally') &&
        !lowerLabel.includes('employment eligibility')) {
      continue;
    }
    
    // Find dropdown within this field
    const dropdown = await field.$('[class*="select"], select, [role="combobox"], [role="listbox"]');
    if (!dropdown) continue;
    
    // Work authorization question: "Are you legally authorized to work..."
    if ((lowerLabel.includes('authorized') || lowerLabel.includes('legally')) && 
        lowerLabel.includes('work')) {
      const tracker = getFormTracker();
      const fieldKey = 'work_auth_' + lowerLabel.substring(0, 20);
      
      if (tracker.isFieldFilled(fieldKey)) continue;
      
      const targetValue = authorizedToWork ? 'Yes' : 'No';
      
      if (await selectYesNo(page, dropdown, targetValue)) {
        tracker.recordFill(fieldKey, 'Work Authorization', targetValue, 'Compliance');
        filled = true;
      }
    }
    
    // Sponsorship question: "Will you now or in the future require sponsorship..."
    else if (lowerLabel.includes('sponsor') || 
             (lowerLabel.includes('visa') && !lowerLabel.includes('authorized'))) {
      const tracker = getFormTracker();
      const fieldKey = 'sponsorship_' + lowerLabel.substring(0, 20);
      
      if (tracker.isFieldFilled(fieldKey)) continue;
      
      const targetValue = requiresSponsorship ? 'Yes' : 'No';
      
      if (await selectYesNo(page, dropdown, targetValue)) {
        tracker.recordFill(fieldKey, 'Visa Sponsorship Required', targetValue, 'Compliance');
        filled = true;
      }
    }
  }
  
  return filled;
}

/**
 * Helper to select Yes/No from a dropdown
 */
async function selectYesNo(
  page: Page,
  dropdown: ElementHandle,
  targetValue: string
): Promise<boolean> {
  try {
    // Check if it's a native select
    const tagName = await dropdown.evaluate(el => (el as HTMLElement).tagName.toLowerCase());
    if (tagName === 'select') {
      const options = await dropdown.$$eval('option', opts => 
        opts.map(o => ({ value: o.value, text: o.textContent?.trim().toLowerCase() || '' }))
      );
      
      const match = options.find(o => 
        o.text === targetValue.toLowerCase() ||
        o.text.startsWith(targetValue.toLowerCase())
      );
      
      if (match) {
        await dropdown.selectOption(match.value);
        return true;
      }
    }
    
    // Custom dropdown - click to open
    await dropdown.click();
    await page.waitForTimeout(400);
    
    // Find and click the option
    const optionSelectors = [
      '[role="option"]',
      '[class*="option"]',
      '[class*="menu-item"]',
      'li',
    ];
    
    for (const sel of optionSelectors) {
      const options = await page.$$(sel);
      for (const opt of options) {
        const text = await opt.textContent();
        const isVisible = await opt.isVisible();
        
        if (isVisible && text) {
          const lowerText = text.trim().toLowerCase();
          if (lowerText === targetValue.toLowerCase() ||
              lowerText.startsWith(targetValue.toLowerCase())) {
            await opt.click();
            await page.waitForTimeout(200);
            return true;
          }
        }
      }
    }
    
    // Close dropdown if nothing selected
    await page.keyboard.press('Escape');
    return false;
  } catch (err) {
    logger.debug(`selectYesNo failed: ${err}`);
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
}

export default {
  fillDropdown,
  fillEducationDropdowns,
  fillWorkAuthDropdown,
};

