/**
 * Visual stealth verification — opens a headed browser on bot.sannysoft.com.
 *
 * Usage:
 *   npx tsx --tsconfig apps/scraper/tsconfig.json scripts/verify-stealth.ts
 *   npx tsx --tsconfig apps/scraper/tsconfig.json scripts/verify-stealth.ts --headless
 *
 * Close the browser window or press Ctrl+C to exit (headed mode).
 */

import { chromium } from 'playwright';
import { FINGERPRINT, EXTRA_HEADERS, applyStealthScripts } from '../apps/scraper/src/stealth.js';

const headless = process.argv.includes('--headless');

const main = async () => {
  const browser = await chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--enable-unsafe-swiftshader',
    ],
  });

  const context = await browser.newContext({
    userAgent: FINGERPRINT.userAgent,
    viewport: FINGERPRINT.viewport,
    locale: FINGERPRINT.locale,
    timezoneId: FINGERPRINT.timezoneId,
    extraHTTPHeaders: EXTRA_HEADERS,
  });

  const page = await context.newPage();
  await applyStealthScripts(page);

  await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle' });

  // Collect results from the page
  const rows = await page.$$eval('table tr', (trs) =>
    trs.map((tr) => {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length < 2) return null;
      const label = cells[0]?.textContent?.trim() ?? '';
      const value = cells[1]?.textContent?.trim() ?? '';
      const cls = cells[1]?.className ?? '';
      const status = cls.includes('failed') ? 'FAIL' : cls.includes('passed') ? 'PASS' : '----';
      return { label, value, status };
    }).filter(Boolean),
  );

  console.log('\n=== bot.sannysoft.com results ===\n');

  const failed: typeof rows = [];
  for (const r of rows) {
    if (!r) continue;
    console.log(`  [${r.status}] ${r.label.padEnd(30)} ${r.value.slice(0, 80)}`);
    if (r.status === 'FAIL') failed.push(r);
  }

  if (failed.length > 0) {
    console.log(`\n--- FAILED (${failed.length}): ---`);
    for (const f of failed) console.log(`  ${f!.label}: ${f!.value}`);
  } else {
    console.log('\nAll checks passed!');
  }
  console.log('');

  if (headless) {
    await context.close();
    await browser.close();
    process.exit(failed.length > 0 ? 1 : 0);
  }

  console.log('Browser is open at bot.sannysoft.com');
  console.log('Close the browser window or press Ctrl+C to exit\n');

  await new Promise<void>((resolve) => {
    browser.on('disconnected', resolve);
  });
};

main();
