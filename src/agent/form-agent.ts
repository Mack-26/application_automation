/**
 * Agentic Form Filler
 * 
 * An AI agent that dynamically interacts with forms by:
 * 1. Observing the current page state
 * 2. Deciding what action to take (fill, click, scroll)
 * 3. Executing the action
 * 4. Repeating until the form is complete
 */

import { Page } from 'playwright';
import { getLogger } from '../log/logger';
import { getResumeText } from '../utils/pdf-reader';
import type { CandidateProfile, Job, ATSType } from '../types';

const logger = getLogger();

/**
 * Action types the agent can take
 */
type ActionType = 
  | 'fill_field'      // Fill a text input
  | 'select_option'   // Select from dropdown
  | 'click_button'    // Click a button (Add, Next, etc.)
  | 'click_element'   // Click any element
  | 'scroll'          // Scroll the page
  | 'wait'            // Wait for something
  | 'done'            // Form section complete
  | 'need_help';      // Need human intervention

interface AgentAction {
  type: ActionType;
  target?: string;        // Selector or description
  value?: string;         // Value to fill
  reason: string;         // Why this action
}

interface PageObservation {
  url: string;
  title: string;
  visibleText: string;
  formFields: ObservedField[];
  buttons: ObservedButton[];
  errors: string[];
  currentSection?: string;
}

interface ObservedField {
  selector: string;
  label: string;
  type: string;
  value: string;
  required: boolean;
  isEmpty: boolean;
  isVisible?: boolean;
  options?: string[] | Array<{ text: string; value: string }>;
}

interface ObservedButton {
  selector: string;
  text: string;
  type: 'add' | 'next' | 'submit' | 'other';
}

/**
 * Observe the current page state
 * Captures ALL form fields including hidden ones
 */
async function observePage(page: Page): Promise<PageObservation> {
  const observation = await page.evaluate(() => {
    const result: any = {
      url: window.location.href,
      title: document.title,
      visibleText: '',
      formFields: [],
      buttons: [],
      errors: [],
    };

    // Get visible text (limited)
    const bodyText = document.body.innerText || '';
    result.visibleText = bodyText.substring(0, 2000);

    // Find current section (Workday-style progress indicators)
    const activeStep = document.querySelector('[class*="active"] [class*="step"], [aria-current="step"], .current-step');
    if (activeStep) {
      result.currentSection = activeStep.textContent?.trim();
    }

    // Extract ALL form fields (including hidden ones that might become visible)
    // This captures the entire form structure, not just what's visible
    // EXCLUDE overlay UI elements (job-agent-overlay)
    const overlayUI = document.getElementById('job-agent-overlay');
    const allInputs = document.querySelectorAll('input, textarea, select');
    const processedSelectors = new Set<string>();
    
    allInputs.forEach((input, idx) => {
      const el = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      
      // Skip if inside overlay UI
      if (overlayUI && overlayUI.contains(el)) return;
      
      // Skip hidden inputs (but include ones that might be shown)
      if (el instanceof HTMLInputElement && el.type === 'hidden') return;
      
      // Get unique selector
      let selector = '';
      if (el.id) {
        selector = `#${el.id}`;
      } else if (el.name) {
        selector = `[name="${el.name}"]`;
      } else {
        selector = `input:nth-of-type(${idx + 1})`;
      }
      
      // Skip duplicates
      if (processedSelectors.has(selector)) return;
      processedSelectors.add(selector);
      
      // Get label
      let label = '';
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        if (labelEl) label = labelEl.textContent?.trim() || '';
      }
      
      if (!label) {
        // Try parent label or nearby text
        const parent = el.closest('label, .field, [class*="field"], [class*="form-group"], [class*="form-field"]');
        if (parent) {
          const labelText = parent.querySelector('label, .label, [class*="label"], [class*="Label"]');
          if (labelText) label = labelText.textContent?.trim() || '';
        }
      }
      
      // Get placeholder, aria-label, or name as fallback
      if (!label) {
        if (el instanceof HTMLInputElement) {
          label = el.getAttribute('aria-label') || el.placeholder || el.name || '';
        } else if (el instanceof HTMLTextAreaElement) {
          label = el.getAttribute('aria-label') || el.placeholder || el.name || '';
        }
      }
      
      // Final fallback
      if (!label) label = `Field ${idx + 1}`;

      // Check if visible (but include anyway for full form context)
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && 
                       rect.top < window.innerHeight + 1000 && rect.bottom > -1000; // Expanded viewport

      const field: any = {
        selector: selector,
        label: label.replace(/\s+/g, ' ').trim(),
        type: el.tagName.toLowerCase() === 'select' ? 'select' : (el as HTMLInputElement).type || 'text',
        value: el.value || '',
        required: el.required || el.getAttribute('aria-required') === 'true',
        isEmpty: !el.value || el.value === '',
        isVisible: isVisible,
      };

      // Get select options (all of them, not just visible)
      if (el.tagName.toLowerCase() === 'select') {
        field.options = Array.from((el as HTMLSelectElement).options).map(o => ({
          text: o.text.trim(),
          value: o.value,
        }));
      }

      result.formFields.push(field);
    });

    // Find buttons (especially Add, Next, Continue, Submit)
    // EXCLUDE overlay UI buttons (reuse overlayUI variable)
    const buttonSelectors = [
      'button',
      'a[role="button"]',
      '[class*="btn"]',
      'input[type="submit"]',
      'input[type="button"]',
    ];
    
    buttonSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach((btn) => {
        const el = btn as HTMLElement;
        
        // Skip if inside overlay UI
        if (overlayUI && overlayUI.contains(el)) return;
        
        const text = el.textContent?.trim().toLowerCase() || '';
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
        
        // Check visibility
        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        if (!isVisible) return;

        // Check if button is enabled/clickable
        const isDisabled = el.hasAttribute('disabled') || 
                          el.getAttribute('aria-disabled') === 'true' ||
                          (el as HTMLButtonElement).disabled ||
                          el.classList.contains('disabled');
        
        // Check if element is actually clickable (not just visible)
        const style = window.getComputedStyle(el);
        const isClickable = style.pointerEvents !== 'none' && 
                           style.opacity !== '0' &&
                           !isDisabled;

        let buttonType: 'add' | 'next' | 'submit' | 'other' = 'other';
        
        if (text.includes('add') || ariaLabel.includes('add')) {
          buttonType = 'add';
        } else if (text.includes('next') || text.includes('continue') || text.includes('save and continue')) {
          buttonType = 'next';
        } else if (text.includes('submit') || text.includes('apply')) {
          buttonType = 'submit';
        }

        // Only track enabled, clickable buttons
        if (isClickable && (buttonType !== 'other' || text.length < 30)) {
          result.buttons.push({
            selector: el.id ? `#${el.id}` : `button:has-text("${el.textContent?.trim()}")`,
            text: el.textContent?.trim() || '',
            type: buttonType,
          });
        }
      });
    });

    // Find error messages
    const errorSelectors = [
      '[class*="error"]',
      '[class*="invalid"]',
      '[role="alert"]',
      '.validation-message',
    ];
    
    errorSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const text = (el as HTMLElement).textContent?.trim();
        if (text && text.length < 200) {
          result.errors.push(text);
        }
      });
    });

    return result;
  });

  return observation as PageObservation;
}

/**
 * Generate the agent prompt with full resume text
 */
function getAgentPrompt(
  observation: PageObservation,
  resumeText: string,
  job: Job,
  actionHistory: string[]
): string {
  // Format form fields - show ALL fields, mark visible ones
  const fieldsText = observation.formFields.map((f, i) => {
    let line = `${i + 1}. [${f.type}] "${f.label}" ${f.required ? '*' : ''}`;
    if (!f.isVisible) line += ' (hidden/not visible)';
    if (f.isEmpty) {
      line += ' (empty)';
    } else {
      line += ` = "${f.value.substring(0, 50)}"`;
    }
    if (f.options && Array.isArray(f.options)) {
      const opts = f.options.slice(0, 10).map((o: any) => typeof o === 'string' ? o : o.text);
      line += ` Options: [${opts.join(', ')}${f.options.length > 10 ? '...' : ''}]`;
    }
    return line;
  }).join('\n');
  
  return `You are an AI agent filling out a job application form. Your goal is to complete the form using the candidate's resume.

CURRENT PAGE STATE:
==================
URL: ${observation.url}
Section: ${observation.currentSection || 'Unknown'}
${observation.errors.length > 0 ? `\nERRORS ON PAGE:\n${observation.errors.join('\n')}` : ''}

ALL FORM FIELDS (including hidden ones that may become visible):
${fieldsText || 'No form fields found'}

AVAILABLE BUTTONS (only click these - they are enabled and clickable):
${observation.buttons.length > 0 
  ? observation.buttons.map(b => `- [${b.type}] "${b.text}"`).join('\n')
  : 'No clickable buttons found - focus on filling fields'}

IMPORTANT: Only click buttons from the AVAILABLE BUTTONS list above. Do NOT try to click buttons that aren't listed.

CANDIDATE'S RESUME:
===================
${resumeText.substring(0, 4000)}${resumeText.length > 4000 ? '\n... (truncated)' : ''}

JOB BEING APPLIED TO:
====================
Company: ${job.company}
Position: ${job.role}
Location: ${job.location}

RECENT ACTIONS:
${actionHistory.slice(-5).join('\n') || 'None yet'}

INSTRUCTIONS:
1. Read the resume carefully to extract all relevant information
2. Look at ALL form fields (including hidden ones) - some may become visible after clicking buttons
3. If you see an "Add" button in AVAILABLE BUTTONS, click it FIRST to reveal more fields
4. Fill fields with appropriate data from the resume - extract exact values (dates, company names, etc.)
5. For dropdowns, match the EXACT option text from the available options
6. When a section is complete and all visible fields are filled, click "Next" or "Continue" (if available in AVAILABLE BUTTONS)
7. Be precise - use exact dates, company names, and values from the resume
8. If there's an error, try to fix it
9. If no buttons are available, focus on filling empty fields

Respond with ONE action in JSON format:
{
  "type": "fill_field" | "select_option" | "click_button" | "scroll" | "wait" | "done" | "need_help",
  "target": "<selector or button text>",
  "value": "<value to fill if applicable>",
  "reason": "<brief explanation>"
}

Examples:
- {"type": "click_button", "target": "Add", "reason": "Need to add work experience entry"} (ONLY if "Add" is in AVAILABLE BUTTONS)
- {"type": "fill_field", "target": "#company", "value": "AuxoAI", "reason": "Filling company name from resume"}
- {"type": "select_option", "target": "#degree", "value": "Master's Degree", "reason": "Selecting degree type from resume"}
- {"type": "done", "reason": "All visible fields are filled, ready for next section"}

CRITICAL: For click_button actions, the "target" MUST match exactly one of the button texts from AVAILABLE BUTTONS. Do NOT invent button names.`;
}

/**
 * Parse action from AI response text - handles various formats
 */
function parseActionFromText(text: string): AgentAction | null {
  // Try to find JSON in the response
  const jsonPatterns = [
    /```json\s*([\s\S]*?)```/,      // ```json ... ```
    /```\s*([\s\S]*?)```/,           // ``` ... ```
    /(\{[\s\S]*?"type"[\s\S]*?\})/,  // Raw JSON with "type"
  ];
  
  for (const pattern of jsonPatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.type) {
          return parsed as AgentAction;
        }
      } catch {
        continue;
      }
    }
  }
  
  // Try to parse the whole thing as JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.type) {
      return parsed as AgentAction;
    }
  } catch {
    // Continue to text parsing
  }
  
  // Fallback: Parse natural language responses
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('click') && lowerText.includes('add')) {
    return { type: 'click_button', target: 'Add', reason: 'Detected need to click Add button' };
  }
  if (lowerText.includes('click') && (lowerText.includes('next') || lowerText.includes('continue'))) {
    return { type: 'click_button', target: 'Next', reason: 'Detected need to click Next' };
  }
  if (lowerText.includes('complete') || lowerText.includes('done') || lowerText.includes('filled')) {
    return { type: 'done', reason: 'AI indicated completion' };
  }
  if (lowerText.includes('help') || lowerText.includes('cannot') || lowerText.includes("can't")) {
    return { type: 'need_help', reason: 'AI needs assistance' };
  }
  
  return null;
}

/**
 * Call AI to decide next action
 */
async function decideAction(
  prompt: string,
  apiKey: string,
  model: string,
  provider: 'openai' | 'huggingface'
): Promise<AgentAction> {
  let response: Response;
  
  // Simplified prompt suffix for better JSON output
  const jsonReminder = '\n\nIMPORTANT: Respond with ONLY a JSON object, no other text. Example: {"type": "fill_field", "target": "#name", "value": "John", "reason": "filling name"}';
  
  if (provider === 'huggingface') {
    response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: `${model}:featherless-ai`,
        messages: [{ role: 'user', content: prompt + jsonReminder }],
        max_tokens: 500,
        temperature: 0.2,
      }),
    });
  } else {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.2,
      }),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[Agent] AI API error: ${response.status} - ${errorText}`);
    throw new Error(`AI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  logger.debug(`[Agent] AI response: ${content.substring(0, 200)}...`);
  
  // Use robust parsing
  const action = parseActionFromText(content);
  if (action) {
    return action;
  }
  
  logger.warn(`[Agent] Could not parse AI response: ${content.substring(0, 100)}`);
  return { type: 'need_help', reason: 'Could not parse AI response - try manual filling' };
}

/**
 * Execute an action on the page
 */
async function executeAction(page: Page, action: AgentAction): Promise<boolean> {
  logger.info(`[Agent] Action: ${action.type} - ${action.reason}`);
  
  try {
    switch (action.type) {
      case 'fill_field': {
        if (!action.target || !action.value) return false;
        
        // Try multiple selector strategies
        let element = await page.$(action.target);
        
        if (!element) {
          // Try finding by label text
          element = await page.$(`input[aria-label*="${action.target}" i], textarea[aria-label*="${action.target}" i]`);
        }
        
        if (!element) {
          // Try finding by nearby label
          const label = await page.$(`label:has-text("${action.target}")`);
          if (label) {
            const forId = await label.getAttribute('for');
            if (forId) {
              element = await page.$(`#${forId}`);
            }
          }
        }
        
        if (element) {
          await element.click({ timeout: 2000 });
          await element.fill('');
          await element.fill(action.value, { timeout: 2000 });
          // No delay needed - fill is synchronous
          return true;
        }
        
        logger.warn(`[Agent] Could not find field: ${action.target}`);
        return false;
      }

      case 'select_option': {
        if (!action.target || !action.value) return false;
        
        const select = await page.$(action.target);
        if (select) {
          try {
            await select.selectOption({ label: action.value });
            return true;
          } catch {
            // Try clicking and selecting for custom dropdowns
            await select.click({ timeout: 2000 });
            // Wait for dropdown to appear (max 500ms)
            await Promise.race([
              page.waitForSelector('[role="option"], li[role="option"]', { timeout: 500 }).catch(() => null),
              page.waitForTimeout(100)
            ]);
            const option = await page.$(`[role="option"]:has-text("${action.value}"), li:has-text("${action.value}")`);
            if (option) {
              await option.click({ timeout: 2000 });
              return true;
            }
          }
        }
        return false;
      }

      case 'click_button': {
        if (!action.target) return false;
        
        // Try multiple strategies to find button
        let button = await page.$(`button:has-text("${action.target}"), a:has-text("${action.target}"), [role="button"]:has-text("${action.target}")`);
        
        // If not found, try partial match
        if (!button) {
          const buttons = await page.$$('button, a[role="button"], [role="button"]');
          for (const btn of buttons) {
            const text = await btn.textContent();
            if (text && text.toLowerCase().includes(action.target.toLowerCase())) {
              button = btn;
              break;
            }
          }
        }
        
        if (button) {
          // Check if button is enabled before clicking
          const isEnabled = await button.evaluate((el) => {
            const btn = el as HTMLElement;
            return !btn.hasAttribute('disabled') && 
                   btn.getAttribute('aria-disabled') !== 'true' &&
                   !(btn as HTMLButtonElement).disabled &&
                   !btn.classList.contains('disabled');
          });
          
          if (!isEnabled) {
            logger.warn(`[Agent] Button "${action.target}" is disabled, skipping`);
            return false;
          }
          
          try {
            await button.click({ timeout: 3000, force: false });
            // Wait for any navigation or DOM changes (max 200ms)
            await Promise.race([
              page.waitForLoadState('networkidle', { timeout: 200 }).catch(() => null),
              page.waitForTimeout(100)
            ]);
            return true;
          } catch (error) {
            logger.warn(`[Agent] Failed to click button "${action.target}": ${error}`);
            return false;
          }
        }
        
        // Get available buttons for error message
        const availableButtons = await page.$$eval('button:visible, a[role="button"]:visible, [role="button"]:visible', (buttons) => {
          return buttons.map(b => (b as HTMLElement).textContent?.trim()).filter(Boolean).slice(0, 5);
        }).catch(() => []);
        
        logger.warn(`[Agent] Could not find button: "${action.target}". Available buttons: ${availableButtons.join(', ') || 'none'}`);
        return false;
      }

      case 'click_element': {
        if (!action.target) return false;
        const element = await page.$(action.target);
        if (element) {
          await element.click({ timeout: 2000 });
          // Minimal delay for DOM updates
          await page.waitForTimeout(50);
          return true;
        }
        return false;
      }

      case 'scroll': {
        await page.evaluate(() => window.scrollBy(0, 300));
        // No delay needed for scroll
        return true;
      }

      case 'wait': {
        await page.waitForTimeout(500); // Reduced from 1000ms
        return true;
      }

      case 'done':
      case 'need_help':
        return true;

      default:
        return false;
    }
  } catch (error) {
    logger.error(`[Agent] Action failed: ${error}`);
    return false;
  }
}

/**
 * Main agent loop
 */
export async function runFormAgent(
  page: Page,
  profile: CandidateProfile,
  job: Job & { ats: ATSType },
  apiKey: string,
  model: string,
  provider: 'openai' | 'huggingface',
  maxSteps: number = 50
): Promise<{ success: boolean; steps: number; reason: string }> {
  // Load resume text
  logger.info('[Agent] Loading resume text...');
  const resumeText = await getResumeText(profile);
  if (!resumeText) {
    logger.warn('[Agent] Could not load resume text, using profile data');
  }
  
  const actionHistory: string[] = [];
  let steps = 0;
  let consecutiveFailures = 0;
  const recentActions: string[] = []; // Track recent actions to detect loops

  logger.info('[Agent] Starting agentic form filling...');

  while (steps < maxSteps) {
    steps++;
    
    // 1. Observe current page
    const observation = await observePage(page);
    logger.debug(`[Agent] Step ${steps}: ${observation.formFields.length} fields (${observation.formFields.filter(f => f.isVisible).length} visible), ${observation.buttons.length} buttons`);

    // 2. Decide action
    const prompt = getAgentPrompt(observation, resumeText || 'Resume not available', job, actionHistory);
    const action = await decideAction(prompt, apiKey, model, provider);
    
    // 3. Check for action loops (same action repeated 3+ times)
    const actionKey = `${action.type}:${action.target || ''}`;
    recentActions.push(actionKey);
    if (recentActions.length > 5) recentActions.shift();
    
    const sameActionCount = recentActions.filter(a => a === actionKey).length;
    if (sameActionCount >= 3) {
      logger.warn(`[Agent] Detected loop: same action repeated ${sameActionCount} times. Stopping.`);
      return { success: false, steps, reason: `Action loop detected: ${action.type} - ${action.target || ''}` };
    }
    
    // 4. Record action
    actionHistory.push(`Step ${steps}: ${action.type} - ${action.target || ''} - ${action.reason}`);

    // 5. Check termination conditions
    if (action.type === 'done') {
      logger.info('[Agent] Form section complete');
      return { success: true, steps, reason: action.reason };
    }

    if (action.type === 'need_help') {
      logger.warn('[Agent] Needs human help: ' + action.reason);
      return { success: false, steps, reason: action.reason };
    }

    // 6. Execute action
    try {
      const success = await executeAction(page, action);
      
      if (!success) {
        consecutiveFailures++;
        logger.debug(`[Agent] Action failed (consecutive: ${consecutiveFailures})`);
        
        // If button click failed, it might be disabled - try to continue
        if (action.type === 'click_button' && consecutiveFailures < 5) {
          logger.info(`[Agent] Button click failed, continuing to try other actions...`);
          consecutiveFailures = Math.max(0, consecutiveFailures - 1); // Don't count button failures as harshly
        }
        
        if (consecutiveFailures >= 5) {
          logger.warn('[Agent] Too many consecutive failures');
          return { success: false, steps, reason: `Too many failed actions. Last action: ${action.type} - ${action.target || ''}` };
        }
      } else {
        consecutiveFailures = 0;
      }
    } catch (error) {
      consecutiveFailures++;
      logger.error(`[Agent] Action execution error: ${error}`);
      if (consecutiveFailures >= 5) {
        return { success: false, steps, reason: `Action execution error: ${error}` };
      }
    }

    // Minimal delay between actions (reduced from 300ms)
    await page.waitForTimeout(100);
  }

  return { success: false, steps, reason: 'Max steps reached' };
}

/**
 * Integrated agent for overlay UI
 */
export class FormAgent {
  private page: Page;
  private profile: CandidateProfile;
  private job: Job & { ats: ATSType };
  private apiKey: string;
  private model: string;
  private provider: 'openai' | 'huggingface';

  constructor(
    page: Page,
    profile: CandidateProfile,
    job: Job & { ats: ATSType },
    apiKey: string,
    model: string,
    provider: 'openai' | 'huggingface'
  ) {
    this.page = page;
    this.profile = profile;
    this.job = job;
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider;
  }

  /**
   * Run agent until section complete or needs help
   */
  async fillCurrentSection(maxSteps: number = 30): Promise<{ success: boolean; message: string }> {
    const result = await runFormAgent(
      this.page,
      this.profile,
      this.job,
      this.apiKey,
      this.model,
      this.provider,
      maxSteps
    );

    return {
      success: result.success,
      message: `${result.steps} actions taken. ${result.reason}`,
    };
  }

  /**
   * Take a single agent step (for manual control)
   */
  async takeStep(): Promise<AgentAction> {
    const observation = await observePage(this.page);
    const resumeText = await getResumeText(this.profile);
    const prompt = getAgentPrompt(observation, resumeText || 'Resume not available', this.job, []);
    
    const action = await decideAction(prompt, this.apiKey, this.model, this.provider);
    await executeAction(this.page, action);
    
    return action;
  }
}

export default {
  runFormAgent,
  FormAgent,
  observePage,
};

