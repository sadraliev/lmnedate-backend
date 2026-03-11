import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupTestDatabase } from '../../../testing/setup.js';
import {
  addSubscription,
  removeSubscription,
  getSubscriptionsByUser,
  getDistinctActiveAccounts,
  getSubscribersByAccount,
  storeNewPosts,
  getNewPostsSince,
  getStats,
  ensureIndexes,
} from '../telegram.service.js';
import * as connection from '../../../database/connection.js';
import * as sharedConnection from '@app/shared/src/database/connection.js';

describe('Telegram Service', () => {
  const getDb = setupTestDatabase();

  beforeEach(() => {
    vi.spyOn(connection, 'getDatabase').mockReturnValue(getDb());
    vi.spyOn(sharedConnection, 'getDatabase').mockReturnValue(getDb());
  });

  describe('ensureIndexes', () => {
    it('should create indexes without error', async () => {
      await expect(ensureIndexes()).resolves.toBeUndefined();
    });
  });

  describe('addSubscription', () => {
    it('should add a subscription', async () => {
      const sub = await addSubscription(12345, 'bbcnews', 'testuser', 'Test');
      expect(sub.chatId).toBe(12345);
      expect(sub.instagramUsername).toBe('bbcnews');
      expect(sub.username).toBe('testuser');
      expect(sub.firstName).toBe('Test');
      expect(sub.createdAt).toBeDefined();
    });

    it('should update user info on re-subscribe', async () => {
      await addSubscription(12345, 'bbcnews', 'oldname', 'Old');
      const sub = await addSubscription(12345, 'bbcnews', 'newname', 'New');
      expect(sub.username).toBe('newname');
      expect(sub.firstName).toBe('New');
    });
  });

  describe('removeSubscription', () => {
    it('should delete a subscription', async () => {
      await addSubscription(12345, 'bbcnews');
      const removed = await removeSubscription(12345, 'bbcnews');
      expect(removed).toBe(true);

      const subs = await getSubscriptionsByUser(12345);
      expect(subs.length).toBe(0);
    });

    it('should return false for non-existent subscription', async () => {
      const removed = await removeSubscription(12345, 'nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('getSubscriptionsByUser', () => {
    it('should return all subscriptions for a user', async () => {
      await addSubscription(12345, 'account1');
      await addSubscription(12345, 'account2');
      await addSubscription(12345, 'account3');
      await removeSubscription(12345, 'account2');

      const subs = await getSubscriptionsByUser(12345);
      expect(subs.length).toBe(2);
      expect(subs.map((s) => s.instagramUsername)).toContain('account1');
      expect(subs.map((s) => s.instagramUsername)).toContain('account3');
    });
  });

  describe('getDistinctActiveAccounts', () => {
    it('should return unique account names', async () => {
      await addSubscription(11111, 'bbcnews');
      await addSubscription(22222, 'bbcnews');
      await addSubscription(33333, 'cnn');

      const accounts = await getDistinctActiveAccounts();
      expect(accounts.sort()).toEqual(['bbcnews', 'cnn']);
    });
  });

  describe('getSubscribersByAccount', () => {
    it('should return all subscribers for an account', async () => {
      await addSubscription(11111, 'bbcnews');
      await addSubscription(22222, 'bbcnews');
      await addSubscription(33333, 'cnn');

      const subs = await getSubscribersByAccount('bbcnews');
      expect(subs.length).toBe(2);
    });
  });

  describe('storeNewPosts', () => {
    it('should store posts and return them', async () => {
      const posts = [
        {
          instagramUsername: 'bbcnews',
          postId: 'p1',
          caption: 'Hello',
          mediaUrl: 'https://example.com/1.jpg',
          mediaType: 'image' as const,
          permalink: 'https://instagram.com/p/abc',
          timestamp: new Date('2024-01-01'),
          createdAt: new Date(),
        },
      ];

      const stored = await storeNewPosts(posts);
      expect(stored.length).toBe(1);
      expect(stored[0].postId).toBe('p1');
    });

    it('should skip duplicate posts', async () => {
      await ensureIndexes();

      const post = {
        instagramUsername: 'bbcnews',
        postId: 'dup1',
        mediaUrl: 'https://example.com/1.jpg',
        mediaType: 'image' as const,
        permalink: 'https://instagram.com/p/dup',
        timestamp: new Date('2024-01-01'),
        createdAt: new Date(),
      };

      const first = await storeNewPosts([post]);
      const second = await storeNewPosts([post]);
      expect(first.length).toBe(1);
      expect(second.length).toBe(0);
    });

    it('should return empty array for empty input', async () => {
      const stored = await storeNewPosts([]);
      expect(stored).toEqual([]);
    });
  });

  describe('getNewPostsSince', () => {
    it('should return the most recent post when no lastPostId', async () => {
      const db = getDb();
      await db.collection('instagram_posts').insertMany([
        {
          instagramUsername: 'bbcnews',
          postId: 'old',
          mediaUrl: 'url',
          mediaType: 'image',
          permalink: 'link',
          timestamp: new Date('2024-01-01'),
          createdAt: new Date(),
        },
        {
          instagramUsername: 'bbcnews',
          postId: 'new',
          mediaUrl: 'url',
          mediaType: 'image',
          permalink: 'link',
          timestamp: new Date('2024-01-02'),
          createdAt: new Date(),
        },
      ]);

      const posts = await getNewPostsSince('bbcnews');
      expect(posts.length).toBe(1);
      expect(posts[0].postId).toBe('new');
    });

    it('should return posts newer than lastPostId', async () => {
      const db = getDb();
      await db.collection('instagram_posts').insertMany([
        {
          instagramUsername: 'cnn',
          postId: 'p1',
          mediaUrl: 'url',
          mediaType: 'image',
          permalink: 'link',
          timestamp: new Date('2024-01-01'),
          createdAt: new Date(),
        },
        {
          instagramUsername: 'cnn',
          postId: 'p2',
          mediaUrl: 'url',
          mediaType: 'image',
          permalink: 'link',
          timestamp: new Date('2024-01-02'),
          createdAt: new Date(),
        },
        {
          instagramUsername: 'cnn',
          postId: 'p3',
          mediaUrl: 'url',
          mediaType: 'image',
          permalink: 'link',
          timestamp: new Date('2024-01-03'),
          createdAt: new Date(),
        },
      ]);

      const posts = await getNewPostsSince('cnn', 'p1');
      expect(posts.length).toBe(2);
      expect(posts[0].postId).toBe('p2');
      expect(posts[1].postId).toBe('p3');
    });
  });

  describe('getStats', () => {
    it('should return correct counts', async () => {
      await addSubscription(11111, 'bbcnews');
      await addSubscription(22222, 'cnn');
      await addSubscription(11111, 'cnn');

      const stats = await getStats();
      expect(stats.totalUsers).toBe(2);
      expect(stats.totalSubscriptions).toBe(3);
    });
  });
});
