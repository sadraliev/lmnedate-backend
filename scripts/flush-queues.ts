import 'dotenv/config';
import { Queue } from 'bullmq';
import { parseRedisUrl } from '../packages/shared/src/redis.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const rc = parseRedisUrl(REDIS_URL);
const conn = { host: rc.host, port: rc.port };

async function main() {
  const scrapeQ = new Queue('instagram-scrape', { connection: conn });
  const deliverQ = new Queue('instagram-deliver', { connection: conn });

  await scrapeQ.obliterate({ force: true });
  await deliverQ.obliterate({ force: true });

  console.log('Queues flushed');

  await scrapeQ.close();
  await deliverQ.close();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
