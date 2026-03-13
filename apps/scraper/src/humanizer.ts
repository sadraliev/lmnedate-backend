/**
 * Human-like delay utilities to avoid bot detection.
 */

import type { Locator, Page } from 'playwright';

/** Random int between min and max (inclusive) */
const randomBetween = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** Random delay between min and max ms */
export const humanDelay = (minMs: number, maxMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, randomBetween(minMs, maxMs)));

/** Type text character-by-character with random per-key delay (80-200ms) */
export const humanType = async (locator: Locator, text: string): Promise<void> => {
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: randomBetween(80, 200) });
};

/** Scroll in 2-4 small increments (200-500px each) with pauses */
export const humanScroll = async (page: Page): Promise<void> => {
  const steps = randomBetween(2, 4);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, randomBetween(200, 500));
    await humanDelay(500, 1500);
  }
};
