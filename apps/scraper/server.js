// Browser server — launches Chromium with stealth args and exposes WebSocket endpoint.
// Used by scraper app via chromium.connect(wsEndpoint).

const { chromium } = require('playwright');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

(async () => {
  const server = await chromium.launchServer({
    headless: true,
    host: HOST,
    port: PORT,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--enable-unsafe-swiftshader',
    ],
  });

  console.log(`Browser server listening on ${server.wsEndpoint()}`);

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      console.log(`${sig} received, shutting down browser server`);
      await server.close();
      process.exit(0);
    });
  }
})();
