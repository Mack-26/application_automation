/**
 * GitHub README parser for extracting job postings
 * Supports both Markdown tables and HTML tables
 */

import type { Job } from '../types';

/**
 * Fetch README content from a GitHub repository
 */
export async function fetchReadme(
  repository: string,
  branch: string = 'dev',
  readmePath: string = 'README.md'
): Promise<string> {
  const rawUrl = `https://raw.githubusercontent.com/${repository}/${branch}/${readmePath}`;
  
  const response = await fetch(rawUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch README: ${response.status} ${response.statusText}`);
  }
  
  return response.text();
}

/**
 * Extract URL from various link formats
 */
function extractUrl(text: string): string | null {
  // Match href="url" pattern (HTML)
  const hrefMatch = text.match(/href="([^"]+)"/);
  if (hrefMatch) {
    let url = hrefMatch[1];
    // Remove tracking parameters
    url = url.split('?utm_source')[0];
    return url;
  }
  
  // Match [text](url) pattern (Markdown)
  const mdMatch = text.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (mdMatch) {
    let url = mdMatch[2];
    url = url.split('?utm_source')[0];
    return url;
  }
  
  // Match plain URL
  const urlMatch = text.match(/https?:\/\/[^\s<>"]+/);
  if (urlMatch) {
    let url = urlMatch[0];
    url = url.split('?utm_source')[0];
    return url;
  }
  
  return null;
}

/**
 * Extract text content, stripping HTML tags
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract company name from cell content
 */
function extractCompany(cell: string): string {
  // Handle **Company** format
  const boldMatch = cell.match(/\*\*([^*]+)\*\*/);
  if (boldMatch) {
    return boldMatch[1].trim();
  }
  
  // Handle <strong><a>Company</a></strong> format
  const strongAMatch = cell.match(/<strong[^>]*><a[^>]*>([^<]+)<\/a><\/strong>/i);
  if (strongAMatch) {
    return strongAMatch[1].trim();
  }
  
  // Handle <a>Company</a> format
  const aMatch = cell.match(/<a[^>]*>([^<]+)<\/a>/i);
  if (aMatch) {
    return aMatch[1].trim();
  }
  
  // Handle [Company](url) format
  const linkMatch = cell.match(/\[([^\]]+)\]/);
  if (linkMatch) {
    return linkMatch[1].trim();
  }
  
  return stripHtml(cell);
}

/**
 * Parse HTML table rows
 */
function parseHtmlTable(html: string): Job[] {
  const jobs: Job[] = [];
  
  // Find all table bodies
  const tbodyMatches = html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi);
  
  for (const tbodyMatch of tbodyMatches) {
    const tbody = tbodyMatch[1];
    
    // Find all rows
    const rowMatches = tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    
    for (const rowMatch of rowMatches) {
      const row = rowMatch[1];
      
      // Skip rows with 🔒 (closed)
      if (row.includes('🔒')) {
        continue;
      }
      
      // Extract cells
      const cellMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      
      if (cellMatches.length < 4) continue;
      
      const companyCell = cellMatches[0][1];
      const roleCell = cellMatches[1][1];
      const locationCell = cellMatches[2][1];
      const applicationCell = cellMatches[3][1];
      
      // Handle continuation rows (↳)
      let company = extractCompany(companyCell);
      if (company === '↳' || company === '') {
        // This is a continuation, skip for now (we'd need to track previous company)
        continue;
      }
      
      const role = stripHtml(roleCell);
      const location = stripHtml(locationCell);
      
      // Extract application URL - look for job board links, not Simplify links
      let applyUrl: string | null = null;
      
      // Prefer greenhouse, lever, workday, etc. links over simplify.jobs
      const jobBoardPatterns = [
        /href="(https?:\/\/[^"]*greenhouse[^"]*)"/i,
        /href="(https?:\/\/[^"]*lever[^"]*)"/i,
        /href="(https?:\/\/[^"]*workday[^"]*)"/i,
        /href="(https?:\/\/[^"]*icims[^"]*)"/i,
        /href="(https?:\/\/[^"]*ashby[^"]*)"/i,
        /href="(https?:\/\/[^"]*careers\.[^"]*)"/i,
        /href="(https?:\/\/[^"]*jobs\.[^"]*)"/i,
      ];
      
      for (const pattern of jobBoardPatterns) {
        const match = applicationCell.match(pattern);
        if (match) {
          applyUrl = match[1].split('?utm_source')[0];
          break;
        }
      }
      
      // Fall back to any href that's not simplify
      if (!applyUrl) {
        const hrefMatches = applicationCell.matchAll(/href="([^"]+)"/g);
        for (const match of hrefMatches) {
          const url = match[1];
          if (!url.includes('simplify.jobs')) {
            applyUrl = url.split('?utm_source')[0];
            break;
          }
        }
      }
      
      if (!company || !applyUrl) continue;
      
      jobs.push({
        company,
        role: role || 'Software Engineering Intern',
        location: location || 'Unknown',
        apply_url: applyUrl,
        source: 'github',
      });
    }
  }
  
  return jobs;
}

/**
 * Parse Markdown table rows (legacy format)
 */
function parseMarkdownTable(markdown: string): Job[] {
  const jobs: Job[] = [];
  const lines = markdown.split('\n');
  
  let inTable = false;
  let headers: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect table rows (lines starting with |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Skip separator rows (|---|---|)
      if (trimmed.match(/^\|[\s\-:|]+\|$/)) {
        inTable = true;
        continue;
      }
      
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      
      // First row after header is data
      if (!inTable && (trimmed.toLowerCase().includes('company') || trimmed.toLowerCase().includes('role'))) {
        headers = cells.map(c => c.toLowerCase());
        inTable = true;
        continue;
      }
      
      if (inTable && cells.length >= 3) {
        // Skip closed jobs
        if (trimmed.includes('🔒')) continue;
        
        const companyIdx = headers.findIndex(h => h.includes('company'));
        const roleIdx = headers.findIndex(h => h.includes('role') || h.includes('title'));
        const locationIdx = headers.findIndex(h => h.includes('location'));
        const applyIdx = headers.findIndex(h => h.includes('apply') || h.includes('link'));
        
        const company = companyIdx >= 0 ? extractCompany(cells[companyIdx]) : extractCompany(cells[0]);
        const role = roleIdx >= 0 ? stripHtml(cells[roleIdx]) : stripHtml(cells[1]);
        const location = locationIdx >= 0 ? stripHtml(cells[locationIdx]) : 'Unknown';
        const applyUrl = extractUrl(applyIdx >= 0 ? cells[applyIdx] : line);
        
        if (company && applyUrl && company !== '↳') {
          jobs.push({
            company,
            role: role || 'Software Engineering Intern',
            location,
            apply_url: applyUrl,
            source: 'github',
          });
        }
      }
    } else if (inTable && !trimmed.startsWith('|')) {
      inTable = false;
      headers = [];
    }
  }
  
  return jobs;
}

/**
 * Parse job tables from README content (supports both HTML and Markdown)
 */
export function parseJobs(content: string): Job[] {
  const jobs: Job[] = [];
  
  // Try HTML tables first (newer format)
  if (content.includes('<table>') || content.includes('<tbody>')) {
    const htmlJobs = parseHtmlTable(content);
    jobs.push(...htmlJobs);
  }
  
  // Also try Markdown tables (legacy format)
  if (content.includes('|')) {
    const mdJobs = parseMarkdownTable(content);
    // Only add if we didn't find HTML jobs or MD jobs are different
    for (const job of mdJobs) {
      const exists = jobs.some(j => j.apply_url === job.apply_url);
      if (!exists) {
        jobs.push(job);
      }
    }
  }
  
  return jobs;
}

/**
 * Fetch and parse jobs from GitHub repository
 */
export async function ingestJobs(
  repository: string,
  branch: string = 'dev',
  readmePath: string = 'README.md'
): Promise<Job[]> {
  const content = await fetchReadme(repository, branch, readmePath);
  return parseJobs(content);
}

export default {
  fetchReadme,
  parseJobs,
  ingestJobs,
};
