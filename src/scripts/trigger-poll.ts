import { Queue } from 'bullmq';
import { getRedisConfig } from '../shared/config/redis.js';

const main = async () => {
  const cfg = getRedisConfig();
  const queue = new Queue('instagram-poll', {
    connection: { host: cfg.host, port: cfg.port },
  });
  await queue.add('manual-poll', {});
  console.log('Manual poll job added');
  await queue.close();
  process.exit(0);
};

main();
