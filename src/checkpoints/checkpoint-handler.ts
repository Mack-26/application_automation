/**
 * Human-in-the-loop checkpoint handler
 */

import * as readline from 'readline';
import { getBrowserManager } from '../browser/browser-manager';
import { getLogger } from '../log/logger';
import {
  getLoginIndicators,
  getCaptchaIndicators,
  getEmailVerificationIndicators,
} from '../normalize/ats-detector';
import type { CheckpointType, Checkpoint } from '../types';

const logger = getLogger();

/**
 * Create readline interface for user input
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Wait for user to press Enter
 */
async function waitForEnter(message: string = 'Press Enter to continue...'): Promise<void> {
  const rl = createReadlineInterface();
  
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Detect if login is required on current page
 */
export async function detectLogin(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  const indicators = getLoginIndicators();
  
  for (const selector of indicators) {
    try {
      // Handle text-based selectors
      if (selector.startsWith('text=')) {
        const textContent = await page.textContent('body');
        const searchText = selector.replace('text=', '').toLowerCase();
        if (textContent?.toLowerCase().includes(searchText)) {
          return true;
        }
      } else {
        const element = await page.$(selector);
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
 * Detect if CAPTCHA is present AND needs to be solved on current page
 * Very strict detection to avoid false positives
 */
export async function detectCaptcha(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  
  // Check for visible CAPTCHA challenge modal/popup
  const challengeSelectors = [
    // reCAPTCHA v2 challenge popup (the actual "I'm not a robot" challenge)
    'iframe[src*="recaptcha/api2/anchor"]',
    'iframe[src*="recaptcha/api2/bframe"]',
    // hCaptcha challenge
    'iframe[src*="hcaptcha.com/captcha"]',
    // Challenge modals
    '[class*="captcha-modal"]',
    '[class*="challenge-frame"]',
  ];
  
  for (const selector of challengeSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        // Check if visible and has reasonable size (actual challenge, not hidden)
        const box = await element.boundingBox();
        if (box && box.width > 100 && box.height > 100) {
          // Also check if it's in viewport (not just loaded in background)
          const isVisible = await element.isVisible();
          if (isVisible) {
            logger.debug(`[CAPTCHA] Detected active challenge: ${selector}`);
            return true;
          }
        }
      }
    } catch {
      continue;
    }
  }
  
  // Check for CAPTCHA error messages that require solving
  const errorIndicators = [
    'text="Please complete the security check"',
    'text="Verify you are human"',
    'text="Please prove you are human"',
  ];
  
  const pageText = await page.textContent('body') || '';
  const lowerText = pageText.toLowerCase();
  
  for (const phrase of ['please complete the security check', 'please prove you are human']) {
    if (lowerText.includes(phrase)) {
      logger.debug(`[CAPTCHA] Detected challenge text: "${phrase}"`);
      return true;
    }
  }
  
  return false;
}

/**
 * Detect if email verification is required
 */
export async function detectEmailVerification(): Promise<boolean> {
  const browser = getBrowserManager();
  const page = browser.getPage();
  const indicators = getEmailVerificationIndicators();
  
  const pageText = await page.textContent('body') || '';
  const lowerText = pageText.toLowerCase();
  
  for (const indicator of indicators) {
    // Handle text-based indicators
    if (indicator.startsWith("text='") || indicator.startsWith('text="')) {
      const searchText = indicator.replace(/^text=['"]|['"]$/g, '').toLowerCase();
      if (lowerText.includes(searchText)) {
        return true;
      }
    } else {
      try {
        const element = await page.$(indicator);
        if (element && await element.isVisible()) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  
  return false;
}

/**
 * Detect checkpoint type on current page
 */
export async function detectCheckpoint(): Promise<CheckpointType | null> {
  if (await detectLogin()) {
    return 'login';
  }
  
  if (await detectCaptcha()) {
    return 'captcha';
  }
  
  if (await detectEmailVerification()) {
    return 'email_verification';
  }
  
  return null;
}

/**
 * Handle a checkpoint - pause and wait for user
 */
export async function handleCheckpoint(type: CheckpointType): Promise<Checkpoint> {
  const checkpoint: Checkpoint = {
    type,
    message: getCheckpointMessage(type),
    detected_at: new Date().toISOString(),
  };
  
  logger.checkpoint(type, checkpoint.message);
  
  // Take screenshot before checkpoint
  const browser = getBrowserManager();
  await browser.takeScreenshot(`checkpoint-${type}`);
  
  // Wait for user to complete the action
  await waitForEnter();
  
  // Wait for any page changes
  await browser.waitForUserSignal();
  
  checkpoint.resolved_at = new Date().toISOString();
  
  logger.info(`Checkpoint resolved: ${type}`);
  
  return checkpoint;
}

/**
 * Get user-friendly message for checkpoint type
 */
function getCheckpointMessage(type: CheckpointType): string {
  switch (type) {
    case 'login':
      return 'Login required. Please log in to the application system in the browser window.';
    case 'captcha':
      return 'CAPTCHA detected. Please solve the CAPTCHA in the browser window.';
    case 'email_verification':
      return 'Email verification required. Please check your email and complete verification.';
    case 'manual_input':
      return 'Manual input required. Please complete any remaining fields in the browser.';
  }
}

/**
 * Check for checkpoints and handle if found
 * Returns true if a checkpoint was handled
 */
export async function checkAndHandleCheckpoint(): Promise<boolean> {
  const checkpointType = await detectCheckpoint();
  
  if (checkpointType) {
    await handleCheckpoint(checkpointType);
    return true;
  }
  
  return false;
}

/**
 * Prompt user to confirm submission
 */
export async function confirmSubmission(company: string, role: string): Promise<boolean> {
  const rl = createReadlineInterface();
  
  return new Promise((resolve) => {
    console.log('\n');
    logger.info(`Ready to submit application for ${company} - ${role}`);
    
    rl.question('Submit application? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Prompt user to skip or retry a failed application
 */
export async function handleFailure(
  company: string,
  role: string,
  error: string
): Promise<'retry' | 'skip' | 'manual'> {
  const rl = createReadlineInterface();
  
  return new Promise((resolve) => {
    console.log('\n');
    logger.error(`Failed to process application for ${company} - ${role}`);
    logger.error(`Error: ${error}`);
    
    rl.question('(r)etry, (s)kip, or complete (m)anually?: ', (answer) => {
      rl.close();
      const lower = answer.toLowerCase();
      
      if (lower === 'r' || lower === 'retry') {
        resolve('retry');
      } else if (lower === 'm' || lower === 'manual') {
        resolve('manual');
      } else {
        resolve('skip');
      }
    });
  });
}

export default {
  detectLogin,
  detectCaptcha,
  detectEmailVerification,
  detectCheckpoint,
  handleCheckpoint,
  checkAndHandleCheckpoint,
  confirmSubmission,
  handleFailure,
};

