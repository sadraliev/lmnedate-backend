/**
 * Centralized ban signal detection for Instagram scraping.
 *
 * Three detection vectors:
 * - URL patterns (redirects to challenge/suspended/consent pages)
 * - HTTP response signals (429, checkpoint_required, spam flags)
 * - DOM signals (CAPTCHA iframes)
 */

import type { Page } from 'playwright';

export type BanSignal = {
  type: 'challenge' | 'suspended' | 'consent' | 'rate_limited' | 'captcha' | 'action_blocked';
  severity: 'critical' | 'high' | 'medium';
  source: 'url' | 'response' | 'dom';
  detail: string;
};

export class BanDetectedError extends Error {
  constructor(public signal: BanSignal) {
    super(`Ban detected: ${signal.type} (${signal.severity}) via ${signal.source} — ${signal.detail}`);
  }
}

/**
 * Check URL after navigation for known ban/challenge redirects.
 */
export const checkUrlBanSignals = (url: string): BanSignal | null => {
  if (url.includes('/challenge/')) {
    return {
      type: 'challenge',
      severity: 'critical',
      source: 'url',
      detail: 'Redirected to challenge page',
    };
  }

  if (url.includes('/accounts/suspended/')) {
    return {
      type: 'suspended',
      severity: 'critical',
      source: 'url',
      detail: 'Account suspended',
    };
  }

  if (url.includes('/accounts/consent/')) {
    return {
      type: 'consent',
      severity: 'medium',
      source: 'url',
      detail: 'Consent wall — manual action required',
    };
  }

  return null;
};

/**
 * Check HTTP response status and body for ban signals.
 */
export const checkResponseBanSignals = (status: number, body: unknown): BanSignal | null => {
  if (status === 429) {
    return {
      type: 'rate_limited',
      severity: 'high',
      source: 'response',
      detail: 'HTTP 429 Too Many Requests',
    };
  }

  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>;

    if (status === 403 && JSON.stringify(body).includes('checkpoint_required')) {
      return {
        type: 'challenge',
        severity: 'critical',
        source: 'response',
        detail: 'HTTP 403 with checkpoint_required',
      };
    }

    if (obj.spam === true || obj.action_blocked === true) {
      return {
        type: 'action_blocked',
        severity: 'critical',
        source: 'response',
        detail: `Action blocked (spam=${obj.spam}, action_blocked=${obj.action_blocked})`,
      };
    }
  }

  return null;
};

/**
 * Check page DOM for CAPTCHA iframes.
 */
export const checkDomBanSignals = async (page: Page): Promise<BanSignal | null> => {
  const hasCaptcha = await page
    .locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')
    .first()
    .isVisible({ timeout: 0 })
    .catch(() => false);

  if (hasCaptcha) {
    return {
      type: 'captcha',
      severity: 'critical',
      source: 'dom',
      detail: 'CAPTCHA iframe detected on page',
    };
  }

  return null;
};
