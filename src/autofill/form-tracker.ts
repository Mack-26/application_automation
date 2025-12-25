/**
 * Form field tracking to prevent duplicate fills and provide detailed logging
 */

import { getLogger } from '../log/logger';

const logger = getLogger();

interface FieldFillRecord {
  selector: string;
  label: string;
  value: string;
  timestamp: Date;
  success: boolean;
  module: string;
}

class FormTracker {
  private filledFields: Map<string, FieldFillRecord> = new Map();
  private failedFields: Map<string, { label: string; reason: string }> = new Map();
  private attemptedSelectors: Set<string> = new Set();
  
  /**
   * Check if a field has already been filled
   */
  isFieldFilled(selector: string): boolean {
    return this.filledFields.has(selector) || this.attemptedSelectors.has(selector);
  }
  
  /**
   * Mark a field as attempted (to prevent duplicate attempts)
   */
  markAttempted(selector: string): void {
    this.attemptedSelectors.add(selector);
  }
  
  /**
   * Record a successful field fill
   */
  recordFill(selector: string, label: string, value: string, module: string): void {
    // Skip if already filled
    if (this.filledFields.has(selector)) {
      logger.debug(`[${module}] Skipping already filled: ${label || selector}`);
      return;
    }
    
    this.filledFields.set(selector, {
      selector,
      label: label || selector,
      value: this.truncateValue(value),
      timestamp: new Date(),
      success: true,
      module,
    });
    
    logger.info(`[${module}] ✓ Filled "${label || selector}": ${this.truncateValue(value)}`);
  }
  
  /**
   * Record a failed field fill attempt
   */
  recordFailure(selector: string, label: string, reason: string, module: string): void {
    this.failedFields.set(selector, { label: label || selector, reason });
    logger.debug(`[${module}] ✗ Failed "${label || selector}": ${reason}`);
  }
  
  /**
   * Truncate long values for logging
   */
  private truncateValue(value: string): string {
    if (value.length > 50) {
      return value.substring(0, 47) + '...';
    }
    return value;
  }
  
  /**
   * Get summary of filled fields
   */
  getFilledCount(): number {
    return this.filledFields.size;
  }
  
  /**
   * Get list of failed fields with details
   */
  getFailedFields(): { selector: string; label: string; reason: string }[] {
    return Array.from(this.failedFields.entries()).map(([selector, info]) => ({
      selector,
      label: info.label,
      reason: info.reason,
    }));
  }
  
  /**
   * Get list of filled fields
   */
  getFilledFields(): FieldFillRecord[] {
    return Array.from(this.filledFields.values());
  }
  
  /**
   * Print detailed summary
   */
  printSummary(): void {
    console.log('\n--- Form Fill Summary ---');
    console.log(`Total fields filled: ${this.filledFields.size}`);
    
    if (this.filledFields.size > 0) {
      console.log('\nFilled fields:');
      for (const [selector, record] of this.filledFields) {
        console.log(`  ✓ ${record.label}: ${record.value} [${record.module}]`);
      }
    }
    
    if (this.failedFields.size > 0) {
      console.log(`\nFailed fields (${this.failedFields.size}):`);
      for (const [selector, info] of this.failedFields) {
        console.log(`  ✗ ${info.label}: ${info.reason}`);
      }
    }
    
    console.log('------------------------\n');
  }
  
  /**
   * Reset tracker for new form
   */
  reset(): void {
    this.filledFields.clear();
    this.failedFields.clear();
    this.attemptedSelectors.clear();
  }
}

// Singleton instance
let trackerInstance: FormTracker | null = null;

export function getFormTracker(): FormTracker {
  if (!trackerInstance) {
    trackerInstance = new FormTracker();
  }
  return trackerInstance;
}

export function resetFormTracker(): void {
  if (trackerInstance) {
    trackerInstance.reset();
  }
}

export default {
  getFormTracker,
  resetFormTracker,
};

