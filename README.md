# Job Application Agent

A compliant, human-in-the-loop system that automates job applications using a structured candidate profile and public GitHub repositories of internship postings.

## Features

- **AI-Powered Form Filling**: Uses OpenAI to intelligently understand and fill form questions
- **GitHub Integration**: Automatically parses job postings from GitHub README tables
- **ATS Detection**: Identifies Applicant Tracking Systems (Greenhouse, Lever, Workday, Ashby, iCIMS)
- **Resume Upload**: Automatic PDF resume detection and upload
- **Form Autofill**: Intelligent field mapping based on ATS type
- **Human Checkpoints**: Pauses for login, CAPTCHA, and email verification
- **Persistent Sessions**: Browser cookies retained across sessions
- **Application History**: Tracks applied jobs to prevent duplicates
- **Detailed Logging**: JSON logs with metrics and screenshots

## Architecture

```
assets/                 # Static files (resume PDF)
config/                 # Configuration and mappings
src/
  ├─ ingest/           # GitHub repo parsing
  ├─ normalize/        # ATS detection & job normalization
  ├─ browser/          # Playwright orchestration
  ├─ autofill/         # Field mapping & form filling
  ├─ checkpoints/      # Human-in-the-loop pauses
  ├─ submit/           # Validation & submission
  └─ log/              # Logging & metrics
```

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn

## Installation

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium
```

## Configuration

### 1. Candidate Profile

Edit `config/candidate-profile.json` with your information:

```json
{
  "personal": {
    "first_name": "Your First Name",
    "last_name": "Your Last Name",
    "email": "your.email@example.com",
    "phone": "+1-555-123-4567",
    "location": "City, State",
    "work_authorization": "US Citizen"
  },
  "education": [
    {
      "school": "Your University",
      "degree": "Bachelor's",
      "field": "Computer Science",
      "graduation": "2025-05"
    }
  ],
  "skills": {
    "languages": ["Python", "JavaScript", "TypeScript"],
    "ml": ["PyTorch", "TensorFlow"],
    "tools": ["Git", "Docker", "AWS"]
  },
  "links": {
    "github": "https://github.com/yourusername",
    "linkedin": "https://linkedin.com/in/yourusername"
  }
}
```

### 2. Resume

Place your resume PDF in the `assets/` directory:

```
assets/
  └─ resume.pdf
```

### 3. Job Source (Optional)

Edit `config/settings.json` to change the job source:

```json
{
  "jobSource": {
    "repository": "SimplifyJobs/Summer2025-Internships",
    "branch": "dev",
    "readmePath": "README.md"
  }
}
```

## AI Form Filling Setup

For best results, enable AI-powered form filling. Supports **Hugging Face** or **OpenAI**.

### Option A: Hugging Face (Recommended - Free tier available)

1. Get your access token from [Hugging Face Settings](https://huggingface.co/settings/tokens)

2. Set the environment variable:
```bash
export HUGGINGFACE_API_KEY="hf_your-token-here"
```

3. Configure in `config/candidate-profile.json`:
```json
{
  "ai_responses": {
    "enabled": true,
    "provider": "huggingface",
    "model": "mistralai/Mistral-7B-Instruct-v0.3"
  }
}
```

**Other good HF models:**
- `mistralai/Mistral-7B-Instruct-v0.3` (default, fast)
- `meta-llama/Meta-Llama-3-8B-Instruct` (high quality)
- `HuggingFaceH4/zephyr-7b-beta` (good for structured output)

### Option B: OpenAI

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)

2. Set the environment variable:
```bash
export OPENAI_API_KEY="sk-your-api-key-here"
```

3. Configure in `config/candidate-profile.json`:
```json
{
  "ai_responses": {
    "enabled": true,
    "provider": "openai",
    "model": "gpt-4o-mini"
  }
}
```

### How AI Filling Works

1. **Extracts ALL form fields** from the page (text, dropdowns, radio buttons, etc.)
2. **Sends to AI** with your profile and resume info
3. **AI generates answers** for each field (picks exact dropdown options)
4. **Fills all fields** in one pass - no duplicates

This handles "Why this company?", EEO questions, and custom dropdowns much better than rule-based filling.

## Usage

### Build the project

```bash
npm run build
```

### Test configuration

```bash
npm start test
```

### Run the agent

```bash
# Process all available jobs
npm start run

# Limit to N applications
npm start run -- --limit 5

# Filter by company name
npm start run -- --company "Google"

# Dry run (list jobs without applying)
npm start run -- --dry-run

# Fill forms but don't submit
npm start run -- --no-submit
```

### Apply to a single job

```bash
npm start apply "https://jobs.lever.co/company/position"
```

### Development mode

```bash
npm run dev run -- --dry-run
```

## Human Checkpoints

The agent will pause and notify you when:

1. **Login Required**: Log in to the ATS in the browser window
2. **CAPTCHA Detected**: Solve the CAPTCHA manually
3. **Email Verification**: Complete email verification
4. **Missing Fields**: Fill any fields that couldn't be automated

Press `Enter` in the terminal to continue after completing the required action.

## Logging

Application logs are saved to `logs/` directory:

```json
{
  "company": "Company Name",
  "role": "Software Engineer Intern",
  "ats": "greenhouse",
  "status": "submitted",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "duration_ms": 45000
}
```

Screenshots are saved to `logs/screenshots/` for debugging.

## Supported ATS

| ATS | URL Pattern | Support Level |
|-----|-------------|---------------|
| Greenhouse | greenhouse.io | Full |
| Lever | jobs.lever.co | Full |
| Workday | myworkdayjobs.com | Full |
| Ashby | ashbyhq.com | Full |
| iCIMS | icims.com | Full |
| Custom | Other | Basic |

## Constraints

This system is designed to be compliant and respectful. The following are **explicitly prohibited**:

- ❌ Email inbox scraping or OTP interception
- ❌ CAPTCHA solving or bypassing
- ❌ Automated account creation
- ❌ Identity spoofing
- ❌ Headless evasion or ToS circumvention

## Success Criteria

- Resume PDF uploaded automatically in ≥90% of applications
- Human input required only for login, email verification, CAPTCHA
- Average application time ≤3 minutes
- Zero account lockouts or bans

## Troubleshooting

### Browser not opening

Ensure Playwright browsers are installed:

```bash
npx playwright install chromium
```

### Resume not uploading

- Verify `assets/resume.pdf` exists
- Check file size (some ATS have limits)
- Ensure PDF is not password-protected

### Form fields not filling

- The ATS may use non-standard field names
- Check `config/ats-mappings.json` for supported selectors
- Use `--no-submit` mode to manually complete fields

## License

MIT
