import 'dotenv/config';
import { Queue } from 'bullmq';
import { parseRedisUrl } from '../packages/shared/src/redis.js';

const main = async () => {
  const cfg = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6381');
  const queue = new Queue('instagram-poll', {
    connection: { host: cfg.host, port: cfg.port },
  });
  await queue.add('manual-poll', {});
  console.log('Manual poll job added');
  await queue.close();
  process.exit(0);
};

main();
