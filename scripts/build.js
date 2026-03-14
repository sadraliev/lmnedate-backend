import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

// Clean old tsc artifacts before building
for (const dir of ['apps/bot/dist', 'apps/workers/dist', 'apps/scraper/dist']) {
  rmSync(dir, { recursive: true, force: true });
}

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['@app/source'],
  sourcemap: true,
  logLevel: 'info',
  // Some deps (dotenv, etc.) use require() internally.
  // In ESM output, require() is not defined — inject a shim via createRequire.
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
  },
};

// Bot
await build({
  ...shared,
  entryPoints: ['apps/bot/src/bot.ts'],
  outfile: 'apps/bot/dist/bot.js',
});

// Workers
await build({
  ...shared,
  entryPoints: ['apps/workers/src/main.ts'],
  outfile: 'apps/workers/dist/main.js',
});

// Scraper — playwright is external (native binaries + complex internal resolution)
await build({
  ...shared,
  entryPoints: ['apps/scraper/src/worker.ts'],
  outfile: 'apps/scraper/dist/worker.js',
  external: ['playwright'],
});

// Generate deploy-package.json with only playwright dependency
const scraperPkg = JSON.parse(readFileSync('apps/scraper/package.json', 'utf8'));
const playwrightVersion = scraperPkg.dependencies.playwright;

writeFileSync(
  'deploy-package.json',
  JSON.stringify(
    {
      name: 'instagram-scraper-deploy',
      private: true,
      type: 'module',
      dependencies: {
        playwright: playwrightVersion,
      },
    },
    null,
    2,
  ) + '\n',
);

console.log('Build complete. deploy-package.json generated.');
