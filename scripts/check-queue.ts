import 'dotenv/config';
import { Queue } from 'bullmq';
import { parseRedisUrl } from '../packages/shared/src/redis.js';

const rc = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
const q = new Queue('instagram-deliver', { connection: { host: rc.host, port: rc.port } });

async function main() {
  const waiting = await q.getWaiting();
  const active = await q.getActive();
  const delayed = await q.getDelayed();
  const failed = await q.getFailed();
  const completed = await q.getCompleted();
  console.log('waiting:', waiting.length, waiting.map(j => j.id));
  console.log('active:', active.length, active.map(j => j.id));
  console.log('delayed:', delayed.length, delayed.map(j => j.id));
  console.log('failed:', failed.length, failed.map(j => j.id));
  console.log('completed:', completed.length, completed.map(j => j.id));
  await q.close();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
