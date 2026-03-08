import { chromium, type Browser, type BrowserContext } from 'playwright';
import { logger } from '../../config/logger.js';
import type { InstagramPost } from '../telegram/telegram.types.js';
import { extractPosts, extractPostsFromHtml } from './instagram.parser.js';

let browser: Browser | null = null;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get or create a shared browser instance
 */
const getBrowser = async (): Promise<Browser> => {
  if (browser && browser.isConnected()) {
    return browser;
  }
  browser = await chromium.launch({ headless: true });
  return browser;
};

/**
 * Close the shared browser instance
 */
export const closeBrowser = async (): Promise<void> => {
  if (browser) {
    await browser.close();
    browser = null;
  }
};

/**
 * Fetch recent posts from a public Instagram profile using Playwright
 */
export const fetchRecentPosts = async (
  username: string
): Promise<Omit<InstagramPost, '_id'>[]> => {
  let context: BrowserContext | null = null;

  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });

    const page = await context.newPage();

    // Intercept XHR responses that contain post data
    const posts: Omit<InstagramPost, '_id'>[] = [];

    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/graphql/query') && !url.includes('/api/v1/')) return;

      try {
        const json = await response.json();
        extractPosts(json, username, posts);
      } catch {
        // Not JSON or parse error — ignore
      }
    });

    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // If we didn't get posts from XHR, try to extract from page content
    if (posts.length === 0) {
      const pageContent = await page.content();
      extractPostsFromHtml(pageContent, username, posts);
    }

    // Scroll down once to trigger lazy-loaded posts
    if (posts.length === 0) {
      await page.evaluate('window.scrollBy(0, 1000)');
      await sleep(3000);
    }

    logger.info({ username, count: posts.length }, 'Fetched Instagram posts via Playwright');
    return posts.slice(0, 12);
  } catch (error) {
    logger.error({ username, error }, 'Failed to fetch Instagram posts');
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
  }
};

/**
 * Fetch posts for multiple accounts with spacing between requests
 */
export const fetchMultipleAccounts = async (
  usernames: string[]
): Promise<Map<string, Omit<InstagramPost, '_id'>[]>> => {
  const results = new Map<string, Omit<InstagramPost, '_id'>[]>();

  for (const username of usernames) {
    try {
      const posts = await fetchRecentPosts(username);
      results.set(username, posts);
    } catch {
      results.set(username, []);
    }

    // Space out requests
    if (usernames.indexOf(username) < usernames.length - 1) {
      await sleep(3000);
    }
  }

  return results;
};
