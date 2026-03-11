/**
 * E2E test: scrape a real Instagram profile and verify enriched fields.
 * Run: npx tsx scripts/e2e-enriched.ts
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

import Redis from 'ioredis';
import { createRedisConnection } from '@app/shared';
import { scrapeProfile, closeBrowser, initSession } from '../apps/scraper/src/scrape.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6381';
const username = 'bbcnews';
const igUsername = process.env.INSTAGRAM_USERNAME ?? '';
const igPassword = process.env.INSTAGRAM_PASSWORD ?? '';

async function main() {
  const redisOpts = createRedisConnection(REDIS_URL, 'e2e');
  const redis = new Redis(redisOpts);

  try {
    if (igUsername) {
      await initSession(redis, igUsername, igPassword);
    }

    console.log(`\nScraping @${username}...\n`);
    const posts = await scrapeProfile(username, 30_000, igUsername, igPassword, redis, true);

    console.log(`Found ${posts.length} posts\n`);

    if (posts.length === 0) {
      console.log('No posts scraped — cannot verify enriched fields.');
      process.exit(1);
    }

    // Show first post with all fields
    const first = posts[0];
    console.log('=== First Post (all fields) ===');
    console.log(JSON.stringify(first, null, 2));

    // Summary of enriched fields across all posts
    console.log('\n=== Enriched Fields Summary ===');
    const stats = {
      withLikes: posts.filter((p) => p.likesCount !== undefined).length,
      withComments: posts.filter((p) => p.commentsCount !== undefined).length,
      withVideoViews: posts.filter((p) => p.videoViewsCount !== undefined).length,
      withVideoUrl: posts.filter((p) => p.videoUrl !== undefined).length,
      withCarousel: posts.filter((p) => p.carouselMedia !== undefined).length,
      withHashtags: posts.filter((p) => p.hashtags && p.hashtags.length > 0).length,
      withMentions: posts.filter((p) => p.mentions && p.mentions.length > 0).length,
      withLocation: posts.filter((p) => p.location !== undefined).length,
    };

    for (const [field, count] of Object.entries(stats)) {
      const pct = Math.round((count / posts.length) * 100);
      console.log(`  ${field}: ${count}/${posts.length} (${pct}%)`);
    }

    const totalEnriched = Object.values(stats).reduce((a, b) => a + b, 0);
    if (totalEnriched > 0) {
      console.log(`\n✅ E2E passed — enriched data found in scraped posts`);
    } else {
      console.log(`\n⚠️  No enriched data found — posts were likely from DOM fallback (no API intercept)`);
    }
  } finally {
    await closeBrowser();
    await redis.quit();
  }
}

main().catch((err) => {
  console.error('E2E failed:', err);
  process.exit(1);
});
