import 'dotenv/config';
import { Queue } from 'bullmq';
import { parseRedisUrl } from '../shared/config/redis-standalone.js';

const username = process.argv[2] ?? 'bbcnews';
const chatId = parseInt(process.argv[3] ?? '0', 10);

const redisConfig = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6381');
const q = new Queue('instagram-scrape', {
  connection: { host: redisConfig.host, port: redisConfig.port },
});

const job = await q.add('test-scrape', {
  username,
  chatId,
  enqueuedAt: new Date().toISOString(),
}, { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } });

console.log(`Job enqueued: id=${job.id}, username=${username}, chatId=${chatId}`);
await q.close();
process.exit(0);
