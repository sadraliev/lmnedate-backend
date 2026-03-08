import type { InstagramPost } from '../telegram/telegram.types.js';

/**
 * Extract posts from a JSON response (GraphQL or API v1)
 */
export const extractPosts = (
  data: unknown,
  username: string,
  posts: Omit<InstagramPost, '_id'>[],
): void => {
  if (!data || typeof data !== 'object') return;

  const json = data as Record<string, unknown>;

  // Try GraphQL timeline response
  const edges = findNestedValue(json, 'edge_owner_to_timeline_media');
  if (edges && typeof edges === 'object' && 'edges' in (edges as Record<string, unknown>)) {
    const edgeList = (edges as { edges: Array<{ node: Record<string, unknown> }> }).edges;
    for (const edge of edgeList) {
      const node = edge.node;
      const post = parseGraphQLNode(node, username);
      if (post && !posts.some((p) => p.postId === post.postId)) {
        posts.push(post);
      }
    }
    return;
  }

  // Try API v1 feed items
  const items = findNestedValue(json, 'items');
  if (Array.isArray(items)) {
    for (const item of items) {
      const post = parseApiV1Item(item as Record<string, unknown>, username);
      if (post && !posts.some((p) => p.postId === post.postId)) {
        posts.push(post);
      }
    }
  }
};

/**
 * Extract posts from HTML script tags
 */
export const extractPostsFromHtml = (
  html: string,
  username: string,
  posts: Omit<InstagramPost, '_id'>[],
): void => {
  // Look for JSON data embedded in script tags
  const scriptRegex = /window\._sharedData\s*=\s*({.+?});<\/script>/;
  const match = html.match(scriptRegex);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      extractPosts(data, username, posts);
    } catch {
      // Parse error
    }
  }

  // Try require('PolarisQueryPreloaderCache') pattern
  const preloaderRegex = /"xdt_api__v1__feed__user_timeline_graphql_connection":\s*({.+?})\s*[,}]/;
  const preloaderMatch = html.match(preloaderRegex);
  if (preloaderMatch) {
    try {
      const data = JSON.parse(preloaderMatch[1]);
      extractPosts(data, username, posts);
    } catch {
      // Parse error
    }
  }
};

/**
 * Parse a GraphQL edge node into a post
 */
export const parseGraphQLNode = (
  node: Record<string, unknown>,
  username: string,
): Omit<InstagramPost, '_id'> | null => {
  const id = node.id as string;
  const shortcode = node.shortcode as string;
  if (!id || !shortcode) return null;

  const captionEdges = node.edge_media_to_caption as
    | { edges: Array<{ node: { text: string } }> }
    | undefined;
  const caption = captionEdges?.edges?.[0]?.node?.text;

  let mediaType: 'image' | 'video' | 'carousel' = 'image';
  if (node.is_video) mediaType = 'video';
  else if (node.edge_sidecar_to_children) mediaType = 'carousel';

  return {
    instagramUsername: username,
    postId: id,
    caption: caption?.substring(0, 1000),
    mediaUrl: (node.display_url || node.thumbnail_src) as string,
    mediaType,
    permalink: `https://www.instagram.com/p/${shortcode}/`,
    timestamp: new Date(((node.taken_at_timestamp as number) || 0) * 1000),
    createdAt: new Date(),
  };
};

/**
 * Parse an API v1 feed item into a post
 */
export const parseApiV1Item = (
  item: Record<string, unknown>,
  username: string,
): Omit<InstagramPost, '_id'> | null => {
  const id = (item.pk || item.id) as string;
  const code = item.code as string;
  if (!id || !code) return null;

  const caption = item.caption as { text?: string } | null;
  const imageVersions = item.image_versions2 as
    | { candidates?: Array<{ url: string }> }
    | undefined;
  const mediaUrl =
    imageVersions?.candidates?.[0]?.url ||
    (item.thumbnail_url as string) ||
    '';

  let mediaType: 'image' | 'video' | 'carousel' = 'image';
  const mt = item.media_type as number | undefined;
  if (mt === 2) mediaType = 'video';
  else if (mt === 8) mediaType = 'carousel';

  return {
    instagramUsername: username,
    postId: String(id),
    caption: caption?.text?.substring(0, 1000),
    mediaUrl,
    mediaType,
    permalink: `https://www.instagram.com/p/${code}/`,
    timestamp: new Date(((item.taken_at as number) || 0) * 1000),
    createdAt: new Date(),
  };
};

/**
 * Recursively search for a key in a nested object
 */
export const findNestedValue = (obj: unknown, key: string): unknown => {
  if (!obj || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  if (key in record) return record[key];
  for (const value of Object.values(record)) {
    const found = findNestedValue(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
};
