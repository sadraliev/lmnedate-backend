/**
 * Smoke test: verify enriched ScrapedPost fields from both parsers.
 * Run: npx tsx scripts/smoke-enriched.ts
 */
import { parseGraphQLNode, parseApiV1Item } from '@app/shared';

// --- GraphQL mock ---
const graphqlNode = {
  id: '3001',
  shortcode: 'CxSmoke1',
  display_url: 'https://example.com/photo.jpg',
  taken_at_timestamp: 1700000000,
  edge_media_to_caption: {
    edges: [{ node: { text: 'Sunset vibes #travel #photography @natgeo @bbcnews' } }],
  },
  is_video: true,
  video_url: 'https://example.com/video.mp4',
  video_view_count: 52000,
  edge_media_preview_like: { count: 1234 },
  edge_media_to_comment: { count: 56 },
  location: { name: 'Bali, Indonesia' },
  edge_sidecar_to_children: {
    edges: [
      { node: { display_url: 'https://example.com/c1.jpg', is_video: false } },
      { node: { display_url: 'https://example.com/c2.jpg', is_video: true, video_url: 'https://example.com/c2.mp4' } },
    ],
  },
};

// --- API v1 mock ---
const apiV1Item = {
  pk: '4001',
  code: 'CxSmoke2',
  caption: { text: 'Street food tour #food #streetfood @gordonramsay' },
  image_versions2: { candidates: [{ url: 'https://example.com/thumb.jpg' }] },
  taken_at: 1700000000,
  media_type: 2,
  like_count: 9876,
  comment_count: 321,
  view_count: 150000,
  video_versions: [{ url: 'https://example.com/v1video.mp4' }],
  location: { name: 'Bangkok, Thailand' },
  carousel_media: [
    { image_versions2: { candidates: [{ url: 'https://example.com/cm1.jpg' }] }, media_type: 1 },
    { image_versions2: { candidates: [{ url: 'https://example.com/cm2.jpg' }] }, media_type: 2, video_versions: [{ url: 'https://example.com/cm2.mp4' }] },
  ],
};

console.log('=== GraphQL Node ===');
const gqlPost = parseGraphQLNode(graphqlNode, 'smokeuser');
console.log(JSON.stringify(gqlPost, null, 2));

console.log('\n=== API v1 Item ===');
const apiPost = parseApiV1Item(apiV1Item, 'smokeuser');
console.log(JSON.stringify(apiPost, null, 2));

// Quick assertions
const errors: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`FAIL ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
};

check('gql.likesCount', gqlPost?.likesCount, 1234);
check('gql.commentsCount', gqlPost?.commentsCount, 56);
check('gql.videoViewsCount', gqlPost?.videoViewsCount, 52000);
check('gql.videoUrl', gqlPost?.videoUrl, 'https://example.com/video.mp4');
check('gql.location', gqlPost?.location, 'Bali, Indonesia');
check('gql.hashtags', gqlPost?.hashtags, ['travel', 'photography']);
check('gql.mentions', gqlPost?.mentions, ['natgeo', 'bbcnews']);
check('gql.carouselMedia.length', gqlPost?.carouselMedia?.length, 2);

check('api.likesCount', apiPost?.likesCount, 9876);
check('api.commentsCount', apiPost?.commentsCount, 321);
check('api.videoViewsCount', apiPost?.videoViewsCount, 150000);
check('api.videoUrl', apiPost?.videoUrl, 'https://example.com/v1video.mp4');
check('api.location', apiPost?.location, 'Bangkok, Thailand');
check('api.hashtags', apiPost?.hashtags, ['food', 'streetfood']);
check('api.mentions', apiPost?.mentions, ['gordonramsay']);
check('api.carouselMedia.length', apiPost?.carouselMedia?.length, 2);

if (errors.length) {
  console.log('\n❌ FAILURES:');
  errors.forEach((e) => console.log(`  ${e}`));
  process.exit(1);
} else {
  console.log('\n✅ All smoke checks passed!');
}
