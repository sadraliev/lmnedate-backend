/**
 * Instagram session management: login via Playwright, persist storageState to file.
 */

import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Browser, Page } from 'playwright';
import { FINGERPRINT, EXTRA_HEADERS, applyStealthScripts } from './stealth.js';
import { humanDelay, humanType } from './humanizer.js';
import { createLogger } from '@app/shared';

const logger = createLogger({ name: 'session' });

const SESSION_PATH = process.env.IG_SESSION_PATH ?? 'ig-session.json';
const ADMIN_CHAT_ID = '20471481';

/**
 * Send a screenshot to Telegram admin via Bot API.
 */
const notifyAdmin = async (page: Page, message: string): Promise<void> => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — cannot send notification');
    return;
  }

  try {
    const screenshot = await page.screenshot({ fullPage: true });
    const form = new FormData();
    form.append('chat_id', ADMIN_CHAT_ID);
    form.append('caption', message);
    form.append('photo', new Blob([new Uint8Array(screenshot)], { type: 'image/png' }), 'login-debug.png');

    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to send Telegram notification');
  }
};

/**
 * Load a cached session from file. Returns the file path if valid, or null.
 */
export const loadSession = async (): Promise<string | null> => {
  try {
    const raw = await readFile(SESSION_PATH, 'utf-8');
    JSON.parse(raw); // validate JSON
    return SESSION_PATH;
  } catch {
    return null;
  }
};

/**
 * Login to Instagram via Playwright and save storageState to file.
 */
export const loginWithPlaywright = async (
  browser: Browser,
  username: string,
  password: string,
): Promise<string> => {
  const context = await browser.newContext({
    userAgent: FINGERPRINT.userAgent,
    viewport: FINGERPRINT.viewport,
    locale: FINGERPRINT.locale,
    timezoneId: FINGERPRINT.timezoneId,
    extraHTTPHeaders: EXTRA_HEADERS,
  });
  const page = await context.newPage();
  await applyStealthScripts(page);

  try {
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Accept cookies dialog if present
    const cookieButton = page.locator('button:has-text("Allow all cookies"), button:has-text("Allow essential and optional cookies"), button:has-text("Accept")');
    if (await cookieButton.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cookieButton.first().click();
      await humanDelay(1500, 3000);
    }

    const usernameInput = page.locator('input[name="username"], input[name="email"]').first();
    await usernameInput.waitFor({ timeout: 15_000 });
    await humanType(usernameInput, username);

    const passwordInput = page.locator('input[name="password"], input[name="pass"], input[type="password"]').first();
    await humanType(passwordInput, password);

    const submitButton = page.getByRole('button', { name: 'Log In', exact: true });
    await submitButton.waitFor({ state: 'visible', timeout: 10_000 });
    await submitButton.click();
    await humanDelay(2000, 4000);

    // Wait for navigation away from login page — if it doesn't happen, something is wrong
    const loggedIn = await page.waitForURL(
      (url) => !url.pathname.includes('/accounts/login'),
      { timeout: 30_000 },
    ).then(() => true).catch(() => false);

    if (!loggedIn) {
      await notifyAdmin(page, `Login failed for @${username} — stuck at ${page.url()}`);
      logger.fatal({ username, url: page.url() }, 'Login failed — stopping process');
      process.exit(1);
    }

    // Dismiss "Save login info" or "Turn on notifications" dialogs
    for (const label of ['Not Now', 'Not now']) {
      const btn = page.locator(`button:has-text("${label}")`);
      if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await btn.click();
        await humanDelay(1000, 2000);
      }
    }

    // Save storageState directly to file
    await mkdir(dirname(SESSION_PATH), { recursive: true }).catch(() => {});
    await context.storageState({ path: SESSION_PATH });
    logger.info({ username }, 'Logged in, session saved to file');
    return SESSION_PATH;
  } finally {
    await context.close();
  }
};
