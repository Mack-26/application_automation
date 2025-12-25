/**
 * PDF Text Extractor
 * Extracts text content from PDF resume files
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../log/logger';

const logger = getLogger();

/**
 * Extract text from PDF using pdftotext command
 * Falls back to basic extraction if command not available
 */
export async function extractPDFText(pdfPath: string): Promise<string> {
  const fullPath = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(process.cwd(), pdfPath);
  
  if (!fs.existsSync(fullPath)) {
    logger.warn(`[PDF] File not found: ${fullPath}`);
    return '';
  }
  
  try {
    // Try using pdftotext command (most reliable)
    const { execSync } = await import('child_process');
    try {
      const text = execSync(`pdftotext "${fullPath}" -`, { 
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
      logger.debug(`[PDF] Extracted ${text.length} characters using pdftotext`);
      return text;
    } catch (error) {
      logger.debug(`[PDF] pdftotext not available, trying alternative method`);
    }
    
    // Fallback: Try pdf-parse if available
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(fullPath);
      const data = await pdfParse(dataBuffer);
      logger.debug(`[PDF] Extracted ${data.text.length} characters using pdf-parse`);
      return data.text;
    } catch (error) {
      logger.debug(`[PDF] pdf-parse not available`);
    }
    
    // Last resort: Read as binary and try basic extraction
    logger.warn(`[PDF] No PDF parser available, returning empty string`);
    return '';
    
  } catch (error) {
    logger.error(`[PDF] Error extracting text: ${error}`);
    return '';
  }
}

/**
 * Generate resume text from profile data (fallback when PDF parsing fails)
 */
function generateResumeTextFromProfile(profile: any): string {
  const pi = profile.personal || {};
  const edu = profile.education || [];
  const exp = profile.work_experience || [];
  const skills = profile.skills || {};
  
  let text = `RESUME\n\n`;
  
  // Personal info
  text += `${pi.first_name || ''} ${pi.last_name || ''}\n`;
  text += `${pi.location || ''} | ${pi.email || ''} | ${pi.phone || ''}\n\n`;
  
  if (pi.links?.linkedin) text += `LinkedIn: ${pi.links.linkedin}\n`;
  if (pi.links?.github) text += `GitHub: ${pi.links.github}\n`;
  text += `\n`;
  
  // Education
  text += `EDUCATION\n`;
  edu.forEach((e: any) => {
    text += `${e.school || ''}\n`;
    text += `${e.degree || ''} in ${e.field || ''} (${e.graduation || ''})\n`;
    if (e.gpa) text += `GPA: ${e.gpa}\n`;
    text += `\n`;
  });
  
  // Work Experience
  text += `PROFESSIONAL EXPERIENCE\n`;
  exp.forEach((e: any) => {
    text += `${e.title || ''} | ${e.company || ''}\n`;
    text += `${e.location || ''} | ${e.start_date || ''} - ${e.end_date || ''}\n`;
    if (e.description && Array.isArray(e.description)) {
      e.description.forEach((d: string) => {
        text += `- ${d}\n`;
      });
    }
    text += `\n`;
  });
  
  // Skills
  text += `SKILLS\n`;
  const allSkills = [
    ...(skills.languages || []),
    ...(skills.ml || []),
    ...(skills.tools || []),
  ];
  text += allSkills.join(', ') + `\n`;
  
  return text;
}

/**
 * Get resume text from profile
 */
export async function getResumeText(profile: any): Promise<string> {
  // Try PDF first
  if (profile.resume?.file_path) {
    const pdfText = await extractPDFText(profile.resume.file_path);
    if (pdfText && pdfText.trim().length > 100) {
      return pdfText;
    }
  }
  
  // Fallback to profile data
  logger.info('[PDF] Using profile data to generate resume text');
  return generateResumeTextFromProfile(profile);
}

