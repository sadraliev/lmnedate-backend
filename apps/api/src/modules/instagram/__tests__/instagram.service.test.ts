import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRecentPosts } from '../instagram.service.js';

// Mock playwright
vi.mock('playwright', () => {
  const mockPage = {
    on: vi.fn(),
    goto: vi.fn(),
    content: vi.fn().mockResolvedValue('<html></html>'),
    evaluate: vi.fn(),
    close: vi.fn(),
  };

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn(),
  };

  const mockBrowser = {
    isConnected: vi.fn().mockReturnValue(true),
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn(),
  };

  return {
    chromium: {
      launch: vi.fn().mockResolvedValue(mockBrowser),
    },
    _mockPage: mockPage,
    _mockContext: mockContext,
    _mockBrowser: mockBrowser,
  };
});

describe('Instagram Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchRecentPosts', () => {
    it('should extract posts from intercepted GraphQL responses', async () => {
      const pw = await import('playwright');
      const mockPage = (pw as unknown as { _mockPage: Record<string, ReturnType<typeof vi.fn>> })._mockPage;

      // Simulate XHR response with post data
      mockPage.on.mockImplementation((event: string, handler: (response: { url: () => string; json: () => Promise<unknown> }) => void) => {
        if (event === 'response') {
          setTimeout(() => {
            handler({
              url: () => 'https://www.instagram.com/graphql/query/?query_hash=abc',
              json: () =>
                Promise.resolve({
                  data: {
                    user: {
                      edge_owner_to_timeline_media: {
                        edges: [
                          {
                            node: {
                              id: '123',
                              shortcode: 'abc123',
                              taken_at_timestamp: 1704067200,
                              edge_media_to_caption: {
                                edges: [{ node: { text: 'Hello world' } }],
                              },
                              display_url: 'https://example.com/photo.jpg',
                              is_video: false,
                            },
                          },
                          {
                            node: {
                              id: '456',
                              shortcode: 'def456',
                              taken_at_timestamp: 1704153600,
                              edge_media_to_caption: { edges: [] },
                              display_url: 'https://example.com/video.jpg',
                              is_video: true,
                            },
                          },
                        ],
                      },
                    },
                  },
                }),
            });
          }, 10);
        }
      });

      // goto resolves after a delay so the response handler fires first
      mockPage.goto.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));

      const posts = await fetchRecentPosts('bbcnews');

      expect(posts.length).toBe(2);
      expect(posts[0].postId).toBe('123');
      expect(posts[0].caption).toBe('Hello world');
      expect(posts[0].mediaType).toBe('image');
      expect(posts[0].permalink).toBe('https://www.instagram.com/p/abc123/');
      expect(posts[0].instagramUsername).toBe('bbcnews');

      expect(posts[1].postId).toBe('456');
      expect(posts[1].mediaType).toBe('video');
    });

    it('should extract posts from API v1 feed items', async () => {
      const pw = await import('playwright');
      const mockPage = (pw as unknown as { _mockPage: Record<string, ReturnType<typeof vi.fn>> })._mockPage;

      mockPage.on.mockImplementation((event: string, handler: (response: { url: () => string; json: () => Promise<unknown> }) => void) => {
        if (event === 'response') {
          setTimeout(() => {
            handler({
              url: () => 'https://www.instagram.com/api/v1/feed/user/',
              json: () =>
                Promise.resolve({
                  items: [
                    {
                      pk: '789',
                      code: 'ghi789',
                      taken_at: 1704067200,
                      caption: { text: 'API post' },
                      image_versions2: {
                        candidates: [{ url: 'https://example.com/api.jpg' }],
                      },
                      media_type: 1,
                    },
                  ],
                }),
            });
          }, 10);
        }
      });

      mockPage.goto.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));

      const posts = await fetchRecentPosts('testuser');
      expect(posts.length).toBe(1);
      expect(posts[0].postId).toBe('789');
      expect(posts[0].caption).toBe('API post');
      expect(posts[0].mediaType).toBe('image');
    });

    it('should return empty array when no posts found', async () => {
      const pw = await import('playwright');
      const mockPage = (pw as unknown as { _mockPage: Record<string, ReturnType<typeof vi.fn>> })._mockPage;

      mockPage.on.mockImplementation(() => {});
      mockPage.goto.mockResolvedValue(undefined);
      mockPage.content.mockResolvedValue('<html></html>');

      const posts = await fetchRecentPosts('emptyuser');
      expect(posts).toEqual([]);
    });

    it('should limit results to 12 posts', async () => {
      const pw = await import('playwright');
      const mockPage = (pw as unknown as { _mockPage: Record<string, ReturnType<typeof vi.fn>> })._mockPage;

      const edges = Array.from({ length: 20 }, (_, i) => ({
        node: {
          id: `post${i}`,
          shortcode: `sc${i}`,
          taken_at_timestamp: 1704067200 + i,
          edge_media_to_caption: { edges: [] },
          display_url: `https://example.com/${i}.jpg`,
          is_video: false,
        },
      }));

      mockPage.on.mockImplementation((event: string, handler: (response: { url: () => string; json: () => Promise<unknown> }) => void) => {
        if (event === 'response') {
          setTimeout(() => {
            handler({
              url: () => 'https://www.instagram.com/graphql/query/',
              json: () =>
                Promise.resolve({
                  data: {
                    user: {
                      edge_owner_to_timeline_media: { edges },
                    },
                  },
                }),
            });
          }, 10);
        }
      });

      mockPage.goto.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));

      const posts = await fetchRecentPosts('manypostsuser');
      expect(posts.length).toBe(12);
    });

    it('should detect carousel posts', async () => {
      const pw = await import('playwright');
      const mockPage = (pw as unknown as { _mockPage: Record<string, ReturnType<typeof vi.fn>> })._mockPage;

      mockPage.on.mockImplementation((event: string, handler: (response: { url: () => string; json: () => Promise<unknown> }) => void) => {
        if (event === 'response') {
          setTimeout(() => {
            handler({
              url: () => 'https://www.instagram.com/graphql/query/',
              json: () =>
                Promise.resolve({
                  data: {
                    user: {
                      edge_owner_to_timeline_media: {
                        edges: [
                          {
                            node: {
                              id: '999',
                              shortcode: 'car999',
                              taken_at_timestamp: 1704067200,
                              edge_media_to_caption: { edges: [] },
                              display_url: 'https://example.com/carousel.jpg',
                              is_video: false,
                              edge_sidecar_to_children: { edges: [] },
                            },
                          },
                        ],
                      },
                    },
                  },
                }),
            });
          }, 10);
        }
      });

      mockPage.goto.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));

      const posts = await fetchRecentPosts('carouseluser');
      expect(posts[0].mediaType).toBe('carousel');
    });
  });
});
