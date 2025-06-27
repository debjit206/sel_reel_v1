# Instagram Mobile Scraper

A robust Instagram reel scraper using Selenium WebDriver and Google Sheets integration. Supports both local and remote (headless/grid) Selenium servers, with cookie-based login for automation.

---

## Features
- Scrapes Instagram reel data for a list of usernames and post links from a Google Sheet
- Outputs results as JSON in the terminal
- Uses cookies.json for login (no need for manual login every run)
- Supports both local ChromeDriver and remote Selenium/Grid servers
- Handles Instagram popups automatically
- Easy configuration via `.env` and `credentials.json`

---

## Prerequisites
- Node.js (v18+ recommended)
- Chrome browser (for local runs)
- ChromeDriver (installed via npm)
- Google Cloud service account credentials for Sheets API
- A Google Sheet with columns: `username`, `post_link`

---

## Setup

1. **Clone the repository:**
   ```sh
   git clone <your-repo-url>
   cd <repo-directory>
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Add required files:**
   - `.env` (see below for required variables)
   - `credentials.json` (Google service account credentials)
   - `cookies.json` (generated after first manual login)

---

## Environment Variables (`.env`)

```
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_SHEET_NAME=Sheet1
GOOGLE_CREDENTIALS_FILE=credentials.json
# Optional: for remote Selenium
# SELENIUM_REMOTE_URL=http://your-remote-selenium:4444/wd/hub
```

---

## Google Sheets Setup
- Create a Google Sheet with at least two columns: `username` and `post_link`.
- Share the sheet with your Google service account email (from `credentials.json`).

---

## Usage

### 1. **First Run (Manual Login, Local Only)**
- Run the script locally (not headless) to perform manual login and save cookies:
  ```sh
  node reel_selenium.js
  ```
- Follow the prompt to log in to Instagram in the browser window. Confirm when logged in.
- This will create a `cookies.json` file for future automated runs.

### 2. **Automated/Headless Runs (Local or Remote)**
- With a valid `cookies.json`, you can run the script in headless mode, locally or on a server/grid.

#### **Local ChromeDriver:**
```sh
node reel_selenium.js
```

#### **Remote Selenium/Grid:**
Set the environment variable and run:
```sh
# Linux/macOS
export SELENIUM_REMOTE_URL="http://your-remote-selenium:4444/wd/hub"
node reel_selenium.js

# Windows PowerShell
$env:SELENIUM_REMOTE_URL="http://your-remote-selenium:4444/wd/hub"
node reel_selenium.js
```

---

## Output
- The script prints the scraped results as formatted JSON in the terminal.
- No data is written back to the Google Sheet.

---

## File Descriptions
- `reel_selenium.js` — Main scraper script
- `cookies.json` — Instagram session cookies (required for automated login)
- `.env` — Environment variables (Google Sheet ID, etc.)
- `credentials.json` — Google service account credentials
- `package.json` / `package-lock.json` — Node.js dependencies

---

## Troubleshooting
- **Cookies expired/invalid:**
  - Re-run the script locally, log in manually, and update `cookies.json`.
- **Cannot connect to remote Selenium:**
  - Check VPN, firewall, and `SELENIUM_REMOTE_URL`.
- **Google Sheets errors:**
  - Ensure the service account has access to the sheet.
- **npm or chromedriver errors:**
  - Ensure Node.js and ChromeDriver versions are compatible with your Chrome browser.

---

## License
MIT 
