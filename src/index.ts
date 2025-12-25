/**
 * Job Application Agent - Main Entry Point
 * 
 * A compliant, human-in-the-loop system that automates job applications
 * using a structured candidate profile and GitHub repository job postings.
 */

// Load environment variables from .env file
import 'dotenv/config';

import { Command } from 'commander';
import chalk from 'chalk';

import { loadCandidateProfile, loadSettings, getResumePath, validateCandidateProfile } from './config';
import { ingestJobs } from './ingest/github-parser';
import { normalizeJob, detectATS } from './normalize/ats-detector';
import { initializeBrowser, closeBrowser, getBrowserManager } from './browser/browser-manager';
import { uploadResume, autofillForm, checkRequiredFields } from './autofill/form-filler';
import { handleAdditionalQuestions } from './autofill/question-handler';
import { fillFormWithAI, getAIConfig } from './autofill/ai-form-filler';
import { resetFormTracker, getFormTracker } from './autofill/form-tracker';
import { navigateToApplicationForm, getPageStateSummary, isApplicationFormPage } from './autofill/application-navigator';
import { hasApplied, recordApplication, printHistorySummary, getApplicationStatus } from './log/application-history';
import { checkAndHandleCheckpoint, confirmSubmission, handleFailure, handleCheckpoint } from './checkpoints/checkpoint-handler';
import { submitWithRetry, detectSubmissionSuccess } from './submit/submission-handler';
import { getLogger, createApplicationResult } from './log/logger';
import { createOverlayUI } from './ui/overlay-ui';

import type { Job, ATSType, ApplicationResult } from './types';

const program = new Command();

/**
 * Process a single job application
 */
async function processApplication(
  job: Job & { ats: ATSType },
  resumePath: string | null,
  autoSubmit: boolean,
  interactive: boolean = false
): Promise<ApplicationResult> {
  const logger = getLogger();
  const startTime = Date.now();
  const profile = loadCandidateProfile();
  
  logger.applicationStart(job.company, job.role);
  logger.info(`ATS: ${job.ats}`);
  logger.info(`URL: ${job.apply_url}`);
  
  // Check if already applied
  const previousApplication = getApplicationStatus(job.apply_url);
  if (previousApplication) {
    logger.warn(`Already applied to this job on ${previousApplication.applied_at} (${previousApplication.status})`);
    const duration = Date.now() - startTime;
    const appResult = createApplicationResult(
      job.company,
      job.role,
      job.ats,
      'skipped',
      'Already applied previously',
      duration
    );
    logger.applicationResult(appResult);
    return appResult;
  }
  
  try {
    const browser = getBrowserManager();
    
    // Navigate to application page
    await browser.navigateTo(job.apply_url);
    
    // Wait for page to load
    await browser.getPage().waitForTimeout(2000);
    
    // Check page state and navigate to application form if needed
    logger.info(`[Navigator] ${await getPageStateSummary()}`);
    
    const navResult = await navigateToApplicationForm();
    
    if (navResult.needsAccountCreation) {
      // Pause for user to create account
      logger.warn('\n╔══════════════════════════════════════════════════════════════╗');
      logger.warn('║  ACCOUNT CREATION REQUIRED                                     ║');
      logger.warn('║  Please create an account in the browser window.               ║');
      logger.warn('║  After creating your account and reaching the application      ║');
      logger.warn('║  form, press Enter to continue...                              ║');
      logger.warn('╚══════════════════════════════════════════════════════════════╝\n');
      
      await handleCheckpoint('manual_input');
      
      // Re-check page state after user action
      await browser.getPage().waitForTimeout(1000);
      logger.info(`[Navigator] After account creation: ${await getPageStateSummary()}`);
    }
    
    if (navResult.needsLogin) {
      // Pause for user to login
      logger.warn('\n╔══════════════════════════════════════════════════════════════╗');
      logger.warn('║  LOGIN REQUIRED                                                ║');
      logger.warn('║  Please sign in to the application system in the browser.      ║');
      logger.warn('║  After logging in and reaching the application form,           ║');
      logger.warn('║  press Enter to continue...                                    ║');
      logger.warn('╚══════════════════════════════════════════════════════════════╝\n');
      
      await handleCheckpoint('login');
      
      // Re-check page state after user action
      await browser.getPage().waitForTimeout(1000);
      logger.info(`[Navigator] After login: ${await getPageStateSummary()}`);
    }
    
    // Verify we're on an application form before proceeding
    const onApplicationForm = await isApplicationFormPage();
    if (!onApplicationForm) {
      logger.warn('[Navigator] Not on an application form page. Please navigate to the application form manually.');
      logger.warn('[Navigator] Press Enter when you are on the application form...');
      await handleCheckpoint('manual_input');
    }
    
    // Reset form tracker for this application
    resetFormTracker();
    
    // Upload resume if available
    let resumeUploaded = false;
    if (resumePath) {
      resumeUploaded = await uploadResume(resumePath, job.ats);
      if (!resumeUploaded) {
        logger.warn('Resume upload field not found - may require manual upload');
      }
    }
    
    if (interactive) {
      // INTERACTIVE MODE: Use overlay UI for manual control
      logger.info('Interactive mode enabled - injecting overlay UI...');
      
      const browser = getBrowserManager();
      const overlayUI = await createOverlayUI(browser.getPage(), profile, job);
      
      console.log('\n' + chalk.bgMagenta.white(' INTERACTIVE MODE '));
      console.log(chalk.magenta('╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.magenta('║  Overlay UI injected! Use the panel on the right side:    ║'));
      console.log(chalk.magenta('║                                                            ║'));
      console.log(chalk.magenta('║  🔍 DETECT  - Scan page for form fields                   ║'));
      console.log(chalk.magenta('║  ✨ FILL    - Fill form with AI-generated answers         ║'));
      console.log(chalk.magenta('║  📝 SIGN UP - Auto-fill registration/login forms          ║'));
      console.log(chalk.magenta('║                                                            ║'));
      console.log(chalk.magenta('║  For multi-page forms (like Workday):                      ║'));
      console.log(chalk.magenta('║  1. Click Detect to find fields on current page           ║'));
      console.log(chalk.magenta('║  2. Review & edit AI answers in the panel                 ║'));
      console.log(chalk.magenta('║  3. Click Fill to populate the form                       ║'));
      console.log(chalk.magenta('║  4. Click Next/Continue in the form                       ║'));
      console.log(chalk.magenta('║  5. Repeat for each page                                  ║'));
      console.log(chalk.magenta('║                                                            ║'));
      console.log(chalk.magenta('║  Press Enter here when done with all pages...             ║'));
      console.log(chalk.magenta('╚════════════════════════════════════════════════════════════╝\n'));
      
      // Wait for user to signal completion
      await handleCheckpoint('manual_input');
      
      // Clean up overlay
      await overlayUI.remove();
      logger.info('Interactive mode completed');
      
    } else {
      // AUTO MODE: Check if AI filling is enabled
      const aiConfig = getAIConfig(profile);
      
      if (aiConfig) {
        // Use AI-powered form filling
        logger.info('Using AI-powered form filling...');
        const { filled, failed, form } = await fillFormWithAI(profile, job, aiConfig);
        logger.info(`AI filled ${filled} fields (${failed} failed)`);
        
        // Print summary
        const tracker = getFormTracker();
        tracker.printSummary();
      } else {
        // No AI config - error out
        throw new Error('AI form filling is required but not configured. Set HUGGINGFACE_API_KEY or OPENAI_API_KEY environment variable.');
      }
    }
    
    // Check for checkpoints again (CAPTCHA might appear after filling)
    await checkAndHandleCheckpoint();
    
    // Check for missing required fields
    const missingFields = await checkRequiredFields();
    if (missingFields.length > 0) {
      console.log('\n' + chalk.yellow('=== MANUAL INPUT REQUIRED ==='));
      console.log(chalk.yellow('The following fields need to be filled manually:'));
      missingFields.forEach((field, i) => {
        console.log(chalk.yellow(`  ${i + 1}. ${field}`));
      });
      console.log(chalk.yellow('Please fill these in the browser, then press Enter.'));
      console.log(chalk.yellow('==============================\n'));
      await handleCheckpoint('manual_input');
    }
    
    // Confirm and submit
    if (autoSubmit) {
      const shouldSubmit = await confirmSubmission(job.company, job.role);
      
      if (shouldSubmit) {
        const result = await submitWithRetry(2);
        
        if (result.success) {
          const duration = Date.now() - startTime;
          
          // Record successful application
          recordApplication(job.company, job.role, job.apply_url, 'submitted');
          
          const appResult = createApplicationResult(
            job.company,
            job.role,
            job.ats,
            'submitted',
            undefined,
            duration
          );
          logger.applicationResult(appResult);
          return appResult;
        } else {
          // Handle failure
          const action = await handleFailure(job.company, job.role, result.error || 'Unknown error');
          
          if (action === 'manual') {
            await handleCheckpoint('manual_input');
            
            // Check if manually submitted
            if (await detectSubmissionSuccess()) {
              const duration = Date.now() - startTime;
              
              // Record successful manual submission
              recordApplication(job.company, job.role, job.apply_url, 'submitted', 'Manual completion');
              
              const appResult = createApplicationResult(
                job.company,
                job.role,
                job.ats,
                'submitted',
                'Completed manually',
                duration
              );
              logger.applicationResult(appResult);
              return appResult;
            }
          }
          
          const duration = Date.now() - startTime;
          const status = action === 'skip' ? 'skipped' : 'failed';
          
          // Record failed/skipped application
          if (status === 'failed') {
            recordApplication(job.company, job.role, job.apply_url, 'failed', result.error);
          }
          
          const appResult = createApplicationResult(
            job.company,
            job.role,
            job.ats,
            status,
            result.error,
            duration
          );
          logger.applicationResult(appResult);
          return appResult;
        }
      } else {
        const duration = Date.now() - startTime;
        const appResult = createApplicationResult(
          job.company,
          job.role,
          job.ats,
          'skipped',
          'User declined to submit',
          duration
        );
        logger.applicationResult(appResult);
        return appResult;
      }
    } else {
      // Manual mode - just fill and wait
      logger.info('Form filled. Manual submission required.');
      await handleCheckpoint('manual_input');
      
      const duration = Date.now() - startTime;
      const appResult = createApplicationResult(
        job.company,
        job.role,
        job.ats,
        'partial',
        'Manual submission mode',
        duration
      );
      logger.applicationResult(appResult);
      return appResult;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    const appResult = createApplicationResult(
      job.company,
      job.role,
      job.ats,
      'failed',
      errorMessage,
      duration
    );
    logger.applicationResult(appResult);
    return appResult;
  }
}

/**
 * Main application flow
 */
async function main(options: {
  config?: string;
  limit?: number;
  skip?: number;
  company?: string;
  dryRun?: boolean;
  noSubmit?: boolean;
  interactive?: boolean;
  select?: boolean;
}): Promise<void> {
  const logger = getLogger();
  
  console.log('\n' + chalk.bgCyan.black(' JOB APPLICATION AGENT ') + '\n');
  
  try {
    // Load configuration
    const settings = loadSettings();
    const profile = loadCandidateProfile();
    
    // Validate profile
    const profileErrors = validateCandidateProfile(profile);
    if (profileErrors.length > 0) {
      logger.error('Invalid candidate profile:');
      profileErrors.forEach(e => logger.error(`  - ${e}`));
      console.log(chalk.yellow('\nPlease update config/candidate-profile.json with your information.'));
      process.exit(1);
    }
    
    // Get resume path
    const resumePath = getResumePath(profile);
    if (!resumePath) {
      logger.warn('No resume file found. Applications will require manual resume upload.');
    } else {
      logger.info(`Resume: ${resumePath}`);
    }
    
    // Fetch jobs from GitHub
    logger.info('Fetching jobs from GitHub...');
    const jobs = await ingestJobs(
      settings.jobSource.repository,
      settings.jobSource.branch,
      settings.jobSource.readmePath
    );
    
    logger.info(`Found ${jobs.length} jobs`);
    
    // Filter jobs if company specified
    let filteredJobs = jobs;
    if (options.company) {
      filteredJobs = jobs.filter(j => 
        j.company.toLowerCase().includes(options.company!.toLowerCase())
      );
      logger.info(`Filtered to ${filteredJobs.length} jobs matching "${options.company}"`);
    }
    
    // Apply skip
    if (options.skip && options.skip > 0) {
      filteredJobs = filteredJobs.slice(options.skip);
      logger.info(`Skipped first ${options.skip} jobs, ${filteredJobs.length} remaining`);
    }
    
    // Apply limit
    if (options.limit) {
      filteredJobs = filteredJobs.slice(0, options.limit);
      logger.info(`Limited to ${filteredJobs.length} jobs`);
    }
    
    if (filteredJobs.length === 0) {
      logger.warn('No jobs to process');
      return;
    }
    
    // Dry run mode - just list jobs
    if (options.dryRun) {
      console.log('\n' + chalk.yellow('DRY RUN - Jobs that would be processed:') + '\n');
      
      for (let i = 0; i < filteredJobs.length; i++) {
        const job = filteredJobs[i];
        const ats = detectATS(job.apply_url);
        const previousApp = getApplicationStatus(job.apply_url);
        const status = previousApp ? chalk.yellow(` [Already applied: ${previousApp.status}]`) : '';
        
        console.log(chalk.white(`${i + 1}. `) + chalk.blue(`${job.company}`) + status);
        console.log(chalk.gray(`   Role: ${job.role}`));
        console.log(chalk.gray(`   Location: ${job.location}`));
        console.log(chalk.gray(`   ATS: ${ats}`));
        console.log();
      }
      
      return;
    }
    
    // Interactive job selection mode
    if (options.select) {
      console.log('\n' + chalk.bgMagenta.white(' SELECT JOBS TO APPLY ') + '\n');
      console.log(chalk.gray('Enter job numbers separated by commas (e.g., 1,3,5) or ranges (e.g., 1-5)'));
      console.log(chalk.gray('Enter "all" to apply to all, or "q" to quit\n'));
      
      // Display jobs
      for (let i = 0; i < filteredJobs.length; i++) {
        const job = filteredJobs[i];
        const ats = detectATS(job.apply_url);
        const previousApp = getApplicationStatus(job.apply_url);
        const status = previousApp ? chalk.yellow(` [Applied: ${previousApp.status}]`) : chalk.green(' [New]');
        
        console.log(chalk.white(`${String(i + 1).padStart(3)}. `) + chalk.blue(`${job.company}`) + status);
        console.log(chalk.gray(`      ${job.role} | ${job.location} | ${ats}`));
      }
      
      console.log();
      
      // Get user selection
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const selection = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan('Select jobs: '), (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
      
      if (selection.toLowerCase() === 'q') {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
      
      let selectedIndices: number[] = [];
      
      if (selection.toLowerCase() === 'all') {
        selectedIndices = filteredJobs.map((_, i) => i);
      } else {
        // Parse selection (e.g., "1,3,5-8,10")
        const parts = selection.split(',').map(s => s.trim());
        for (const part of parts) {
          if (part.includes('-')) {
            const [start, end] = part.split('-').map(n => parseInt(n, 10));
            for (let i = start; i <= end; i++) {
              if (i >= 1 && i <= filteredJobs.length) {
                selectedIndices.push(i - 1);
              }
            }
          } else {
            const idx = parseInt(part, 10);
            if (idx >= 1 && idx <= filteredJobs.length) {
              selectedIndices.push(idx - 1);
            }
          }
        }
      }
      
      // Remove duplicates and sort
      selectedIndices = [...new Set(selectedIndices)].sort((a, b) => a - b);
      
      if (selectedIndices.length === 0) {
        console.log(chalk.yellow('No valid jobs selected.'));
        return;
      }
      
      // Filter to selected jobs
      filteredJobs = selectedIndices.map(i => filteredJobs[i]);
      console.log(chalk.green(`\nSelected ${filteredJobs.length} jobs to apply to.\n`));
    }
    
    // Initialize browser
    await initializeBrowser(settings.browser);
    
    // Process each job
    const results: ApplicationResult[] = [];
    
    for (let i = 0; i < filteredJobs.length; i++) {
      const job = filteredJobs[i];
      const normalizedJob = normalizeJob(job);
      
      console.log(chalk.gray(`\n[${i + 1}/${filteredJobs.length}]`));
      
      const result = await processApplication(
        normalizedJob,
        resumePath,
        !options.noSubmit && settings.application.autoSubmit,
        options.interactive || false
      );
      
      results.push(result);
      
      // Brief pause between applications
      if (i < filteredJobs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Print summaries
    logger.printSummary();
    printHistorySummary();
    
  } catch (error) {
    logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

/**
 * Single application mode
 */
async function applySingle(url: string, options: { noSubmit?: boolean; interactive?: boolean }): Promise<void> {
  const logger = getLogger();
  
  console.log('\n' + chalk.bgCyan.black(' JOB APPLICATION AGENT ') + '\n');
  
  try {
    const settings = loadSettings();
    const profile = loadCandidateProfile();
    
    // Validate profile
    const profileErrors = validateCandidateProfile(profile);
    if (profileErrors.length > 0) {
      logger.error('Invalid candidate profile:');
      profileErrors.forEach(e => logger.error(`  - ${e}`));
      process.exit(1);
    }
    
    const resumePath = getResumePath(profile);
    const ats = detectATS(url);
    
    const job: Job & { ats: ATSType } = {
      company: 'Manual Application',
      role: 'Position',
      location: 'Unknown',
      apply_url: url,
      source: 'github',
      ats,
    };
    
    await initializeBrowser(settings.browser);
    
    await processApplication(
      job,
      resumePath,
      !options.noSubmit && settings.application.autoSubmit,
      options.interactive || false
    );
    
    logger.printSummary();
    
  } catch (error) {
    logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

// CLI setup
program
  .name('job-agent')
  .description('Automated job application agent with human-in-the-loop checkpoints')
  .version('1.0.0');

program
  .command('run')
  .description('Run the job application agent')
  .option('-l, --limit <number>', 'Maximum number of applications to process', parseInt)
  .option('-s, --skip <number>', 'Skip the first N jobs', parseInt)
  .option('-c, --company <name>', 'Filter jobs by company name')
  .option('-i, --interactive', 'Enable interactive mode with overlay UI')
  .option('--select', 'Interactively select which jobs to apply to')
  .option('--dry-run', 'List jobs without applying')
  .option('--no-submit', 'Fill forms but do not submit')
  .action(main);

program
  .command('apply <url>')
  .description('Apply to a single job by URL')
  .option('-i, --interactive', 'Enable interactive mode with overlay UI')
  .option('--no-submit', 'Fill form but do not submit')
  .action(applySingle);

program
  .command('test')
  .description('Test configuration and browser setup')
  .action(async () => {
    const logger = getLogger();
    
    console.log('\n' + chalk.bgYellow.black(' CONFIGURATION TEST ') + '\n');
    
    try {
      // Test config loading
      const settings = loadSettings();
      logger.info('✓ Settings loaded');
      
      const profile = loadCandidateProfile();
      logger.info('✓ Candidate profile loaded');
      
      const errors = validateCandidateProfile(profile);
      if (errors.length > 0) {
        logger.warn('Profile validation issues:');
        errors.forEach(e => logger.warn(`  - ${e}`));
      } else {
        logger.info('✓ Profile validated');
      }
      
      const resumePath = getResumePath(profile);
      if (resumePath) {
        logger.info(`✓ Resume found: ${resumePath}`);
      } else {
        logger.warn('✗ Resume not found');
      }
      
      // Test job fetching
      logger.info('Fetching jobs...');
      const jobs = await ingestJobs(
        settings.jobSource.repository,
        settings.jobSource.branch,
        settings.jobSource.readmePath
      );
      logger.info(`✓ Fetched ${jobs.length} jobs`);
      
      // Test browser
      logger.info('Testing browser...');
      await initializeBrowser(settings.browser);
      logger.info('✓ Browser initialized');
      
      const browser = getBrowserManager();
      await browser.navigateTo('https://example.com');
      logger.info('✓ Navigation working');
      
      console.log('\n' + chalk.green('All tests passed!') + '\n');
      
    } catch (error) {
      logger.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    } finally {
      await closeBrowser();
    }
  });

program
  .command('history')
  .description('View application history')
  .action(async () => {
    const { listApplications, getStats } = await import('./log/application-history');
    
    const stats = getStats();
    const applications = listApplications();
    
    console.log('\n' + chalk.bgCyan.black(' APPLICATION HISTORY ') + '\n');
    console.log(`Total: ${stats.total} | Submitted: ${chalk.green(stats.submitted)} | Partial: ${chalk.yellow(stats.partial)} | Failed: ${chalk.red(stats.failed)}\n`);
    
    if (applications.length === 0) {
      console.log(chalk.gray('No applications recorded yet.'));
    } else {
      // Sort by date, newest first
      applications.sort((a, b) => new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime());
      
      for (const app of applications.slice(0, 20)) {
        const date = new Date(app.applied_at).toLocaleDateString();
        const statusIcon = app.status === 'submitted' ? '✓' : app.status === 'partial' ? '◐' : '✗';
        const statusColor = app.status === 'submitted' ? chalk.green : app.status === 'partial' ? chalk.yellow : chalk.red;
        
        console.log(`${statusColor(statusIcon)} ${chalk.bold(app.company)} - ${app.role}`);
        console.log(chalk.gray(`   ${date} | ${app.url.substring(0, 60)}...`));
        if (app.notes) console.log(chalk.gray(`   Note: ${app.notes}`));
        console.log();
      }
      
      if (applications.length > 20) {
        console.log(chalk.gray(`... and ${applications.length - 20} more`));
      }
    }
  });

// Parse arguments
program.parse();

