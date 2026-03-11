import { describe, it, expect } from 'vitest';
import { parseGraphQLNode, parseApiV1Item } from '../parser.js';

describe('parseGraphQLNode', () => {
  const baseNode = {
    id: '123',
    shortcode: 'abc',
    display_url: 'https://example.com/img.jpg',
    taken_at_timestamp: 1700000000,
    edge_media_to_caption: { edges: [{ node: { text: 'Hello #world @user' } }] },
    is_video: false,
  };

  it('extracts likesCount from edge_media_preview_like', () => {
    const node = { ...baseNode, edge_media_preview_like: { count: 42 } };
    const post = parseGraphQLNode(node, 'testuser');
    expect(post?.likesCount).toBe(42);
  });

  it('extracts likesCount from edge_liked_by as fallback', () => {
    const node = { ...baseNode, edge_liked_by: { count: 10 } };
    const post = parseGraphQLNode(node, 'testuser');
    expect(post?.likesCount).toBe(10);
  });

  it('extracts commentsCount', () => {
    const node = { ...baseNode, edge_media_to_comment: { count: 5 } };
    const post = parseGraphQLNode(node, 'testuser');
    expect(post?.commentsCount).toBe(5);
  });

  it('extracts videoViewsCount and videoUrl for videos', () => {
    const node = {
      ...baseNode,
      is_video: true,
      video_view_count: 1000,
      video_url: 'https://example.com/video.mp4',
    };
    const post = parseGraphQLNode(node, 'testuser');
    expect(post?.videoViewsCount).toBe(1000);
    expect(post?.videoUrl).toBe('https://example.com/video.mp4');
  });

  it('extracts carouselMedia from edge_sidecar_to_children', () => {
    const node = {
      ...baseNode,
      edge_sidecar_to_children: {
        edges: [
          { node: { display_url: 'https://example.com/1.jpg', is_video: false } },
          {
            node: {
              display_url: 'https://example.com/2.jpg',
              is_video: true,
              video_url: 'https://example.com/2.mp4',
            },
          },
        ],
      },
    };
    const post = parseGraphQLNode(node, 'testuser');
    expect(post?.carouselMedia).toEqual([
      { mediaUrl: 'https://example.com/1.jpg', mediaType: 'image', videoUrl: undefined },
      {
        mediaUrl: 'https://example.com/2.jpg',
        mediaType: 'video',
        videoUrl: 'https://example.com/2.mp4',
      },
    ]);
  });

  it('extracts location name', () => {
    const node = { ...baseNode, location: { name: 'New York' } };
    const post = parseGraphQLNode(node, 'testuser');
    expect(post?.location).toBe('New York');
  });

  it('extracts hashtags and mentions from caption', () => {
    const post = parseGraphQLNode(baseNode, 'testuser');
    expect(post?.hashtags).toEqual(['world']);
    expect(post?.mentions).toEqual(['user']);
  });

  it('returns undefined for missing optional fields', () => {
    const post = parseGraphQLNode(baseNode, 'testuser');
    expect(post?.likesCount).toBeUndefined();
    expect(post?.commentsCount).toBeUndefined();
    expect(post?.videoViewsCount).toBeUndefined();
    expect(post?.videoUrl).toBeUndefined();
    expect(post?.carouselMedia).toBeUndefined();
    expect(post?.location).toBeUndefined();
  });
});

describe('parseApiV1Item', () => {
  const baseItem = {
    pk: '456',
    code: 'xyz',
    caption: { text: 'Check out #food @chef' },
    image_versions2: { candidates: [{ url: 'https://example.com/img.jpg' }] },
    taken_at: 1700000000,
    media_type: 1,
  };

  it('extracts likesCount', () => {
    const item = { ...baseItem, like_count: 100 };
    const post = parseApiV1Item(item, 'testuser');
    expect(post?.likesCount).toBe(100);
  });

  it('extracts commentsCount', () => {
    const item = { ...baseItem, comment_count: 25 };
    const post = parseApiV1Item(item, 'testuser');
    expect(post?.commentsCount).toBe(25);
  });

  it('extracts videoViewsCount from view_count', () => {
    const item = { ...baseItem, media_type: 2, view_count: 5000 };
    const post = parseApiV1Item(item, 'testuser');
    expect(post?.videoViewsCount).toBe(5000);
  });

  it('extracts videoViewsCount from play_count (reels fallback)', () => {
    const item = { ...baseItem, media_type: 2, play_count: 80000 };
    const post = parseApiV1Item(item, 'testuser');
    expect(post?.videoViewsCount).toBe(80000);
  });

  it('extracts videoUrl', () => {
    const item = {
      ...baseItem,
      media_type: 2,
      video_versions: [{ url: 'https://example.com/video.mp4' }],
    };
    const post = parseApiV1Item(item, 'testuser');
    expect(post?.videoUrl).toBe('https://example.com/video.mp4');
  });

  it('extracts carouselMedia', () => {
    const item = {
      ...baseItem,
      media_type: 8,
      carousel_media: [
        {
          image_versions2: { candidates: [{ url: 'https://example.com/c1.jpg' }] },
          media_type: 1,
        },
        {
          image_versions2: { candidates: [{ url: 'https://example.com/c2.jpg' }] },
          media_type: 2,
          video_versions: [{ url: 'https://example.com/c2.mp4' }],
        },
      ],
    };
    const post = parseApiV1Item(item, 'testuser');
    expect(post?.carouselMedia).toEqual([
      { mediaUrl: 'https://example.com/c1.jpg', mediaType: 'image', videoUrl: undefined },
      { mediaUrl: 'https://example.com/c2.jpg', mediaType: 'video', videoUrl: 'https://example.com/c2.mp4' },
    ]);
  });

  it('extracts location name', () => {
    const item = { ...baseItem, location: { name: 'Paris' } };
    const post = parseApiV1Item(item, 'testuser');
    expect(post?.location).toBe('Paris');
  });

  it('extracts hashtags and mentions from caption', () => {
    const post = parseApiV1Item(baseItem, 'testuser');
    expect(post?.hashtags).toEqual(['food']);
    expect(post?.mentions).toEqual(['chef']);
  });

  it('returns undefined for missing optional fields', () => {
    const post = parseApiV1Item(baseItem, 'testuser');
    expect(post?.likesCount).toBeUndefined();
    expect(post?.commentsCount).toBeUndefined();
    expect(post?.videoViewsCount).toBeUndefined();
    expect(post?.videoUrl).toBeUndefined();
    expect(post?.carouselMedia).toBeUndefined();
    expect(post?.location).toBeUndefined();
  });
});
