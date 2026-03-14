// PM2 ecosystem — manages bot, workers, and scraper as native Node.js processes.
// Browser runs separately in Docker (docker compose up playwright).
//
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 restart all
//   pm2 logs

const { join } = require('node:path');
const { homedir } = require('node:os');

module.exports = {
  apps: [
    {
      name: 'bot',
      cwd: './apps/bot',
      script: 'dist/bot.js',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'workers',
      cwd: './apps/workers',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scraper',
      cwd: './apps/scraper',
      script: 'dist/worker.js',
      env: {
        NODE_ENV: 'production',
        PLAYWRIGHT_WS: 'ws://localhost:3000/ws',
        IG_SESSION_PATH: join(homedir(), '.scraper', 'ig-session.json'),
      },
    },
  ],
};
