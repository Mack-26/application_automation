/**
 * Logging and metrics module
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import type { ApplicationResult, ApplicationStatus, ATSType } from '../types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

class Logger {
  private logLevel: LogLevel;
  private outputDir: string;
  private results: ApplicationResult[] = [];
  private logFile: string | null = null;
  
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };
  
  constructor(level: LogLevel = 'info', outputDir: string = './logs') {
    this.logLevel = level;
    this.outputDir = outputDir;
    this.initializeLogFile();
  }
  
  private initializeLogFile(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(this.outputDir, `application-log-${timestamp}.json`);
  }
  
  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.logLevel];
  }
  
  private formatTimestamp(): string {
    return new Date().toISOString();
  }
  
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toLocaleTimeString();
    
    switch (level) {
      case 'debug':
        return chalk.gray(`[${timestamp}] DEBUG: ${message}`);
      case 'info':
        return chalk.blue(`[${timestamp}] INFO: ${message}`);
      case 'warn':
        return chalk.yellow(`[${timestamp}] WARN: ${message}`);
      case 'error':
        return chalk.red(`[${timestamp}] ERROR: ${message}`);
    }
  }
  
  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    
    console.log(this.formatMessage(level, message));
    
    if (data) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }
  
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }
  
  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }
  
  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }
  
  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }
  
  /**
   * Log a checkpoint requiring human input
   */
  checkpoint(type: string, message: string): void {
    console.log('\n' + chalk.bgYellow.black(' CHECKPOINT ') + ' ' + chalk.yellow(type.toUpperCase()));
    console.log(chalk.yellow(`→ ${message}`));
    console.log(chalk.gray('Complete the required action and press Enter to continue...\n'));
  }
  
  /**
   * Log application start
   */
  applicationStart(company: string, role: string): void {
    console.log('\n' + chalk.bgBlue.white(' APPLYING '));
    console.log(chalk.blue(`Company: ${company}`));
    console.log(chalk.blue(`Role: ${role}`));
    console.log(chalk.gray('─'.repeat(50)));
  }
  
  /**
   * Log application result
   */
  applicationResult(result: ApplicationResult): void {
    this.results.push(result);
    
    const statusColors: Record<ApplicationStatus, (str: string) => string> = {
      pending: chalk.gray,
      in_progress: chalk.yellow,
      submitted: chalk.green,
      failed: chalk.red,
      partial: chalk.yellow,
      skipped: chalk.gray,
    };
    
    const colorFn = statusColors[result.status];
    
    console.log('\n' + chalk.gray('─'.repeat(50)));
    console.log(colorFn(`Status: ${result.status.toUpperCase()}`));
    
    if (result.issue) {
      console.log(chalk.red(`Issue: ${result.issue}`));
    }
    
    if (result.duration_ms) {
      console.log(chalk.gray(`Duration: ${(result.duration_ms / 1000).toFixed(1)}s`));
    }
    
    // Save to file
    this.saveResults();
  }
  
  /**
   * Save results to log file
   */
  private saveResults(): void {
    if (!this.logFile) return;
    
    const output = {
      generated_at: this.formatTimestamp(),
      total_applications: this.results.length,
      summary: this.getSummary(),
      results: this.results,
    };
    
    fs.writeFileSync(this.logFile, JSON.stringify(output, null, 2));
  }
  
  /**
   * Get summary statistics
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {
      total: this.results.length,
      submitted: 0,
      failed: 0,
      partial: 0,
      skipped: 0,
    };
    
    for (const result of this.results) {
      if (result.status in summary) {
        summary[result.status]++;
      }
    }
    
    return summary;
  }
  
  /**
   * Print final summary
   */
  printSummary(): void {
    const summary = this.getSummary();
    
    console.log('\n' + chalk.bgWhite.black(' SUMMARY '));
    console.log(chalk.gray('═'.repeat(50)));
    console.log(`Total Applications: ${summary.total}`);
    console.log(chalk.green(`✓ Submitted: ${summary.submitted}`));
    console.log(chalk.red(`✗ Failed: ${summary.failed}`));
    console.log(chalk.yellow(`◐ Partial: ${summary.partial}`));
    console.log(chalk.gray(`○ Skipped: ${summary.skipped}`));
    console.log(chalk.gray('═'.repeat(50)));
    
    if (this.logFile) {
      console.log(chalk.gray(`\nDetailed log saved to: ${this.logFile}`));
    }
  }
  
  /**
   * Get all results
   */
  getResults(): ApplicationResult[] {
    return [...this.results];
  }
  
  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

export function getLogger(level?: LogLevel, outputDir?: string): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(level, outputDir);
  }
  return loggerInstance;
}

export function createApplicationResult(
  company: string,
  role: string,
  ats: ATSType,
  status: ApplicationStatus,
  issue?: string,
  duration_ms?: number
): ApplicationResult {
  return {
    company,
    role,
    ats,
    status,
    issue,
    timestamp: new Date().toISOString(),
    duration_ms,
  };
}

export default {
  getLogger,
  createApplicationResult,
};

