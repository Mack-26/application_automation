/**
 * Browser Overlay UI
 * 
 * A floating panel injected into the browser page that provides
 * interactive controls for form filling:
 * - Detect Fields: Scan the current page for form fields
 * - Fill Form: Apply AI-generated answers to detected fields
 * - Sign Up: Auto-fill registration forms
 */

import type { Page } from 'playwright';
import { getLogger } from '../log/logger';
import { extractFormFields } from '../autofill/form-extractor';
import { getAIConfig } from '../autofill/ai-form-filler';
import { runFormAgent } from '../agent/form-agent';
import type { CandidateProfile, Job, ATSType } from '../types';

const logger = getLogger();

// Overlay CSS styles
const OVERLAY_STYLES = `
  #job-agent-overlay {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 380px;
    max-height: 80vh;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #0f3460;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: #e8e8e8;
    z-index: 2147483647;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  #job-agent-overlay.minimized {
    width: 50px;
    height: 50px;
    max-height: 50px;
    border-radius: 50%;
    cursor: pointer;
  }
  
  #job-agent-overlay.minimized .overlay-content {
    display: none;
  }
  
  #job-agent-overlay.minimized .overlay-header {
    padding: 0;
    justify-content: center;
    background: transparent;
  }
  
  #job-agent-overlay.minimized .minimize-btn {
    display: none;
  }
  
  .overlay-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgba(15, 52, 96, 0.5);
    border-bottom: 1px solid #0f3460;
    cursor: move;
  }
  
  .overlay-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 14px;
    color: #00d4ff;
  }
  
  .overlay-title svg {
    width: 20px;
    height: 20px;
  }
  
  .minimize-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s;
  }
  
  .minimize-btn:hover {
    color: #fff;
    background: rgba(255,255,255,0.1);
  }
  
  .overlay-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  
  .overlay-section {
    margin-bottom: 16px;
  }
  
  .section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #888;
    margin-bottom: 8px;
  }
  
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
    color: #000;
  }
  
  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
  }
  
  .btn-primary:disabled {
    background: #444;
    color: #888;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
  
  .btn-secondary {
    background: rgba(255,255,255,0.1);
    color: #e8e8e8;
    border: 1px solid rgba(255,255,255,0.2);
  }
  
  .btn-secondary:hover {
    background: rgba(255,255,255,0.15);
  }
  
  .btn-success {
    background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
    color: #000;
  }
  
  .btn-success:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 255, 136, 0.3);
  }
  
  .btn-signup {
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
    color: #fff;
  }
  
  .btn-signup:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
  }
  
  .btn-agent {
    background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
    color: #fff;
    margin-bottom: 8px;
  }
  
  .btn-agent:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(155, 89, 182, 0.3);
  }
  
  .btn-quick {
    background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
    color: #fff;
    margin-bottom: 8px;
  }
  
  .btn-quick:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(243, 156, 18, 0.3);
  }
  
  .btn-group {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  
  .btn-group .btn {
    flex: 1;
  }
  
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }
  
  .status-idle { background: rgba(136,136,136,0.2); color: #888; }
  .status-detecting { background: rgba(0,212,255,0.2); color: #00d4ff; }
  .status-ready { background: rgba(0,255,136,0.2); color: #00ff88; }
  .status-filling { background: rgba(255,200,0,0.2); color: #ffc800; }
  .status-done { background: rgba(0,255,136,0.2); color: #00ff88; }
  .status-error { background: rgba(255,107,107,0.2); color: #ff6b6b; }
  
  .fields-list {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    background: rgba(0,0,0,0.2);
  }
  
  .field-item {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    transition: background 0.2s;
  }
  
  .field-item:last-child {
    border-bottom: none;
  }
  
  .field-item:hover {
    background: rgba(255,255,255,0.05);
  }
  
  .field-label {
    font-size: 12px;
    color: #aaa;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .field-type {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(0,212,255,0.2);
    color: #00d4ff;
  }
  
  .field-required {
    color: #ff6b6b;
    font-weight: bold;
  }
  
  .field-answer {
    font-size: 13px;
    color: #fff;
    padding: 6px 8px;
    background: rgba(255,255,255,0.05);
    border-radius: 4px;
    border: 1px solid transparent;
    width: 100%;
    box-sizing: border-box;
    margin-top: 4px;
  }
  
  .field-answer:focus {
    outline: none;
    border-color: #00d4ff;
    background: rgba(0,212,255,0.1);
  }
  
  .field-options {
    font-size: 11px;
    color: #666;
    margin-top: 4px;
  }
  
  .stats-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  
  .stats-row:last-child {
    border-bottom: none;
  }
  
  .stat-label {
    color: #888;
  }
  
  .stat-value {
    font-weight: 600;
    color: #00d4ff;
  }
  
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #00d4ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .log-area {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 11px;
    padding: 8px;
    background: rgba(0,0,0,0.3);
    border-radius: 6px;
    max-height: 100px;
    overflow-y: auto;
    color: #888;
  }
  
  .log-entry {
    padding: 2px 0;
  }
  
  .log-success { color: #00ff88; }
  .log-error { color: #ff6b6b; }
  .log-info { color: #00d4ff; }
`;

// Overlay HTML structure
const OVERLAY_HTML = `
<div id="job-agent-overlay">
  <div class="overlay-header">
    <div class="overlay-title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 7h-9M14 17H5M17 17a3 3 0 100-6 3 3 0 000 6zM7 7a3 3 0 100-6 3 3 0 000 6z"/>
      </svg>
      <span>Job Agent</span>
    </div>
    <button class="minimize-btn" onclick="window.__jobAgent.toggleMinimize()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 15l-6-6-6 6"/>
      </svg>
    </button>
  </div>
  
  <div class="overlay-content">
    <div class="overlay-section">
      <div class="section-title">Status</div>
      <div id="status-area">
        <span class="status-badge status-idle">● Idle</span>
      </div>
    </div>
    
    <div class="overlay-section">
      <div class="section-title">Actions</div>
      <div class="btn-group">
        <button class="btn btn-primary" id="detect-btn" onclick="window.__jobAgent.detectFields()">
          🔍 Detect
        </button>
        <button class="btn btn-success" id="fill-btn" onclick="window.__jobAgent.fillForm()" disabled>
          ✨ Fill Form
        </button>
      </div>
      <button class="btn btn-agent" id="agent-btn" onclick="window.__jobAgent.runAgent()">
        🤖 Auto-Fill Section (Agent)
      </button>
      <button class="btn btn-quick" id="quick-btn" onclick="window.__jobAgent.quickFill()">
        ⚡ Quick Fill (No AI)
      </button>
      <button class="btn btn-signup" id="signup-btn" onclick="window.__jobAgent.signUp()">
        📝 Sign Up / Login
      </button>
    </div>
    
    <div class="overlay-section" id="fields-section" style="display: none;">
      <div class="section-title">
        Detected Fields (<span id="field-count">0</span>)
      </div>
      <div class="fields-list" id="fields-list"></div>
    </div>
    
    <div class="overlay-section">
      <div class="section-title">Activity Log</div>
      <div class="log-area" id="log-area">
        <div class="log-entry log-info">Ready to detect fields...</div>
      </div>
    </div>
  </div>
</div>
`;

/**
 * Field data structure for the UI
 */
interface UIField {
  index: number;
  label: string;
  type: string;
  required: boolean;
  currentValue: string;
  options?: string[];
  aiAnswer?: string;
  selector: string;
}

/**
 * Overlay UI Manager
 */
export class OverlayUI {
  private page: Page;
  private profile: CandidateProfile;
  private job: Job & { ats: ATSType };
  private fields: UIField[] = [];
  private functionsExposed = false;
  private navigationHandler: (() => void) | null = null;
  private agentRunning = false;
  
  constructor(page: Page, profile: CandidateProfile, job: Job & { ats: ATSType }) {
    this.page = page;
    this.profile = profile;
    this.job = job;
  }
  
  /**
   * Inject the overlay UI into the page
   */
  async inject(): Promise<void> {
    logger.info('[UI] Injecting overlay UI...');
    
    // Expose functions only once (they persist across navigations)
    if (!this.functionsExposed) {
      await this.exposeFunctions();
      this.functionsExposed = true;
    }
    
    // Inject the UI elements
    await this.injectUIElements();
    
    // Set up navigation listener to re-inject on page changes
    this.setupNavigationListener();
    
    logger.info('[UI] Overlay UI injected successfully');
  }
  
  /**
   * Inject styles and HTML into the current page
   */
  private async injectUIElements(): Promise<void> {
    try {
      // Check if already injected on this page
      const exists = await this.page.evaluate(() => {
        return !!document.getElementById('job-agent-overlay');
      });
      
      if (exists) {
        logger.debug('[UI] Overlay already exists on this page');
        return;
      }
      
      // Inject styles
      await this.page.addStyleTag({ content: OVERLAY_STYLES });
      
      // Inject HTML
      await this.page.evaluate((html) => {
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container.firstElementChild!);
      }, OVERLAY_HTML);
      
      // Re-setup the window object (needed after each navigation)
      await this.page.evaluate(() => {
        (window as any).__jobAgent = {
          toggleMinimize: () => (window as any).__jobAgentToggleMinimize?.(),
          detectFields: () => (window as any).__jobAgentDetectFields?.(),
          fillForm: () => (window as any).__jobAgentFillForm?.(),
          signUp: () => (window as any).__jobAgentSignUp?.(),
          runAgent: () => (window as any).__jobAgentRunAgent?.(),
          quickFill: () => (window as any).__jobAgentQuickFill?.(),
        };
      });
      
      logger.debug('[UI] UI elements injected');
    } catch (error) {
      logger.debug(`[UI] Could not inject UI: ${error}`);
    }
  }
  
  /**
   * Set up listener to re-inject UI after navigation
   */
  private setupNavigationListener(): void {
    // Remove existing listener if any
    if (this.navigationHandler) {
      this.page.removeListener('load', this.navigationHandler);
    }
    
    // Create new handler
    this.navigationHandler = () => {
      logger.debug('[UI] Page navigated, re-injecting overlay...');
      // Small delay to ensure DOM is ready
      setTimeout(async () => {
        try {
          await this.injectUIElements();
        } catch (error) {
          logger.debug(`[UI] Re-injection failed: ${error}`);
        }
      }, 500);
    };
    
    // Listen for page load events
    this.page.on('load', this.navigationHandler);
    
    // Also listen for DOMContentLoaded for faster injection
    this.page.on('domcontentloaded', async () => {
      try {
        await this.injectUIElements();
      } catch (error) {
        logger.debug(`[UI] Early injection failed: ${error}`);
      }
    });
  }
  
  /**
   * Expose Node.js functions to the browser context
   * These persist across page navigations
   */
  private async exposeFunctions(): Promise<void> {
    try {
      // Toggle minimize
      await this.page.exposeFunction('__jobAgentToggleMinimize', async () => {
        try {
          await this.page.evaluate(() => {
            const overlay = document.getElementById('job-agent-overlay');
            overlay?.classList.toggle('minimized');
          });
        } catch {}
      });
      
      // Detect fields
      await this.page.exposeFunction('__jobAgentDetectFields', async () => {
        await this.detectFields();
      });
      
      // Fill form
      await this.page.exposeFunction('__jobAgentFillForm', async () => {
        await this.fillForm();
      });
      
      // Sign up
      await this.page.exposeFunction('__jobAgentSignUp', async () => {
        await this.signUp();
      });
      
      // Run agent
      await this.page.exposeFunction('__jobAgentRunAgent', async () => {
        await this.runAgent();
      });
      
      // Quick fill (no AI)
      await this.page.exposeFunction('__jobAgentQuickFill', async () => {
        await this.quickFill();
      });
      
      // Get edited answers from UI
      await this.page.exposeFunction('__jobAgentGetAnswers', async () => {
        return await this.page.evaluate(() => {
          const answers: Record<number, string> = {};
          document.querySelectorAll('.field-answer').forEach((input) => {
            const el = input as HTMLInputElement;
            const idx = parseInt(el.dataset.index || '0', 10);
            answers[idx] = el.value;
          });
          return answers;
        });
      });
    } catch (error) {
      // Functions might already be exposed if reusing page context
      logger.debug(`[UI] Function exposure: ${error}`);
    }
  }
  
  /**
   * Update status in the UI
   */
  private async setStatus(status: string, type: 'idle' | 'detecting' | 'ready' | 'filling' | 'done' | 'error'): Promise<void> {
    await this.page.evaluate(({ status, type }) => {
      const statusArea = document.getElementById('status-area');
      if (statusArea) {
        statusArea.innerHTML = `<span class="status-badge status-${type}">● ${status}</span>`;
      }
    }, { status, type });
  }
  
  /**
   * Add log entry to the UI
   */
  private async log(message: string, type: 'info' | 'success' | 'error' = 'info'): Promise<void> {
    await this.page.evaluate(({ message, type }) => {
      const logArea = document.getElementById('log-area');
      if (logArea) {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight;
      }
    }, { message, type });
  }
  
  /**
   * Detect form fields on the current page
   */
  async detectFields(): Promise<void> {
    try {
      await this.setStatus('Detecting fields...', 'detecting');
      await this.log('Scanning page for form fields...');
      
      // Disable detect button while working
      await this.page.evaluate(() => {
        const btn = document.getElementById('detect-btn') as HTMLButtonElement;
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> Detecting...';
        }
      });
      
      // Extract fields using existing extractor
      const formData = await extractFormFields();
      
      await this.log(`Found ${formData.fields.length} form fields`);
      
      // Convert to UI fields
      this.fields = formData.fields.map((field: any, idx: number) => ({
        index: idx,
        label: field.label || field.name || `Field ${idx + 1}`,
        type: field.type,
        required: field.required,
        currentValue: field.currentValue || '',
        options: field.options?.map((o: any) => o.text || o) || undefined,
        aiAnswer: '',
        selector: field.selector,
      }));
      
      // Generate AI answers
      if (this.fields.length > 0) {
        await this.log('Generating AI answers...');
        await this.generateAnswers();
      }
      
      // Update UI with fields
      await this.renderFields();
      
      await this.setStatus(`${this.fields.length} fields ready`, 'ready');
      await this.log('Detection complete!', 'success');
      
      // Enable fill button
      await this.page.evaluate(() => {
        const detectBtn = document.getElementById('detect-btn') as HTMLButtonElement;
        const fillBtn = document.getElementById('fill-btn') as HTMLButtonElement;
        if (detectBtn) {
          detectBtn.disabled = false;
          detectBtn.innerHTML = '🔍 Detect';
        }
        if (fillBtn) {
          fillBtn.disabled = false;
        }
      });
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.setStatus('Detection failed', 'error');
      await this.log(`Error: ${msg}`, 'error');
      logger.error(`[UI] Detection error: ${msg}`);
      
      // Re-enable detect button
      await this.page.evaluate(() => {
        const btn = document.getElementById('detect-btn') as HTMLButtonElement;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '🔍 Detect';
        }
      });
    }
  }
  
  /**
   * Generate AI answers for detected fields
   */
  private async generateAnswers(): Promise<void> {
    // Import AI filler dynamically to avoid circular deps
    const { generateAIAnswers } = await import('../autofill/ai-form-filler');
    
    // Format fields for LLM
    const formText = this.fields.map((f, i) => {
      let line = `${i + 1}. [${f.type}] "${f.label}"`;
      if (f.required) line += '*';
      if (f.currentValue) line += ` = "${f.currentValue}"`;
      if (f.options && f.options.length > 0) {
        line += ` (Options: ${f.options.slice(0, 10).join(', ')})`;
      }
      return line;
    }).join('\n');
    
    const aiConfig = getAIConfig(this.profile);
    if (!aiConfig) {
      await this.log('AI not configured, using profile defaults');
      // Use profile-based answers
      this.fields.forEach(field => {
        field.aiAnswer = this.getProfileAnswer(field);
      });
      return;
    }
    
    try {
      const answers = await generateAIAnswers(
        formText,
        this.profile,
        this.job,
        aiConfig
      );
      
      // Parse and apply answers
      for (const answer of answers) {
        if (answer.fieldIndex >= 1 && answer.fieldIndex <= this.fields.length) {
          this.fields[answer.fieldIndex - 1].aiAnswer = answer.value;
        }
      }
      
      await this.log(`Generated ${answers.length} AI answers`);
    } catch (error) {
      await this.log('AI generation failed, using defaults', 'error');
      this.fields.forEach(field => {
        field.aiAnswer = this.getProfileAnswer(field);
      });
    }
  }
  
  /**
   * Get answer from profile for a field
   */
  private getProfileAnswer(field: UIField): string {
    const label = field.label.toLowerCase();
    const pi = this.profile.personal;
    const edu = this.profile.education[0]; // Primary education
    
    // Name fields
    if (label.includes('first name')) return pi.first_name;
    if (label.includes('last name')) return pi.last_name;
    if (label.includes('full name')) return `${pi.first_name} ${pi.last_name}`;
    
    // Phone fields (handle separately)
    if (label.includes('phone device type') || label.includes('device type')) {
      return pi.phone_device_type || 'Mobile';
    }
    if (label.includes('country phone code') || label.includes('country code')) {
      return 'United States of America (+1)';
    }
    if (label.includes('phone extension') || label === 'extension') {
      return '';
    }
    if (label.includes('phone number') || label === 'phone') {
      // Check if there might be a separate country code field (use digits only)
      return pi.phone_digits || pi.phone?.replace(/\D/g, '').slice(-10) || '';
    }
    
    // Contact
    if (label.includes('email')) return pi.email;
    
    // Location
    if (label.includes('city')) return pi.address?.city || '';
    if (label.includes('state')) return pi.address?.state || '';
    if (label.includes('address')) return pi.address?.street || '';
    if (label.includes('zip') || label.includes('postal')) return pi.address?.zip || '';
    
    // Education
    if (edu) {
      if (label.includes('school') || label.includes('university')) return edu.school;
      if (label.includes('degree')) return edu.degree;
      if (label.includes('major') || label.includes('field')) return edu.field;
      if (label.includes('gpa')) return edu.gpa || '';
      if (label.includes('graduation')) return edu.graduation;
    }
    
    // Links
    if (label.includes('linkedin')) return this.profile.links.linkedin || '';
    if (label.includes('github')) return this.profile.links.github || '';
    if (label.includes('portfolio') || label.includes('website')) return this.profile.links.portfolio || '';
    
    return '';
  }
  
  /**
   * Render fields in the UI
   */
  private async renderFields(): Promise<void> {
    await this.page.evaluate((fields) => {
      const section = document.getElementById('fields-section');
      const list = document.getElementById('fields-list');
      const count = document.getElementById('field-count');
      
      if (!section || !list || !count) return;
      
      section.style.display = 'block';
      count.textContent = fields.length.toString();
      
      list.innerHTML = fields.map((field: any) => `
        <div class="field-item" data-index="${field.index}">
          <div class="field-label">
            <span class="field-type">${field.type}</span>
            ${field.label}
            ${field.required ? '<span class="field-required">*</span>' : ''}
          </div>
          ${field.options && field.options.length > 0 
            ? `<select class="field-answer" data-index="${field.index}">
                ${field.options.map((opt: string) => 
                  `<option value="${opt}" ${opt === field.aiAnswer ? 'selected' : ''}>${opt}</option>`
                ).join('')}
               </select>`
            : `<input type="text" class="field-answer" data-index="${field.index}" value="${field.aiAnswer || ''}" placeholder="Enter value...">`
          }
        </div>
      `).join('');
    }, this.fields);
  }
  
  /**
   * Fill the form with current answers
   */
  async fillForm(): Promise<void> {
    try {
      await this.setStatus('Filling form...', 'filling');
      await this.log('Starting form fill...');
      
      // Get current answers from UI (user may have edited them)
      const editedAnswers = await this.page.evaluate(() => {
        const answers: Record<number, string> = {};
        document.querySelectorAll('.field-answer').forEach((input) => {
          const el = input as HTMLInputElement | HTMLSelectElement;
          const idx = parseInt(el.dataset.index || '0', 10);
          answers[idx] = el.value;
        });
        return answers;
      });
      
      // Update fields with edited answers
      for (const [idx, value] of Object.entries(editedAnswers)) {
        const fieldIdx = parseInt(idx, 10);
        if (this.fields[fieldIdx]) {
          this.fields[fieldIdx].aiAnswer = value;
        }
      }
      
      // Fill each field
      let filled = 0;
      let failed = 0;
      
      for (const field of this.fields) {
        if (!field.aiAnswer) continue;
        
        try {
          await this.fillField(field);
          filled++;
          await this.log(`✓ Filled: ${field.label}`, 'success');
        } catch (error) {
          failed++;
          await this.log(`✗ Failed: ${field.label}`, 'error');
        }
      }
      
      await this.setStatus(`Done: ${filled} filled, ${failed} failed`, 'done');
      await this.log(`Form fill complete: ${filled}/${this.fields.length}`, 'success');
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.setStatus('Fill failed', 'error');
      await this.log(`Error: ${msg}`, 'error');
    }
  }
  
  /**
   * Fill a single field
   */
  private async fillField(field: UIField): Promise<void> {
    const { fillTextInput, fillSelectDropdown, fillCustomDropdown } = await import('../autofill/ai-form-filler');
    
    if (!field.aiAnswer) return;
    
    if (field.type === 'select') {
      await fillSelectDropdown(this.page, field.selector, field.aiAnswer);
    } else if (field.type === 'custom-dropdown') {
      await fillCustomDropdown(this.page, field.selector, field.aiAnswer);
    } else {
      await fillTextInput(this.page, field.selector, field.aiAnswer);
    }
  }
  
  /**
   * Auto-fill sign up / login form
   */
  async signUp(): Promise<void> {
    try {
      await this.setStatus('Filling sign-up form...', 'filling');
      await this.log('Auto-filling registration details...');
      
      const pi = this.profile.personal;
      const password = 'Baloney@1';
      
      // Common sign-up field selectors
      const signUpFields = [
        // Email
        { selectors: ['input[name*="email" i]', 'input[type="email"]', 'input[placeholder*="email" i]'], value: pi.email },
        // First name
        { selectors: ['input[name*="first" i]', 'input[placeholder*="first name" i]'], value: pi.first_name },
        // Last name
        { selectors: ['input[name*="last" i]', 'input[placeholder*="last name" i]'], value: pi.last_name },
        // Full name
        { selectors: ['input[name*="name" i]:not([name*="first"]):not([name*="last"])', 'input[placeholder*="full name" i]'], value: `${pi.first_name} ${pi.last_name}` },
        // Password
        { selectors: ['input[name*="password" i]', 'input[type="password"]'], value: password },
        // Confirm password
        { selectors: ['input[name*="confirm" i]', 'input[name*="retype" i]', 'input[name*="repeat" i]'], value: password },
        // Phone
        { selectors: ['input[name*="phone" i]', 'input[type="tel"]'], value: pi.phone || '' },
      ];
      
      let filled = 0;
      
      for (const field of signUpFields) {
        if (!field.value) continue;
        
        for (const selector of field.selectors) {
          try {
            const element = await this.page.$(selector);
            if (element && await element.isVisible()) {
              await element.fill(field.value);
              filled++;
              await this.log(`✓ Filled: ${selector.split('[')[1]?.split(']')[0] || selector}`, 'success');
              break;
            }
          } catch {
            continue;
          }
        }
      }
      
      await this.setStatus(`Sign-up: ${filled} fields filled`, 'done');
      await this.log(`Sign-up complete: ${filled} fields filled`, 'success');
      await this.log(`Password used: ${password}`, 'info');
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.setStatus('Sign-up failed', 'error');
      await this.log(`Error: ${msg}`, 'error');
    }
  }
  
  /**
   * Run the AI agent to automatically fill the current form section
   * This handles dynamic forms with Add buttons, multi-step navigation, etc.
   */
  async runAgent(): Promise<void> {
    // Prevent multiple simultaneous runs
    if (this.agentRunning) {
      await this.log('Agent is already running, please wait...', 'info');
      return;
    }
    
    this.agentRunning = true;
    
    try {
      await this.setStatus('Agent running...', 'filling');
      await this.log('🤖 Starting agentic form filling...');
      await this.log('Agent will click buttons, fill fields, and navigate automatically');
      
      // Disable the button while running
      await this.page.evaluate(() => {
        const btn = document.getElementById('agent-btn') as HTMLButtonElement;
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> Running...';
        }
      });
      
      // Get AI config
      const aiConfig = getAIConfig(this.profile);
      if (!aiConfig) {
        await this.setStatus('Agent error', 'error');
        await this.log('AI not configured - set HUGGINGFACE_API_KEY or OPENAI_API_KEY', 'error');
        this.agentRunning = false;
        return;
      }
      
      // Run the agent
      const result = await runFormAgent(
        this.page,
        this.profile,
        this.job,
        aiConfig.apiKey,
        aiConfig.model,
        aiConfig.provider as 'openai' | 'huggingface',
        30 // max steps
      );
      
      if (result.success) {
        await this.setStatus('Section complete', 'done');
        await this.log(`✓ Agent completed: ${result.steps} actions`, 'success');
        await this.log(`Reason: ${result.reason}`, 'info');
        await this.log('Click Next/Continue or run agent again for next section', 'info');
      } else {
        await this.setStatus('Agent needs help', 'error');
        await this.log(`Agent stopped after ${result.steps} actions`, 'error');
        await this.log(`Reason: ${result.reason}`, 'error');
        await this.log('Try detecting fields and filling manually', 'info');
      }
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.setStatus('Agent error', 'error');
      await this.log(`Agent error: ${msg}`, 'error');
    } finally {
      this.agentRunning = false;
      
      // Re-enable the button
      await this.page.evaluate(() => {
        const btn = document.getElementById('agent-btn') as HTMLButtonElement;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '🤖 Auto-Fill Section (Agent)';
        }
      });
    }
  }
  
  /**
   * Quick fill using profile data only (no AI)
   * This is a fallback when AI is failing
   */
  async quickFill(): Promise<void> {
    try {
      await this.setStatus('Quick filling...', 'filling');
      await this.log('⚡ Starting quick fill (no AI)...');
      
      const pi = this.profile.personal;
      const edu = this.profile.education[0];
      const exp = this.profile.work_experience?.[0];
      
      // Common field mappings
      const fieldMappings: Record<string, string> = {
        // Personal info
        'first name': pi.first_name,
        'last name': pi.last_name,
        'full name': `${pi.first_name} ${pi.last_name}`,
        'email': pi.email,
        'phone number': pi.phone_digits || pi.phone.replace(/\D/g, '').slice(-10),
        'phone': pi.phone_digits || pi.phone.replace(/\D/g, '').slice(-10),
        'city': pi.address?.city || '',
        'state': pi.address?.state || '',
        'zip': pi.address?.zip || '',
        'location': pi.location,
        'linkedin': this.profile.links.linkedin || '',
        'github': this.profile.links.github || '',
        
        // Education
        'school': edu?.school || '',
        'university': edu?.school || '',
        'college': edu?.school || '',
        'degree': edu?.degree || '',
        'major': edu?.field || '',
        'field of study': edu?.field || '',
        'gpa': edu?.gpa || '',
        'graduation': edu?.graduation || '',
        
        // Work experience
        'company': exp?.company || '',
        'job title': exp?.title || '',
        'title': exp?.title || '',
        'start date': exp?.start_date || '',
        'end date': exp?.end_date || '',
      };
      
      let filled = 0;
      let failed = 0;
      
      // Find and fill visible input fields
      const inputs = await this.page.$$('input:visible, textarea:visible');
      
      for (const input of inputs) {
        try {
          // Get field label or placeholder
          const info = await input.evaluate((el) => {
            const inp = el as HTMLInputElement;
            let label = '';
            
            // Try to find associated label
            if (inp.id) {
              const labelEl = document.querySelector(`label[for="${inp.id}"]`);
              label = labelEl?.textContent?.trim() || '';
            }
            
            // Try placeholder
            if (!label) {
              label = inp.placeholder || '';
            }
            
            // Try aria-label
            if (!label) {
              label = inp.getAttribute('aria-label') || '';
            }
            
            // Try name
            if (!label) {
              label = inp.name || '';
            }
            
            return {
              label: label.toLowerCase(),
              value: inp.value,
              type: inp.type,
            };
          });
          
          // Skip if already filled
          if (info.value) continue;
          
          // Find matching value
          let matchedValue = '';
          for (const [pattern, value] of Object.entries(fieldMappings)) {
            if (info.label.includes(pattern) && value) {
              matchedValue = value;
              break;
            }
          }
          
          if (matchedValue) {
            await input.fill(matchedValue);
            filled++;
            await this.log(`✓ ${info.label}: ${matchedValue.substring(0, 30)}...`, 'success');
          }
        } catch {
          failed++;
        }
      }
      
      // Handle select dropdowns
      const selects = await this.page.$$('select:visible');
      for (const select of selects) {
        try {
          const info = await select.evaluate((el) => {
            const sel = el as HTMLSelectElement;
            let label = '';
            if (sel.id) {
              const labelEl = document.querySelector(`label[for="${sel.id}"]`);
              label = labelEl?.textContent?.trim() || '';
            }
            return {
              label: label.toLowerCase(),
              value: sel.value,
              options: Array.from(sel.options).map(o => o.text),
            };
          });
          
          // Skip if already selected (not default)
          if (info.value && info.value !== '' && info.value !== '0') continue;
          
          // Try to select appropriate option based on profile
          if (info.label.includes('phone') && info.label.includes('type')) {
            await select.selectOption({ label: 'Mobile' });
            filled++;
            await this.log(`✓ ${info.label}: Mobile`, 'success');
          } else if (info.label.includes('country')) {
            // Try to find US option
            const usOption = info.options.find(o => 
              o.toLowerCase().includes('united states') || o.includes('+1')
            );
            if (usOption) {
              await select.selectOption({ label: usOption });
              filled++;
              await this.log(`✓ ${info.label}: ${usOption}`, 'success');
            }
          } else if (info.label.includes('degree')) {
            const degreeOption = info.options.find(o => 
              o.toLowerCase().includes('master') || o.toLowerCase().includes("master's")
            );
            if (degreeOption) {
              await select.selectOption({ label: degreeOption });
              filled++;
              await this.log(`✓ ${info.label}: ${degreeOption}`, 'success');
            }
          }
        } catch {
          failed++;
        }
      }
      
      await this.setStatus(`Quick fill done: ${filled} fields`, 'done');
      await this.log(`Quick fill complete: ${filled} filled, ${failed} failed`, 'success');
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.setStatus('Quick fill error', 'error');
      await this.log(`Error: ${msg}`, 'error');
    }
  }
  
  /**
   * Remove the overlay from the page and clean up listeners
   */
  async remove(): Promise<void> {
    // Remove navigation listeners
    if (this.navigationHandler) {
      this.page.removeListener('load', this.navigationHandler);
      this.page.removeListener('domcontentloaded', this.navigationHandler);
      this.navigationHandler = null;
    }
    
    // Remove overlay from DOM
    try {
      await this.page.evaluate(() => {
        const overlay = document.getElementById('job-agent-overlay');
        overlay?.remove();
      });
    } catch {
      // Page might have already navigated away
    }
  }
}

/**
 * Create and inject overlay UI
 */
export async function createOverlayUI(
  page: Page,
  profile: CandidateProfile,
  job: Job & { ats: ATSType }
): Promise<OverlayUI> {
  const ui = new OverlayUI(page, profile, job);
  await ui.inject();
  return ui;
}

export default {
  OverlayUI,
  createOverlayUI,
};

