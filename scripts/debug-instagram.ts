import { chromium } from 'playwright';

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const xhrUrls: string[] = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('graphql') || url.includes('/api/v1/')) {
      xhrUrls.push(url.substring(0, 120));
      try {
        const json = await response.json();
        const str = JSON.stringify(json);
        if (str.includes('edge_owner') || str.includes('shortcode') || str.includes('media')) {
          console.log('FOUND DATA in:', url.substring(0, 100));
          console.log('Preview:', str.substring(0, 300));
        }
      } catch {
        // not json
      }
    }
  });

  await page.goto('https://www.instagram.com/kaktus__media/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  const title = await page.title();
  const content = await page.content();
  const hasLogin = content.includes('Log in') || content.includes('log in');

  console.log('Title:', title);
  console.log('Has login prompt:', hasLogin);
  console.log('Content length:', content.length);
  console.log('XHR calls captured:', xhrUrls.length);
  for (const u of xhrUrls) {
    console.log('  -', u);
  }

  // Take a screenshot for debugging
  await page.screenshot({ path: '/tmp/instagram-debug.png' });
  console.log('Screenshot saved to /tmp/instagram-debug.png');

  await browser.close();
  process.exit(0);
};

main();
