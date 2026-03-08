import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupTestDatabase } from '../../../shared/testing/setup.js';
import {
  findOrCreateUser,
  addSubscription,
  removeSubscription,
  getSubscriptions,
  getDistinctActiveAccounts,
  getSubscriptionsByAccount,
  updateSubscriptionLastPost,
  incrementErrorCount,
  resetErrorCount,
  storeNewPosts,
  getNewPostsSince,
  getStats,
  ensureIndexes,
} from '../telegram.service.js';
import * as connection from '../../../shared/database/connection.js';
import type { Subscription } from '../telegram.types.js';

vi.mock('../../../shared/config/env.js', () => ({
  env: {
    INSTAGRAM_MAX_SUBSCRIPTIONS_PER_USER: '10',
    INSTAGRAM_POLL_INTERVAL_MS: '900000',
  },
}));

describe('Telegram Service', () => {
  const getDb = setupTestDatabase();

  beforeEach(() => {
    vi.spyOn(connection, 'getDatabase').mockReturnValue(getDb());
  });

  describe('ensureIndexes', () => {
    it('should create indexes without error', async () => {
      await expect(ensureIndexes()).resolves.toBeUndefined();
    });
  });

  describe('findOrCreateUser', () => {
    it('should create a new user', async () => {
      const user = await findOrCreateUser(12345, 'testuser', 'Test');
      expect(user.chatId).toBe(12345);
      expect(user.username).toBe('testuser');
      expect(user.firstName).toBe('Test');
      expect(user.createdAt).toBeDefined();
    });

    it('should return existing user on duplicate chatId', async () => {
      await findOrCreateUser(12345, 'testuser', 'Test');
      const user = await findOrCreateUser(12345, 'updateduser', 'Updated');
      expect(user.chatId).toBe(12345);
      expect(user.username).toBe('updateduser');
    });
  });

  describe('addSubscription', () => {
    it('should add a subscription', async () => {
      const result = await addSubscription(12345, 'bbcnews');
      expect(result.error).toBeUndefined();
      expect(result.subscription).toBeDefined();
      expect(result.subscription!.instagramUsername).toBe('bbcnews');
      expect(result.subscription!.isActive).toBe(true);
      expect(result.subscription!.errorCount).toBe(0);
    });

    it('should reactivate an inactive subscription', async () => {
      await addSubscription(12345, 'bbcnews');
      await removeSubscription(12345, 'bbcnews');
      const result = await addSubscription(12345, 'bbcnews');
      expect(result.subscription!.isActive).toBe(true);
    });

    it('should enforce max subscriptions limit', async () => {
      // Add 10 subscriptions manually (matching the mocked limit of 10)
      const db = getDb();
      for (let i = 0; i < 10; i++) {
        await db.collection('subscriptions').insertOne({
          chatId: 99999,
          instagramUsername: `user${i}`,
          isActive: true,
          errorCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const result = await addSubscription(99999, 'onemore');
      expect(result.error).toContain('You can follow up to');
    });
  });

  describe('removeSubscription', () => {
    it('should deactivate a subscription', async () => {
      await addSubscription(12345, 'bbcnews');
      const removed = await removeSubscription(12345, 'bbcnews');
      expect(removed).toBe(true);

      const subs = await getSubscriptions(12345);
      expect(subs.length).toBe(0);
    });

    it('should return false for non-existent subscription', async () => {
      const removed = await removeSubscription(12345, 'nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('getSubscriptions', () => {
    it('should return only active subscriptions', async () => {
      await addSubscription(12345, 'account1');
      await addSubscription(12345, 'account2');
      await addSubscription(12345, 'account3');
      await removeSubscription(12345, 'account2');

      const subs = await getSubscriptions(12345);
      expect(subs.length).toBe(2);
      expect(subs.map((s) => s.instagramUsername)).toContain('account1');
      expect(subs.map((s) => s.instagramUsername)).toContain('account3');
    });
  });

  describe('getDistinctActiveAccounts', () => {
    it('should return unique active account names', async () => {
      await addSubscription(11111, 'bbcnews');
      await addSubscription(22222, 'bbcnews');
      await addSubscription(33333, 'cnn');

      const accounts = await getDistinctActiveAccounts();
      expect(accounts.sort()).toEqual(['bbcnews', 'cnn']);
    });
  });

  describe('getSubscriptionsByAccount', () => {
    it('should return all subscribers for an account', async () => {
      await addSubscription(11111, 'bbcnews');
      await addSubscription(22222, 'bbcnews');
      await addSubscription(33333, 'cnn');

      const subs = await getSubscriptionsByAccount('bbcnews');
      expect(subs.length).toBe(2);
    });
  });

  describe('updateSubscriptionLastPost', () => {
    it('should update lastPostId and lastCheckedAt', async () => {
      await addSubscription(12345, 'bbcnews');
      await updateSubscriptionLastPost(12345, 'bbcnews', 'post123');

      const db = getDb();
      const sub = await db.collection<Subscription>('subscriptions').findOne({
        chatId: 12345,
        instagramUsername: 'bbcnews',
      });
      expect(sub?.lastPostId).toBe('post123');
      expect(sub?.lastCheckedAt).toBeDefined();
    });
  });

  describe('incrementErrorCount', () => {
    it('should increment error count for all subs of an account', async () => {
      await addSubscription(11111, 'failing');
      await addSubscription(22222, 'failing');
      await incrementErrorCount('failing');

      const subs = await getSubscriptionsByAccount('failing');
      expect(subs[0].errorCount).toBe(1);
      expect(subs[1].errorCount).toBe(1);
    });

    it('should deactivate after 10 consecutive errors', async () => {
      await addSubscription(12345, 'broken');

      const db = getDb();
      // Set error count to 9 so next increment triggers deactivation
      await db.collection('subscriptions').updateMany(
        { instagramUsername: 'broken' },
        { $set: { errorCount: 9 } }
      );

      await incrementErrorCount('broken');

      const sub = await db.collection<Subscription>('subscriptions').findOne({
        chatId: 12345,
        instagramUsername: 'broken',
      });
      expect(sub?.isActive).toBe(false);
    });
  });

  describe('resetErrorCount', () => {
    it('should reset error count to 0', async () => {
      await addSubscription(12345, 'recovered');

      const db = getDb();
      await db.collection('subscriptions').updateMany(
        { instagramUsername: 'recovered' },
        { $set: { errorCount: 5 } }
      );

      await resetErrorCount('recovered');

      const sub = await db.collection<Subscription>('subscriptions').findOne({
        chatId: 12345,
        instagramUsername: 'recovered',
      });
      expect(sub?.errorCount).toBe(0);
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
      await findOrCreateUser(11111, 'user1');
      await findOrCreateUser(22222, 'user2');
      await addSubscription(11111, 'bbcnews');
      await addSubscription(22222, 'cnn');
      await addSubscription(11111, 'inactive');
      await removeSubscription(11111, 'inactive');

      const stats = await getStats();
      expect(stats.totalUsers).toBe(2);
      expect(stats.totalSubscriptions).toBe(3);
      expect(stats.activeSubscriptions).toBe(2);
    });
  });
});
