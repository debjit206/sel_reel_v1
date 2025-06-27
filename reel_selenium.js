// Instagram Mobile Scraper using Selenium and Google Sheets
//
// Headless Remote Selenium Workflow:
// 1. Run this script locally with a visible browser, log in manually, and let it save cookies.json.
// 2. Copy cookies.json to the server where Selenium/ChromeDriver is running headless.
// 3. On the server, set SELENIUM_REMOTE_URL (e.g., http://34.1.134.253:4444/wd/hub) and run the script.
// 4. The script will use cookies.json for automated, headless scraping.
//
// No further code changes are needed for remote headless operation.
const { Builder, By, until } = require('selenium-webdriver');
require('chromedriver'); // Ensure chromedriver is installed and available
const { google } = require('googleapis');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon'); // For datetime handling
const readline = require('readline');
dotenv.config();

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_FILE || 'credentials.json';

class InstagramScraper {
  constructor() {
    // Google Sheets connection
    this.sheetId = process.env.GOOGLE_SHEET_ID;
    this.sheetName = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
    this.credentialsPath = process.env.GOOGLE_CREDENTIALS_FILE || 'credentials.json';
    this.sheets = null;

    // Selenium WebDriver initialization
    this.driver = null;
    this.scrapedData = [];
    this.POST_SELECTORS = [
      'a[href*="/reel/"]',  // Direct reel links
      'div[role="tablist"] a[href*="/reel/"]',  // Reels in tablist
      'div[data-media-type="Reels"] a',  // Reels container
      'div[role="tabpanel"] a[href*="/reel/"]'  // Reels in tab panel
    ];

    // JavaScript to expand truncated content
    this.EXPAND_CONTENT_JS = `
        (async () => {
            // Find and click any "more" buttons in captions
            const moreButtonSelectors = [
                'div._a9zs button',
                'button._aacl._aaco._aacu',
                'button[role="button"]'
            ];

            for (const selector of moreButtonSelectors) {
                const buttons = document.querySelectorAll(selector);
                for (const button of buttons) {
                    const text = button.textContent || '';
                    if (text.includes('more') || text.includes('...')) {
                        console.log('Found more button:', text);
                        button.click();
                        // Wait longer after clicking to ensure expansion completes
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }

            // Wait for possible dynamic content loading
            await new Promise(r => setTimeout(r, 1500));
        })();
    `;
    
    this.MODAL_SELECTORS = {
            'grid_views': [
        'span[class*="videoViews"]',  // Video views in grid
        'span[class*="view-count"]',  // View count in grid
        'span._ac2a',  // Common view count class
        'span._aacl._aaco',  // Another common view class
        'span:has(svg[aria-label*="view"])',  // View icon with count
        'span:has(svg[aria-label="Play"]) + span'  // Count next to play icon
            ],
            'views': [
        'span[class*="view-count"]',  // Direct view count
        'span:has-text("views")',  // Text containing views
        'span[role="button"]:has-text("views")',  // View count button
        'section span:has-text("views")',  // Views in section
        'div[role="button"] span:has-text("views")'  // Views in button
            ],
            'likes': [
        'section span[role="button"]',  // Primary role-based selector
        'a[role="link"] span[role="button"]',  // Link-based role selector 
        'span[role="button"]',  // Generic role selector
        'div[role="button"] span',  // Nested role selector
        'section div span span:not([role])',  // Generic likes counter
        'a[href*="/liked_by/"] span',  // Liked by link
        'section > div > div > span',  // Covers "Liked by X and others" pattern
        'div[role="presentation"] > div > div > span',  // Presentation role variation
        'article div > span > span',  // Deep nested structure
        'span[aria-label*="like"], span[aria-label*="view"]',  // Aria-labeled engagement
        'div > span > span:not([role])',  // Most generic fallback
        'section div[role="button"]',  // Alternative role structure
        'div[role="button"] div[dir="auto"]',  // Auto-direction text in button
        'section span[aria-label*="like"], section span[aria-label*="view"]',  // Direct access to aria labels
        'article > section span:not([role])'  // Article-specific likes
            ],
            'caption': [
        'h1._aagv span[dir="auto"]',  // Main caption text element
        'h1[dir="auto"]',             // Alternative caption text element
        'div._a9zs span[dir="auto"]',  // Backup caption selector
        'div._a9zs h1',               // Another possible caption container
        'div[role="menuitem"] span',  // Another variation
        'article div._a9zs',          // Container that includes username + caption
        'div.C4VMK > span'           // Legacy selector as fallback
            ],
            'more_button': [
        'div._a9zs button',           // "more" button in caption
        'button._aacl._aaco._aacu',   // Another variation of more button
        'button[role="button"]'       // Generic button fallback
            ],
            'comments': [
        'span._aacl._aaco._aacw._aacz._aada',  // Primary comment count selector
        'section span[aria-label*="comment"]',  // Generic comment count
        'a[href*="/comments/"] span'           // Backup selector for comment counts
            ],
            'date': [
                'time._aaqe[datetime]',
                'time[datetime]'
            ]
    };
    this.userDataDir = './user_data';
  }

  async setupGoogleSheets() {
    // Initialize connection to Google Sheets
    try {
      const credentials = JSON.parse(fs.readFileSync(this.credentialsPath));
      const scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ];
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes,
      });
      this.sheets = google.sheets({ version: 'v4', auth });
      console.log('✅ Connected to Google Sheet successfully');
    } catch (e) {
      console.log(`❌ Failed to connect to Google Sheets: ${e.message}`);
      throw e;
    }
  }

  async getSheetData() {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: this.sheetName,
    });
    const rows = res.data.values;
    if (!rows || rows.length < 2) throw new Error('No data found in sheet');
    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
    return { headers, data };
  }

  async setupBrowser() {
    // Initialize Selenium WebDriver with Chrome and mobile emulation
    const chrome = require('selenium-webdriver/chrome');
    const options = new chrome.Options();
    // Mobile emulation
    options.addArguments(
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--window-size=390,844',
      '--disable-logging',
      '--log-level=3',
      '--silent',
      '--headless' // Always headless now
    );
    // Set user agent for mobile
    options.addArguments(
      `--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1`
    );
    // Suppress chromedriver logs
    const service = new chrome.ServiceBuilder()
      .loggingTo(process.platform === 'win32' ? 'NUL' : '/dev/null')
      .enableVerboseLogging(false);
    this.driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .setChromeService(service)
      .build();
    console.log("✅ Browser setup complete");
  }

  async loginInstagram() {
    try {
      console.log("🔄 Checking Instagram login status...");
      await this.setupBrowser();
      await this.driver.get('https://www.instagram.com/');
      await this.driver.sleep(2000);

      // Try to load cookies if cookies.json exists
      let cookiesLoaded = false;
      if (fs.existsSync('cookies.json')) {
        const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
        for (const cookie of cookies) {
          // Remove 'sameSite' if it causes issues
          const { sameSite, ...rest } = cookie;
          try {
            await this.driver.manage().addCookie(rest);
          } catch (e) {
            // Some cookies may not be settable, ignore errors
          }
        }
        await this.driver.navigate().refresh();
        await this.driver.sleep(2000);
        // Check if cookies worked
        const loggedIn = await this.checkLoginStatus();
        if (loggedIn) {
          console.log('✅ Logged in using cookies!');
          return true;
        } else {
          console.log('⚠️ Cookies invalid, please log in manually.');
        }
      }

      // Wait for manual login and user confirmation
      while (true) {
        console.log("📱 Please log in manually in the browser window.");
        const answer = await new Promise(resolve => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl.question("Are you logged in to Instagram? (yes/no): ", ans => {
            rl.close();
            resolve(ans.trim().toLowerCase());
          });
        });
        if (answer === 'yes' || answer === 'y') {
          // Save cookies
          const cookies = await this.driver.manage().getCookies();
          fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
          console.log("✅ Cookies saved to cookies.json");
          console.log("✅ Proceeding with scraping...");
          return true;
        } else {
          console.log("⏳ Waiting 30 seconds for you to log in...");
          await this.driver.sleep(30000);
        }
      }
    } catch (e) {
      console.error(`❌ Error during login process: ${e.message}`);
      return false;
    }
  }

  async checkLoginStatus() {
    // Check if we're logged into Instagram by looking for multiple indicators
    try {
      await this.driver.sleep(2000);
      // Check for login-required elements
      let loginElements = [];
      try {
        loginElements = await this.driver.findElements(By.css('form[action*="login"]'));
      } catch (e) {
        // ignore
      }
      if (loginElements.length > 0) {
        console.log("⚠️ Login form detected - not logged in");
        return false;
      }
      // Check for home feed indicators
      const homeIndicators = [
        'a[href*="/p/"]',  // Post links
        'button[aria-label*="Like"]',  // Like buttons
        'svg[aria-label="Home"]',  // Home icon
        'a[href="/"]'  // Home link
      ];
      for (const selector of homeIndicators) {
        try {
          const elements = await this.driver.findElements(By.css(selector));
          if (elements.length > 0) {
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      // Additional check - look for logged-in user avatar
      try {
        const avatar = await this.driver.findElements(By.css('img[data-testid="user-avatar"]'));
        if (avatar.length > 0) {
          return true;
        }
      } catch (e) {
        // ignore
      }
      console.log("⚠️ No logged-in indicators found");
      return false;
    } catch (e) {
      console.error(`❌ Error checking login status: ${e.message}`);
      return false;
    }
  }

  async scrapeProfile(profileUrl, targetPostLink = null) {
    // Scrape individual Instagram profile
    try {
      console.log(`🔄 Scraping: ${profileUrl}`);
      await this.driver.get(profileUrl);
      await this.driver.sleep(3000);
      // data structure
      const profileData = {
        username: '',
        platform: 'Instagram',
        posts: [],
        fetched: 'No'
      };
      // username from URL
      const usernameMatch = profileUrl.match(/instagram\.com\/([^/?]+)/);
      if (usernameMatch) {
        profileData.username = usernameMatch[1];
      }
      // Remove all code that scrapes Name, Description, Followers, Avatar URL, and Total Posts
      // ... existing code ...
      return profileData;
    } catch (e) {
      console.log(`❌ Error scraping ${profileUrl}: ${e.message}`);
      return null;
    }
  }

  async extractSpecificPostData(profileData, targetPostLink) {
    // Extract data from a specific post/reel URL in the profile
    const posts = [];
    try {
      // reels tab
      console.log("🎬 Switching to reels tab...");
      try {
        const reelsTabs = await this.driver.findElements(By.css('a[href*="/reels/"]'));
        if (reelsTabs.length > 0) {
          await this.driver.executeScript("arguments[0].scrollIntoView({block: 'center'});", reelsTabs[0]);
          await this.driver.sleep(500);
          try {
            await reelsTabs[0].click();
          } catch (e) {
            console.log('⚠️ Click intercepted, retrying after 1s...');
            await this.driver.sleep(1000);
            await reelsTabs[0].click();
          }
          await this.driver.sleep(3000);
          console.log("✅ Switched to reels tab");
        } else {
          console.log("⚠️ Could not find reels tab");
          return profileData;
        }
        // reels to be visible
        console.log("🔍 Looking for reels...");
        await this.driver.wait(until.elementLocated(By.css('a[href*="/reel/"]')), 5000);
      } catch (e) {
        console.log(`⚠️ Error switching to reels tab: ${e.message}`);
      }
      // reel ID from targetPostLink
      let targetReelId = null;
      if (targetPostLink) {
        // reel ID from various URL formats (now supports /reel/ and /p/)
        const reelPatterns = [
          /\/reel\/([^/?]+)/,
          /reel\/([^/?]+)/,
          /instagram\\.com\/reel\/([^/?]+)/,
          /\/p\/([^/?]+)/,
          /p\/([^/?]+)/,
          /instagram\\.com\/p\/([^/?]+)/
        ];
        for (const pattern of reelPatterns) {
          const match = targetPostLink.match(pattern);
          if (match) {
            targetReelId = match[1];
            console.log(`🎯 Looking for reel/post ID: ${targetReelId}`);
            break;
          }
        }
      }
      if (!targetReelId) {
        console.log("❌ Could not extract reel/post ID from targetPostLink");
        return profileData;
      }
      // all reel elements
      let postElements = [];
      for (const selector of this.POST_SELECTORS) {
        try {
          const elements = await this.driver.findElements(By.css(selector));
          if (elements && elements.length > 0) {
            postElements = postElements.concat(elements);
            console.log(`✅ Found ${elements.length} post elements using selector: ${selector}`);
          }
        } catch (e) {
          console.log(`⚠️ Error trying selector '${selector}': ${e.message}`);
          continue;
        }
      }
      if (!postElements.length) {
        console.log("⚠️ No post elements found using any selector");
        return profileData;
      }
      // Find the element matching the target reel ID, with scrolling if not found
      let targetElement = null;
      const maxScrolls = 3;
      for (let scrollAttempt = 0; scrollAttempt < maxScrolls && !targetElement; scrollAttempt++) {
        for (const postElement of postElements) {
          try {
            const href = await postElement.getAttribute('href');
            if (href && href.includes(targetReelId)) {
              targetElement = postElement;
              break;
            }
          } catch (e) {
            continue;
          }
        }
        if (!targetElement && scrollAttempt < maxScrolls - 1) {
          // Scroll down and wait for more reels to load
          await this.driver.executeScript('window.scrollBy(0, 1000);');
          await this.driver.sleep(2000);
          // Re-fetch post elements after scroll
          postElements = [];
          for (const selector of this.POST_SELECTORS) {
            try {
              const elements = await this.driver.findElements(By.css(selector));
              if (elements && elements.length > 0) {
                postElements = postElements.concat(elements);
              }
            } catch (e) {
              continue;
            }
          }
        }
      }
      if (!targetElement) {
        console.log(`❌ Target reel ${targetReelId} not found in reels tab after scrolling`);
        return profileData;
      }
      // Scrape the reel data (extract view count from grid, then open in new tab for rest)
      const postData = {
        url: '',
        caption: '',
        likesCount: 0,
        commentsCount: 0,
        viewCount: 0,
        timestamp: '',
      };
      try {
        // 1. Extract view count from grid element BEFORE opening the post
        postData.viewCount = await this.extractGridViewCount(targetElement);
        // 2. Now open the post in new tab and extract the rest
        const postUrl = await targetElement.getAttribute('href');
        if (!postUrl) return null;
        postData.url = postUrl.startsWith('http') ? postUrl : `https://www.instagram.com${postUrl}`;
        await this.driver.executeScript('window.open(arguments[0], "_blank");', postData.url);
        const handles = await this.driver.getAllWindowHandles();
        const newTab = handles[handles.length - 1];
        await this.driver.switchTo().window(newTab);
        await this.driver.sleep(2000);
        await this.driver.executeScript(this.EXPAND_CONTENT_JS);
        await this.driver.sleep(2000);
        // Caption
        let captionFound = false;
        let retryCount = 0;
        while (!captionFound && retryCount < 3) {
          for (const selector of this.MODAL_SELECTORS.caption) {
            try {
              const captionElements = await this.driver.findElements(By.css(selector));
              for (const captionElement of captionElements) {
                const captionText = await captionElement.getText();
                if (captionText) {
                  let cleanCaption = captionText;
                  if (captionText.includes(':') && !captionText.startsWith('http')) {
                    cleanCaption = captionText.split(':').slice(1).join(':').trim();
                  }
                  cleanCaption = cleanCaption.replace('... more', '').trim();
                  postData.caption = cleanCaption;
                  captionFound = true;
                  break;
                }
              }
              if (captionFound) break;
            } catch (e) {
              continue;
            }
          }
          if (!captionFound) {
            retryCount++;
            await this.driver.sleep(1000);
          }
        }
        // timestamp
        for (const selector of this.MODAL_SELECTORS.date) {
          try {
            const dateElements = await this.driver.findElements(By.css(selector));
            for (const dateElement of dateElements) {
              const timestamp = await dateElement.getAttribute('datetime');
              if (timestamp) {
                postData.timestamp = timestamp;
                break;
              }
            }
            if (postData.timestamp) break;
          } catch (e) {
            continue;
          }
        }
        // likes count
        postData.likesCount = await this.extractLikesCount(this.driver);
        // comments count
        let commentsFound = false;
        retryCount = 0;
        while (!commentsFound && retryCount < 3) {
          for (const selector of this.MODAL_SELECTORS.comments) {
            try {
              const commentsElements = await this.driver.findElements(By.css(selector));
              for (const commentsElement of commentsElements) {
                const commentsText = await commentsElement.getText();
                if (commentsText) {
                  const numbers = commentsText.match(/\d+/g);
                  if (numbers) {
                    postData.commentsCount = this.parseCount(numbers[0]);
                    commentsFound = true;
                    break;
                  }
                }
              }
              if (commentsFound) break;
            } catch (e) {
              continue;
            }
          }
          if (!commentsFound) {
            retryCount++;
            await this.driver.sleep(1000);
          }
        }
        // close the new tab
        try {
          await this.driver.close();
          const handles = await this.driver.getAllWindowHandles();
          await this.driver.switchTo().window(handles[0]);
          await this.driver.sleep(1000);
        } catch (e) {
          console.log(`⚠️ Error closing tab: ${e.message}`);
        }
      } catch (e) {
        console.log(`⚠️ Error processing target reel: ${e.message}`);
        return null;
      }
      posts.push(postData);
      // update profile data
      profileData.posts = posts;
    } catch (e) {
      console.log(`❌ Error in specific post extraction: ${e.message}`);
    }
    return profileData;
  }

  async extractPostData(profileData) {
    // Extract data from top 5 posts of a profile
    const posts = [];
    try {
      console.log("🎬 Switching to reels tab...");
      try {
        const reelsTabs = await this.driver.findElements(By.css('a[href*="/reels/"]'));
        if (reelsTabs.length > 0) {
          await this.driver.executeScript("arguments[0].scrollIntoView({block: 'center'});", reelsTabs[0]);
          await this.driver.sleep(500);
          try {
            await reelsTabs[0].click();
          } catch (e) {
            console.log('⚠️ Click intercepted, retrying after 1s...');
            await this.driver.sleep(1000);
            await reelsTabs[0].click();
          }
          await this.driver.sleep(3000);
          console.log("✅ Switched to reels tab");
        } else {
          console.log("⚠️ Could not find reels tab");
          return profileData;
        }
        console.log("🔍 Looking for reels...");
        await this.driver.wait(until.elementLocated(By.css('a[href*="/reel/"]')), 5000);
      } catch (e) {
        console.log(`⚠️ Error switching to reels tab: ${e.message}`);
      }
      // Get page content for debugging
      const pageContent = await this.driver.getPageSource();
      let postElements = [];
      for (const selector of this.POST_SELECTORS) {
        try {
          const elements = await this.driver.findElements(By.css(selector));
          if (elements && elements.length > 0) {
            console.log(`✅ Found ${elements.length} post elements using selector: ${selector}`);
            // Debug first post element
            const firstPost = elements[0];
            const href = await firstPost.getAttribute('href');
            console.log(`🔗 First post href: ${href}`);
            postElements = elements;
            break;
          } else {
            console.log(`⚠️ No posts found with selector: ${selector}`);
          }
        } catch (e) {
          console.log(`⚠️ Error trying selector '${selector}': ${e.message}`);
          continue;
        }
      }
      // Check if we found any posts
      if (!postElements || postElements.length === 0) {
        console.log("⚠️ No post elements found using any selector");
        return profileData;
      }
      // Enhanced grid-based sorting
      console.log("📊 Analyzing post grid layout...");
      const gridPosts = [];
      for (const postElement of postElements) {
        try {
          // Selenium does not have boundingBox, so skip grid sorting or use order as-is
          const href = await postElement.getAttribute('href');
          if (href && (href.includes('/p/') || href.includes('/reel/'))) {
            gridPosts.push({
              element: postElement,
              href: href
            });
          }
        } catch (e) {
          console.log(`⚠️ Error processing grid item: ${e.message}`);
          continue;
        }
      }
      // Use order as-is (Selenium cannot get x/y positions easily)
      const sortedElements = gridPosts.map(post => post.element);
      // Change number of posts to scrape here
      for (let i = 0; i < Math.min(sortedElements.length, 3); i++) {
        const postElement = sortedElements[i];
        const postData = {
          type: "reel",
          caption: "",
          ownerFullName: profileData.name || '',
          ownerUsername: profileData.username || '',
          url: "",
          commentsCount: 0,
          likesCount: 0,
          viewCount: 0,
          timestamp: "",
          sharesCount: ""
        };
        try {
          console.log("🔍 Extracting view count from grid...");
          const gridViews = await this.extractGridViewCount(postElement);
          if (gridViews > 0) {
            postData.viewCount = gridViews;
            console.log(`✅ Found grid view count: ${gridViews}`);
          } else {
            console.log("⚠️ No view count found in grid");
          }
          // post URL
          const postUrl = await postElement.getAttribute('href');
          if (!postUrl) {
            console.log("⚠️ Could not extract post URL");
            continue;
          }
          if (postUrl.startsWith('http')) {
            postData.url = postUrl;
          } else {
            postData.url = `https://www.instagram.com${postUrl}`;
          }
          console.log(`🔗 Processing post ${i + 1}/3: ${postData.url}`);
          // Open post in new tab
          await this.driver.executeScript('window.open(arguments[0], "_blank");', postData.url);
          const handles = await this.driver.getAllWindowHandles();
          const newTab = handles[handles.length - 1];
          await this.driver.switchTo().window(newTab);
          await this.driver.sleep(2000);
          // Expand truncated content
          await this.driver.executeScript(this.EXPAND_CONTENT_JS);
          await this.driver.sleep(2000);
          // Extract caption with retries
          let captionFound = false;
          let retryCount = 0;
          while (!captionFound && retryCount < 3) {
            for (const selector of this.MODAL_SELECTORS.caption) {
              try {
                const captionElements = await this.driver.findElements(By.css(selector));
                for (const captionElement of captionElements) {
                  const captionText = await captionElement.getText();
                  if (captionText) {
                    // Clean up caption
                    let cleanCaption = captionText;
                    if (captionText.includes(':') && !captionText.startsWith('http')) {
                      cleanCaption = captionText.split(':').slice(1).join(':').trim();
                    }
                    cleanCaption = cleanCaption.replace('... more', '').trim();
                    postData.caption = cleanCaption;
                    console.log(`📝 Found caption: ${cleanCaption.substring(0, 100)}...`);
                    captionFound = true;
                    break;
                  }
                }
                if (captionFound) break;
              } catch (e) {
                continue;
              }
            }
            if (!captionFound) {
              retryCount++;
              await this.driver.sleep(1000);
            }
          }
          // timestamp
          for (const selector of this.MODAL_SELECTORS.date) {
            try {
              const dateElements = await this.driver.findElements(By.css(selector));
              for (const dateElement of dateElements) {
                const timestamp = await dateElement.getAttribute('datetime');
                if (timestamp) {
                  postData.timestamp = timestamp;
                  console.log(`📅 Found timestamp: ${timestamp}`);
                  break;
                }
              }
              if (postData.timestamp) break;
            } catch (e) {
              continue;
            }
          }
          // likes count
          postData.likesCount = await this.extractLikesCount(this.driver);
          // comments count
          retryCount = 0;
          while (postData.commentsCount === 0 && retryCount < 3) {
            for (const selector of this.MODAL_SELECTORS.comments) {
              try {
                const commentsElements = await this.driver.findElements(By.css(selector));
                for (const commentsElement of commentsElements) {
                  const commentsText = await commentsElement.getText();
                  if (commentsText) {
                    if (commentsText.toLowerCase().includes('view all')) {
                      const match = commentsText.toLowerCase().match(/view all (\d+)/);
                      if (match) {
                        postData.commentsCount = this.parseCount(match[1]);
                      }
                    } else {
                      const numbers = commentsText.match(/\d+/g);
                      if (numbers) {
                        postData.commentsCount = this.parseCount(numbers[0]);
                      }
                    }
                    if (postData.commentsCount > 0) {
                      console.log(`💬 Found ${postData.commentsCount} comments`);
                      break;
                    }
                  }
                }
                if (postData.commentsCount > 0) break;
              } catch (e) {
                continue;
              }
            }
            if (postData.commentsCount === 0) {
              retryCount++;
              await this.driver.sleep(1000);
            }
          }
          posts.push(postData);
          console.log(`✅ Successfully extracted post ${i + 1}/3`);
          // close the new tab
          try {
            await this.driver.close();
            const handles = await this.driver.getAllWindowHandles();
            await this.driver.switchTo().window(handles[0]);
            await this.driver.sleep(1000);
          } catch (e) {
            console.log(`⚠️ Error closing tab: ${e.message}`);
          }
        } catch (e) {
          console.log(`⚠️ Error processing post: ${e.message}`);
          continue;
        }
      }
      // update profile data
      profileData.posts = posts;
      console.log(`✅ Successfully extracted ${posts.length} posts`);
    } catch (e) {
      console.log(`❌ Error in post extraction: ${e.message}`);
    }
    return profileData;
  }

  async scrapeFromSheet() {
    // profile URLs and post links from Google Sheet and scrape them
    try {
      // Dismiss the 'Save your login info?' popup if present
      await this.dismissSaveLoginInfoPopup();
      // Get all records
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: this.sheetName,
      });
      const rows = res.data.values;
      if (!rows || rows.length < 2) {
        console.log('❌ No data found in sheet');
        return;
      }
      const headers = rows[0];
      const data = rows.slice(1);
      let usernameColIdx = headers.indexOf('username');
      let postLinkColIdx = headers.indexOf('post_link');
      if (usernameColIdx === -1 || postLinkColIdx === -1) {
        console.log('❌ Required columns "username" or "post_link" not found in sheet');
        console.log(`Available columns: ${headers}`);
        return;
      }
      const results = [];
      for (let i = 0; i < data.length; i++) {
        const username = data[i][usernameColIdx];
        const postLink = data[i][postLinkColIdx];
        if (!username || !postLink) continue;
        const reelsUrl = `https://www.instagram.com/${username}/reels/`;
        console.log(`\n[${i + 1}/${data.length}] Processing: ${reelsUrl} for post: ${postLink}`);
        const postData = await this.scrapeSpecificReelFromReelsTab(reelsUrl, postLink);
        if (postData) {
          const profileData = {
            username: username,
            platform: 'Instagram',
            fetched: 'Yes',
            ...postData // Merge postData fields into the result
          };
          results.push(profileData);
        } else {
          // Add a result with fetched: 'No' and default values
          const failUrl = `${reelsUrl}${postLink.split('/reel/')[1] ? 'reel/' + postLink.split('/reel/')[1].replace(/\/$/, '') + '/' : ''}`;
          results.push({
            username: username,
            platform: 'Instagram',
            fetched: 'No',
            url: failUrl,
            caption: 'nan',
            likesCount: 0,
            commentsCount: 0,
            viewCount: 0,
            timestamp: 'nan'
          });
        }
        if (i < data.length - 1) {
          const delay = 5;
          console.log(`⏳ Waiting ${delay} seconds before next username...`);
          await this.driver.sleep(delay * 1000);
        }
      }
      console.log(`\n✅ Scraping complete!`);
      // Print the results as JSON
      console.log('\n===== JSON OUTPUT =====');
      console.log(JSON.stringify(results, null, 2));
      console.log('=======================\n');
    } catch (e) {
      console.log(`❌ Error reading from sheet: ${e.message}`);
    }
  }

  async scrapeFromExcel(excelFilePath) {
    // Read Excel file and scrape all profiles
    try {
      // Note: For Excel reading, you'll need to install 'xlsx' package
      // npm install xlsx
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(excelFilePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      console.log(`📊 Found ${data.length} profiles to scrape`);
      const urlColumns = ['url', 'link', 'profile_url', 'instagram_url'];
      let urlColumn = null;
      for (const col of urlColumns) {
        if (data.length > 0 && col in data[0]) {
          urlColumn = col;
          break;
        }
      }
      if (!urlColumn) {
        console.log("❌ Could not find URL column in Excel file");
        console.log(`Available columns: ${Object.keys(data[0] || {})}`);
        return;
      }
      const profileUrls = data.map(row => row[urlColumn]).filter(url => url);
      console.log(`🎯 Starting to scrape ${profileUrls.length} profiles...`);
      for (let i = 0; i < profileUrls.length; i++) {
        const url = profileUrls[i];
        console.log(`\n[${i + 1}/${profileUrls.length}] Processing: ${url}`);
        const profileData = await this.scrapeProfile(url);
        if (profileData) {
          this.scrapedData.push(profileData);
        }
        // Add delay between requests to avoid rate limiting
        if (i < profileUrls.length - 1) {
          const delay = 5;  // 5 seconds delay
          console.log(`⏳ Waiting ${delay} seconds before next profile...`);
          await this.driver.sleep(delay * 1000);
        }
      }
      console.log(`\n✅ Scraping complete! Successfully scraped ${this.scrapedData.length} profiles`);
    } catch (e) {
      console.log(`❌ Error reading Excel file: ${e.message}`);
    }
  }

  saveResults() {
    // Print scraping summary
    try {
      if (!this.scrapedData || this.scrapedData.length === 0) {
        console.log("❌ No data to save");
        return;
      }
      console.log(`\n📊 Scraping Summary:`);
      console.log(`Total profiles scraped: ${this.scrapedData.length}`);
      console.log(`Profiles with followers data: ${this.scrapedData.filter(item => item.followers).length}`);
      console.log(`Profiles with fetched reels: ${this.scrapedData.filter(item => item.fetched === 'Yes').length}`);
    } catch (e) {
      console.log(`❌ Error saving results: ${e.message}`);
    }
  }

  async cleanup() {
    // Close browser but keep session data
    if (this.driver) {
      await this.driver.quit();
    }
    console.log("🧹 Cleanup complete - Session data preserved");
  }

  parseCount(text) {
    // Parse number from Instagram text that contains numbers
    if (!text) {
      return 0;
    }
    text = String(text).trim().toLowerCase();
    try {
      // numbers in the text
      const numbers = text.match(/\d+(?:,\d+)*(?:\.\d+)?/g);
      if (!numbers) {
        return 0;
      }
      // first number found and remove commas
      const numberStr = numbers[0].replace(/,/g, '');
      // where the number appears in the text
      const numberPos = text.indexOf(numberStr);
      if (numberPos === -1) {
        return parseInt(parseFloat(numberStr));
      }
      // text after the number
      const textAfterNumber = text.substring(numberPos + numberStr.length).trim();
      const baseNumber = parseFloat(numberStr);
      // K/M/B suffixes
      if (textAfterNumber.startsWith('k')) {
        return parseInt(baseNumber * 1000);
      } else if (textAfterNumber.startsWith('m')) {
        return parseInt(baseNumber * 1000000);
      } else if (textAfterNumber.startsWith('b')) {
        return parseInt(baseNumber * 1000000000);
      }
      // No suffix or suffix is something else (like "likes")
      return parseInt(baseNumber);
    } catch (e) {
      console.log(`⚠️ Error parsing count from '${text}': ${e.message}`);
      return 0;
    }
  }

  isStatsText(text) {
    // Check if text is stats-related (posts, followers, following counts)
    if (!text) {
      return false;
    }
    text = text.trim().toLowerCase();
    // stats keywords
    const statsKeywords = ['posts', 'followers', 'following', 'followed by'];
    if (statsKeywords.some(keyword => text.includes(keyword))) {
      return true;
    }
    // numbers with K, M, B suffixes
    if (/^[\d,.]+(k|m|b)?$/.test(text.replace(/\s/g, ''))) {
      return true;
    }
    return false;
  }

  async extractLikesCount(driver) {
    // likes count with proper selectors for mobile Instagram
    let likesCount = 0;
    try {
      // Wait for the section containing likes
      await driver.wait(until.elementLocated(By.css('section')), 10000);
      await driver.sleep(3000);
      // visible likes count
      const visibleLikesSelectors = [
        'section > div:nth-child(2) > div > div > span',  // Most common location
        'section > div > div > span',   // Contains "likes" text
        'section span',                // Generic likes text
        'section div > span',          // Nested likes text
      ];
      for (const selector of visibleLikesSelectors) {
        try {
          const likesElements = await driver.findElements(By.css(selector));
          for (const likesElement of likesElements) {
            const likesText = await likesElement.getText();
            if (likesText && likesText.toLowerCase().includes('likes')) {
              likesCount = this.parseCount(likesText);
              if (likesCount > 0) {
                console.log(`✅ Found visible likes: ${likesText} = ${likesCount}`);
                return likesCount;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      // "Liked by X and others" format
      const likedBySelectors = [
        'section span',
        'section div',
      ];
      for (const selector of likedBySelectors) {
        try {
          const likedElements = await driver.findElements(By.css(selector));
          for (const likedElement of likedElements) {
            const likedText = await likedElement.getText();
            if (likedText && likedText.toLowerCase().includes('liked by')) {
              // from "Liked by username and X others"
              const match = likedText.toLowerCase().match(/and\s+(\d+(?:,\d+)*)\s+others?/);
              if (match) {
                const othersCount = parseInt(match[1].replace(/,/g, ''));
                likesCount = othersCount + 1;  // +1 for the named user
                console.log(`✅ Found 'liked by' format: ${likedText} = ${likesCount}`);
                return likesCount;
              } else {
                // "Liked by username and others" without count
                console.log(`⚠️ Hidden likes detected: ${likedText}`);
                return 0;  // Hidden likes count
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      // Fallback - look for any element with numbers near the heart button
      try {
        // Get all spans in the section
        const allSpans = await driver.findElements(By.css('section span'));
        for (const span of allSpans) {
          const spanText = await span.getText();
          if (spanText && /\d+.*likes?/i.test(spanText)) {
            likesCount = this.parseCount(spanText);
            if (likesCount > 0) {
              console.log(`✅ Found likes via fallback: ${spanText} = ${likesCount}`);
              return likesCount;
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ Fallback method failed: ${e.message}`);
      }
      console.log("⚠️ No likes count found - may be hidden");
      return 0;
    } catch (e) {
      console.log(`❌ Error extracting likes: ${e.message}`);
      return 0;
    }
  }

  async extractGridViewCount(element) {
    // Extract view count from a reel in the grid view using JS
    try {
      // Use JS to find a span with a number and "view"/"views"/"K"/"M"
      const jsResult = await element.getDriver().executeScript(function(el) {
        // Look for all spans inside the element
        const spans = el.querySelectorAll('span');
        const allTexts = [];
        for (const span of spans) {
          const text = span.textContent.trim();
          allTexts.push(text);
          if (
            text &&
            ( /\d/.test(text) &&
              (text.toLowerCase().includes('view') ||
               text.toLowerCase().includes('k') ||
               text.toLowerCase().includes('m'))
            )
          ) {
            return { found: text, all: allTexts };
          }
        }
        return { found: null, all: allTexts };
      }, element);

      if (jsResult) {
        if (jsResult.all) {
          console.log('🔍 All span texts in grid:', jsResult.all);
        }
        if (jsResult.found) {
          const count = this.parseCount(jsResult.found);
          if (count > 0) {
            return count;
          }
        }
      }
      return 0;
    } catch (e) {
      console.log(`❌ Error extracting grid view count: ${e.message}`);
      return 0;
    }
  }

  async scrapeReelsTab(reelsUrl) {
    // Directly scrape all reels from a /reels/ URL
    try {
      console.log(`🔄 Scraping reels tab: ${reelsUrl}`);
      await this.driver.get(reelsUrl);
      await this.driver.sleep(3000);
      // Find all reel elements
      let postElements = [];
      for (const selector of this.POST_SELECTORS) {
        try {
          const elements = await this.driver.findElements(By.css(selector));
          if (elements && elements.length > 0) {
            postElements = postElements.concat(elements);
            console.log(`✅ Found ${elements.length} post elements using selector: ${selector}`);
          }
        } catch (e) {
          console.log(`⚠️ Error trying selector '${selector}': ${e.message}`);
          continue;
        }
      }
      if (!postElements.length) {
        console.log("⚠️ No post elements found using any selector");
        return [];
      }
      // For each reel, extract data
      const reelsData = [];
      for (let i = 0; i < postElements.length; i++) {
        const postElement = postElements[i];
        const postData = {
          url: '',
          caption: '',
          likesCount: 0,
          commentsCount: 0,
          viewCount: 0,
          timestamp: '',
        };
        try {
          // post URL
          const postUrl = await postElement.getAttribute('href');
          if (!postUrl) continue;
          postData.url = postUrl.startsWith('http') ? postUrl : `https://www.instagram.com${postUrl}`;
          // Open post in new tab
          await this.driver.executeScript('window.open(arguments[0], "_blank");', postData.url);
          const handles = await this.driver.getAllWindowHandles();
          const newTab = handles[handles.length - 1];
          await this.driver.switchTo().window(newTab);
          await this.driver.sleep(2000);
          // Expand truncated content
          await this.driver.executeScript(this.EXPAND_CONTENT_JS);
          await this.driver.sleep(2000);
          // Caption
          let captionFound = false;
          let retryCount = 0;
          while (!captionFound && retryCount < 3) {
            for (const selector of this.MODAL_SELECTORS.caption) {
              try {
                const captionElements = await this.driver.findElements(By.css(selector));
                for (const captionElement of captionElements) {
                  const captionText = await captionElement.getText();
                  if (captionText) {
                    let cleanCaption = captionText;
                    if (captionText.includes(':') && !captionText.startsWith('http')) {
                      cleanCaption = captionText.split(':').slice(1).join(':').trim();
                    }
                    cleanCaption = cleanCaption.replace('... more', '').trim();
                    postData.caption = cleanCaption;
                    captionFound = true;
                    break;
                  }
                }
                if (captionFound) break;
              } catch (e) {
                continue;
              }
            }
            if (!captionFound) {
              retryCount++;
              await this.driver.sleep(1000);
            }
          }
          // timestamp
          for (const selector of this.MODAL_SELECTORS.date) {
            try {
              const dateElements = await this.driver.findElements(By.css(selector));
              for (const dateElement of dateElements) {
                const timestamp = await dateElement.getAttribute('datetime');
                if (timestamp) {
                  postData.timestamp = timestamp;
                  break;
                }
              }
              if (postData.timestamp) break;
            } catch (e) {
              continue;
            }
          }
          // likes count
          postData.likesCount = await this.extractLikesCount(this.driver);
          // comments count
          let commentsFound = false;
          retryCount = 0;
          while (!commentsFound && retryCount < 3) {
            for (const selector of this.MODAL_SELECTORS.comments) {
              try {
                const commentsElements = await this.driver.findElements(By.css(selector));
                for (const commentsElement of commentsElements) {
                  const commentsText = await commentsElement.getText();
                  if (commentsText) {
                    const numbers = commentsText.match(/\d+/g);
                    if (numbers) {
                      postData.commentsCount = this.parseCount(numbers[0]);
                      commentsFound = true;
                      break;
                    }
                  }
                }
                if (commentsFound) break;
              } catch (e) {
                continue;
              }
            }
            if (!commentsFound) {
              retryCount++;
              await this.driver.sleep(1000);
            }
          }
          // view count from grid
          postData.viewCount = await this.extractGridViewCount(postElement);
          reelsData.push(postData);
          // close the new tab
          try {
            await this.driver.close();
            const handles = await this.driver.getAllWindowHandles();
            await this.driver.switchTo().window(handles[0]);
            await this.driver.sleep(1000);
          } catch (e) {
            console.log(`⚠️ Error closing tab: ${e.message}`);
          }
        } catch (e) {
          console.log(`⚠️ Error processing reel: ${e.message}`);
          continue;
        }
      }
      return reelsData;
    } catch (e) {
      console.log(`❌ Error scraping reels tab: ${e.message}`);
      return [];
    }
  }

  async scrapeSpecificReelFromReelsTab(reelsUrl, postLink) {
    // Open reels tab, find the reel matching postLink, and scrape its data
    try {
      console.log(`🔄 Scraping specific reel from: ${reelsUrl} for post: ${postLink}`);
      await this.driver.get(reelsUrl);
      await this.driver.sleep(3000);
      // Extract reel ID from postLink
      let targetReelId = null;
      const reelPatterns = [
        /\/reel\/([^/?]+)/,
        /reel\/([^/?]+)/,
        /instagram\\.com\/reel\/([^/?]+)/,
        /\/p\/([^/?]+)/,
        /p\/([^/?]+)/,
        /instagram\\.com\/p\/([^/?]+)/
      ];
      for (const pattern of reelPatterns) {
        const match = postLink.match(pattern);
        if (match) {
          targetReelId = match[1];
          break;
        }
      }
      if (!targetReelId) {
        console.log("❌ Could not extract reel/post ID from postLink");
        return null;
      }
      // Find all reel elements
      let postElements = [];
      for (const selector of this.POST_SELECTORS) {
        try {
          const elements = await this.driver.findElements(By.css(selector));
          if (elements && elements.length > 0) {
            postElements = postElements.concat(elements);
          }
        } catch (e) {
          continue;
        }
      }
      if (!postElements.length) {
        console.log("⚠️ No post elements found using any selector");
        return null;
      }
      // Find the element matching the target reel ID, with scrolling if not found
      let targetElement = null;
      const maxScrolls = 3;
      for (let scrollAttempt = 0; scrollAttempt < maxScrolls && !targetElement; scrollAttempt++) {
        for (const postElement of postElements) {
          try {
            const href = await postElement.getAttribute('href');
            if (href && href.includes(targetReelId)) {
              targetElement = postElement;
              break;
            }
          } catch (e) {
            continue;
          }
        }
        if (!targetElement && scrollAttempt < maxScrolls - 1) {
          // Scroll down and wait for more reels to load
          await this.driver.executeScript('window.scrollBy(0, 1000);');
          await this.driver.sleep(2000);
          // Re-fetch post elements after scroll
          postElements = [];
          for (const selector of this.POST_SELECTORS) {
            try {
              const elements = await this.driver.findElements(By.css(selector));
              if (elements && elements.length > 0) {
                postElements = postElements.concat(elements);
              }
            } catch (e) {
              continue;
            }
          }
        }
      }
      if (!targetElement) {
        console.log(`❌ Target reel ${targetReelId} not found in reels tab after scrolling`);
        return null;
      }
      // Scrape the reel data (extract view count from grid, then open in new tab for rest)
      const postData = {
        url: '',
        caption: '',
        likesCount: 0,
        commentsCount: 0,
        viewCount: 0,
        timestamp: '',
      };
      try {
        // 1. Extract view count from grid element BEFORE opening the post
        postData.viewCount = await this.extractGridViewCount(targetElement);
        // 2. Now open the post in new tab and extract the rest
        const postUrl = await targetElement.getAttribute('href');
        if (!postUrl) return null;
        postData.url = postUrl.startsWith('http') ? postUrl : `https://www.instagram.com${postUrl}`;
        await this.driver.executeScript('window.open(arguments[0], "_blank");', postData.url);
        const handles = await this.driver.getAllWindowHandles();
        const newTab = handles[handles.length - 1];
        await this.driver.switchTo().window(newTab);
        await this.driver.sleep(2000);
        await this.driver.executeScript(this.EXPAND_CONTENT_JS);
        await this.driver.sleep(2000);
        // Caption
        let captionFound = false;
        let retryCount = 0;
        while (!captionFound && retryCount < 3) {
          for (const selector of this.MODAL_SELECTORS.caption) {
            try {
              const captionElements = await this.driver.findElements(By.css(selector));
              for (const captionElement of captionElements) {
                const captionText = await captionElement.getText();
                if (captionText) {
                  let cleanCaption = captionText;
                  if (captionText.includes(':') && !captionText.startsWith('http')) {
                    cleanCaption = captionText.split(':').slice(1).join(':').trim();
                  }
                  cleanCaption = cleanCaption.replace('... more', '').trim();
                  postData.caption = cleanCaption;
                  captionFound = true;
                  break;
                }
              }
              if (captionFound) break;
            } catch (e) {
              continue;
            }
          }
          if (!captionFound) {
            retryCount++;
            await this.driver.sleep(1000);
          }
        }
        // timestamp
        for (const selector of this.MODAL_SELECTORS.date) {
          try {
            const dateElements = await this.driver.findElements(By.css(selector));
            for (const dateElement of dateElements) {
              const timestamp = await dateElement.getAttribute('datetime');
              if (timestamp) {
                postData.timestamp = timestamp;
                break;
              }
            }
            if (postData.timestamp) break;
          } catch (e) {
            continue;
          }
        }
        // likes count
        postData.likesCount = await this.extractLikesCount(this.driver);
        // comments count
        let commentsFound = false;
        retryCount = 0;
        while (!commentsFound && retryCount < 3) {
          for (const selector of this.MODAL_SELECTORS.comments) {
            try {
              const commentsElements = await this.driver.findElements(By.css(selector));
              for (const commentsElement of commentsElements) {
                const commentsText = await commentsElement.getText();
                if (commentsText) {
                  const numbers = commentsText.match(/\d+/g);
                  if (numbers) {
                    postData.commentsCount = this.parseCount(numbers[0]);
                    commentsFound = true;
                    break;
                  }
                }
              }
              if (commentsFound) break;
            } catch (e) {
              continue;
            }
          }
          if (!commentsFound) {
            retryCount++;
            await this.driver.sleep(1000);
          }
        }
        // close the new tab
        try {
          await this.driver.close();
          const handles = await this.driver.getAllWindowHandles();
          await this.driver.switchTo().window(handles[0]);
          await this.driver.sleep(1000);
        } catch (e) {
          console.log(`⚠️ Error closing tab: ${e.message}`);
        }
      } catch (e) {
        console.log(`⚠️ Error processing target reel: ${e.message}`);
        return null;
      }
      return postData;
    } catch (e) {
      console.log(`❌ Error scraping specific reel from reels tab: ${e.message}`);
      return null;
    }
  }

  async dismissSaveLoginInfoPopup() {
    try {
      await this.driver.sleep(2000);

      // 1. Try <button> with text
      const buttons = await this.driver.findElements(By.xpath(
        "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'not now')]"
      ));
      if (buttons.length > 0) {
        await buttons[0].click();
        console.log('✅ Dismissed "Save your login info?" popup (button selector)');
        await this.driver.sleep(1000);
        return;
      }

      // 2. Try <span> with text
      const notNowSpans = await this.driver.findElements(By.xpath(
        "//span[text()='Not now' or text()='NOT NOW' or text()='Not Now' or text()='not now']"
      ));
      if (notNowSpans.length > 0) {
        await notNowSpans[0].click();
        console.log('✅ Dismissed "Save your login info?" popup (span selector)');
        await this.driver.sleep(1000);
        return;
      }

      // 3. Fallback: any button with 'not now' in text
      const fallbackButtons = await this.driver.findElements(By.css('button'));
      for (const btn of fallbackButtons) {
        const text = (await btn.getText()).toLowerCase();
        if (text.includes('not now')) {
          await btn.click();
          console.log('✅ Dismissed "Save your login info?" popup (fallback)');
          await this.driver.sleep(1000);
          break;
        }
      }
    } catch (e) {
      // Ignore errors if popup is not present
    }
  }
}

async function main() {
  const scraper = new InstagramScraper();
  try {
    console.log("📊 Connecting to Google Sheets...");
    await scraper.setupGoogleSheets(); // Setup Google Sheets connection first

    console.log("🌐 Setting up browser...");
    await scraper.setupBrowser();

    console.log("🔑 Checking Instagram login...");
    const loginSuccess = await scraper.loginInstagram();

    if (!loginSuccess) {
      console.log("❌ Login failed. Exiting...");
      return;
    }

    // profiles from Google Sheet
    console.log("🔄 Starting scraping process...");
    await scraper.scrapeFromSheet();

    console.log(`\n✅ Scraping complete!`);
  } catch (e) {
    console.log(`❌ Main execution error: ${e.message}`);
  } finally {
    // cleanup but preserve session
    await scraper.cleanup();
    process.exit(0);
  }
}

if (require.main === module) {
  console.log("🚀 Instagram Mobile Scraper Starting...");
  console.log("=".repeat(50));
  main();
}
