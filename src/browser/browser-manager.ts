/**
 * Browser management module using Playwright
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import type { BrowserSettings } from '../types';
import { getLogger } from '../log/logger';

const logger = getLogger();

class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private settings: BrowserSettings;
  private userDataDir: string;
  
  constructor(settings: BrowserSettings) {
    this.settings = settings;
    this.userDataDir = path.resolve(__dirname, '../../.browser-data');
  }
  
  /**
   * Initialize the browser with persistent context
   */
  async initialize(): Promise<void> {
    logger.info('Initializing browser...');
    
    // Ensure user data directory exists for persistent cookies
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }
    
    // Clear stale lock files from previous crashed sessions
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const lockFile of lockFiles) {
      const lockPath = path.join(this.userDataDir, lockFile);
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
          logger.debug(`Cleared stale lock file: ${lockFile}`);
        } catch (err) {
          logger.warn(`Could not clear lock file ${lockFile}: ${err}`);
        }
      }
    }
    
    // Launch browser with persistent context to retain cookies
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless: this.settings.headless,
      slowMo: this.settings.slowMo,
      viewport: this.settings.viewport,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    });
    
    // Get or create page
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    
    // Set default timeout
    this.page.setDefaultTimeout(this.settings.timeout);
    
    logger.info('Browser initialized successfully');
  }
  
  /**
   * Get the current page
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }
    return this.page;
  }
  
  /**
   * Get the browser context
   */
  getContext(): BrowserContext {
    if (!this.context) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }
    return this.context;
  }
  
  /**
   * Navigate to a URL
   */
  async navigateTo(url: string): Promise<void> {
    const page = this.getPage();
    logger.debug(`Navigating to: ${url}`);
    
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.settings.timeout,
    });
    
    // Wait a bit for dynamic content
    await page.waitForTimeout(1000);
  }
  
  /**
   * Take a screenshot
   */
  async takeScreenshot(name: string, outputDir: string = './logs/screenshots'): Promise<string> {
    const page = this.getPage();
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.png`;
    const filepath = path.join(outputDir, filename);
    
    await page.screenshot({ path: filepath, fullPage: true });
    logger.debug(`Screenshot saved: ${filepath}`);
    
    return filepath;
  }
  
  /**
   * Wait for user interaction (human checkpoint)
   */
  async waitForUserSignal(): Promise<void> {
    // Browser stays open, this is called after user input in CLI
    const page = this.getPage();
    
    // Wait a moment for any actions to complete
    await page.waitForTimeout(500);
  }
  
  /**
   * Check if an element exists on the page
   */
  async elementExists(selector: string): Promise<boolean> {
    const page = this.getPage();
    try {
      const element = await page.$(selector);
      return element !== null;
    } catch {
      return false;
    }
  }
  
  /**
   * Check if any of the selectors match
   */
  async anyElementExists(selectors: string[]): Promise<string | null> {
    for (const selector of selectors) {
      if (await this.elementExists(selector)) {
        return selector;
      }
    }
    return null;
  }
  
  /**
   * Wait for navigation after an action
   */
  async waitForNavigation(timeout?: number): Promise<void> {
    const page = this.getPage();
    try {
      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: timeout || this.settings.timeout,
      });
    } catch {
      // Navigation might not happen, that's okay
    }
  }
  
  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.getPage().url();
  }
  
  /**
   * Close the browser
   */
  async close(): Promise<void> {
    logger.info('Closing browser...');
    
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
    
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    logger.info('Browser closed');
  }
}

// Singleton instance
let browserManager: BrowserManager | null = null;

export function getBrowserManager(settings?: BrowserSettings): BrowserManager {
  if (!browserManager && settings) {
    browserManager = new BrowserManager(settings);
  }
  
  if (!browserManager) {
    throw new Error('BrowserManager not initialized. Provide settings on first call.');
  }
  
  return browserManager;
}

export async function initializeBrowser(settings: BrowserSettings): Promise<BrowserManager> {
  const manager = getBrowserManager(settings);
  await manager.initialize();
  return manager;
}

export async function closeBrowser(): Promise<void> {
  if (browserManager) {
    await browserManager.close();
    browserManager = null;
  }
}

export default {
  getBrowserManager,
  initializeBrowser,
  closeBrowser,
};

