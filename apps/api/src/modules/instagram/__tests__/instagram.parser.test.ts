import { describe, it, expect } from 'vitest';
import {
  extractPosts,
  extractPostsFromHtml,
  parseGraphQLNode,
  parseApiV1Item,
  findNestedValue,
} from '../instagram.parser.js';
import type { InstagramPost } from '../../telegram/telegram.types.js';

describe('Instagram Parser', () => {
  describe('parseGraphQLNode', () => {
    it('should parse an image post', () => {
      const node = {
        id: '123',
        shortcode: 'abc123',
        taken_at_timestamp: 1704067200,
        edge_media_to_caption: {
          edges: [{ node: { text: 'Hello world' } }],
        },
        display_url: 'https://example.com/photo.jpg',
        is_video: false,
      };

      const post = parseGraphQLNode(node, 'testuser');
      expect(post).not.toBeNull();
      expect(post!.postId).toBe('123');
      expect(post!.caption).toBe('Hello world');
      expect(post!.mediaType).toBe('image');
      expect(post!.permalink).toBe('https://www.instagram.com/p/abc123/');
      expect(post!.instagramUsername).toBe('testuser');
    });

    it('should parse a video post', () => {
      const node = {
        id: '456',
        shortcode: 'def456',
        taken_at_timestamp: 1704067200,
        edge_media_to_caption: { edges: [] },
        display_url: 'https://example.com/video.jpg',
        is_video: true,
      };

      const post = parseGraphQLNode(node, 'testuser');
      expect(post!.mediaType).toBe('video');
    });

    it('should parse a carousel post', () => {
      const node = {
        id: '789',
        shortcode: 'ghi789',
        taken_at_timestamp: 1704067200,
        edge_media_to_caption: { edges: [] },
        display_url: 'https://example.com/carousel.jpg',
        is_video: false,
        edge_sidecar_to_children: { edges: [] },
      };

      const post = parseGraphQLNode(node, 'testuser');
      expect(post!.mediaType).toBe('carousel');
    });

    it('should return null for node without id', () => {
      const node = { shortcode: 'abc' };
      expect(parseGraphQLNode(node, 'testuser')).toBeNull();
    });

    it('should return null for node without shortcode', () => {
      const node = { id: '123' };
      expect(parseGraphQLNode(node, 'testuser')).toBeNull();
    });

    it('should truncate caption to 1000 chars', () => {
      const node = {
        id: '123',
        shortcode: 'abc',
        taken_at_timestamp: 1704067200,
        edge_media_to_caption: {
          edges: [{ node: { text: 'x'.repeat(2000) } }],
        },
        display_url: 'https://example.com/photo.jpg',
      };

      const post = parseGraphQLNode(node, 'testuser');
      expect(post!.caption!.length).toBe(1000);
    });
  });

  describe('parseApiV1Item', () => {
    it('should parse an image item', () => {
      const item = {
        pk: '789',
        code: 'ghi789',
        taken_at: 1704067200,
        caption: { text: 'API post' },
        image_versions2: {
          candidates: [{ url: 'https://example.com/api.jpg' }],
        },
        media_type: 1,
      };

      const post = parseApiV1Item(item, 'testuser');
      expect(post).not.toBeNull();
      expect(post!.postId).toBe('789');
      expect(post!.caption).toBe('API post');
      expect(post!.mediaType).toBe('image');
    });

    it('should parse a video item', () => {
      const item = {
        pk: '123',
        code: 'abc',
        taken_at: 1704067200,
        caption: null,
        media_type: 2,
      };

      const post = parseApiV1Item(item, 'testuser');
      expect(post!.mediaType).toBe('video');
    });

    it('should parse a carousel item', () => {
      const item = {
        pk: '123',
        code: 'abc',
        taken_at: 1704067200,
        caption: null,
        media_type: 8,
      };

      const post = parseApiV1Item(item, 'testuser');
      expect(post!.mediaType).toBe('carousel');
    });

    it('should return null for item without id', () => {
      const item = { code: 'abc' };
      expect(parseApiV1Item(item, 'testuser')).toBeNull();
    });
  });

  describe('extractPosts', () => {
    it('should extract posts from GraphQL response', () => {
      const data = {
        data: {
          user: {
            edge_owner_to_timeline_media: {
              edges: [
                {
                  node: {
                    id: '123',
                    shortcode: 'abc123',
                    taken_at_timestamp: 1704067200,
                    edge_media_to_caption: { edges: [{ node: { text: 'Test' } }] },
                    display_url: 'https://example.com/photo.jpg',
                    is_video: false,
                  },
                },
              ],
            },
          },
        },
      };

      const posts: Omit<InstagramPost, '_id'>[] = [];
      extractPosts(data, 'testuser', posts);
      expect(posts.length).toBe(1);
      expect(posts[0].postId).toBe('123');
    });

    it('should extract posts from API v1 response', () => {
      const data = {
        items: [
          {
            pk: '789',
            code: 'ghi789',
            taken_at: 1704067200,
            caption: { text: 'API post' },
            image_versions2: { candidates: [{ url: 'https://example.com/api.jpg' }] },
            media_type: 1,
          },
        ],
      };

      const posts: Omit<InstagramPost, '_id'>[] = [];
      extractPosts(data, 'testuser', posts);
      expect(posts.length).toBe(1);
      expect(posts[0].postId).toBe('789');
    });

    it('should deduplicate posts', () => {
      const data = {
        data: {
          user: {
            edge_owner_to_timeline_media: {
              edges: [
                {
                  node: {
                    id: '123',
                    shortcode: 'abc',
                    taken_at_timestamp: 1704067200,
                    edge_media_to_caption: { edges: [] },
                    display_url: 'https://example.com/1.jpg',
                  },
                },
                {
                  node: {
                    id: '123',
                    shortcode: 'abc',
                    taken_at_timestamp: 1704067200,
                    edge_media_to_caption: { edges: [] },
                    display_url: 'https://example.com/1.jpg',
                  },
                },
              ],
            },
          },
        },
      };

      const posts: Omit<InstagramPost, '_id'>[] = [];
      extractPosts(data, 'testuser', posts);
      expect(posts.length).toBe(1);
    });

    it('should handle null/undefined data gracefully', () => {
      const posts: Omit<InstagramPost, '_id'>[] = [];
      extractPosts(null, 'testuser', posts);
      extractPosts(undefined, 'testuser', posts);
      expect(posts.length).toBe(0);
    });
  });

  describe('findNestedValue', () => {
    it('should find a key at top level', () => {
      expect(findNestedValue({ foo: 'bar' }, 'foo')).toBe('bar');
    });

    it('should find a deeply nested key', () => {
      const obj = { a: { b: { c: { target: 42 } } } };
      expect(findNestedValue(obj, 'target')).toBe(42);
    });

    it('should return undefined for non-existent key', () => {
      expect(findNestedValue({ foo: 'bar' }, 'baz')).toBeUndefined();
    });

    it('should return undefined for null input', () => {
      expect(findNestedValue(null, 'key')).toBeUndefined();
    });
  });

  describe('extractPostsFromHtml', () => {
    it('should handle HTML without embedded data', () => {
      const posts: Omit<InstagramPost, '_id'>[] = [];
      extractPostsFromHtml('<html><body>No data here</body></html>', 'testuser', posts);
      expect(posts.length).toBe(0);
    });
  });
});
