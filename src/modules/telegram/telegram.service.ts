import { Db } from 'mongodb';
import { getDatabase } from '../../shared/database/connection.js';
import { env } from '../../shared/config/env.js';
import type { TelegramUser, Subscription, InstagramPost } from './telegram.types.js';

const getDb = (): Db => getDatabase();

/**
 * Ensure required indexes exist
 */
export const ensureIndexes = async (): Promise<void> => {
  const db = getDb();
  await db.collection('telegram_users').createIndex({ chatId: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex(
    { chatId: 1, instagramUsername: 1 },
    { unique: true }
  );
  await db.collection('instagram_posts').createIndex(
    { instagramUsername: 1, postId: 1 },
    { unique: true }
  );
  await db.collection('instagram_posts').createIndex({ instagramUsername: 1, timestamp: -1 });
};

/**
 * Find or create a Telegram user
 */
export const findOrCreateUser = async (
  chatId: number,
  username?: string,
  firstName?: string
): Promise<TelegramUser> => {
  const db = getDb();
  const now = new Date();

  const result = await db.collection<TelegramUser>('telegram_users').findOneAndUpdate(
    { chatId },
    {
      $set: { username, firstName, updatedAt: now },
      $setOnInsert: { chatId, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return result!;
};

/**
 * Add a subscription for a user
 */
export const addSubscription = async (
  chatId: number,
  instagramUsername: string
): Promise<{ subscription?: Subscription; error?: string }> => {
  const db = getDb();
  const maxSubs = parseInt(env.INSTAGRAM_MAX_SUBSCRIPTIONS_PER_USER);

  const count = await db.collection<Subscription>('subscriptions').countDocuments({
    chatId,
    isActive: true,
  });

  if (count >= maxSubs) {
    return { error: `You can follow up to ${maxSubs} accounts.` };
  }

  const now = new Date();

  try {
    const result = await db.collection<Subscription>('subscriptions').findOneAndUpdate(
      { chatId, instagramUsername },
      {
        $set: { isActive: true, errorCount: 0, updatedAt: now },
        $setOnInsert: { chatId, instagramUsername, createdAt: now },
      },
      { upsert: true, returnDocument: 'after' }
    );

    return { subscription: result! };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return { error: `You are already following @${instagramUsername}.` };
    }
    throw error;
  }
};

/**
 * Remove a subscription
 */
export const removeSubscription = async (
  chatId: number,
  instagramUsername: string
): Promise<boolean> => {
  const db = getDb();
  const result = await db.collection<Subscription>('subscriptions').updateOne(
    { chatId, instagramUsername, isActive: true },
    { $set: { isActive: false, updatedAt: new Date() } }
  );
  return result.modifiedCount > 0;
};

/**
 * Get all active subscriptions for a user
 */
export const getSubscriptions = async (chatId: number): Promise<Subscription[]> => {
  const db = getDb();
  return db.collection<Subscription>('subscriptions')
    .find({ chatId, isActive: true })
    .toArray();
};

/**
 * Get distinct active Instagram accounts across all users
 */
export const getDistinctActiveAccounts = async (): Promise<string[]> => {
  const db = getDb();
  return db.collection<Subscription>('subscriptions').distinct('instagramUsername', {
    isActive: true,
  });
};

/**
 * Get all active subscriptions for an Instagram username
 */
export const getSubscriptionsByAccount = async (
  instagramUsername: string
): Promise<Subscription[]> => {
  const db = getDb();
  return db.collection<Subscription>('subscriptions')
    .find({ instagramUsername, isActive: true })
    .toArray();
};

/**
 * Update last post ID and last checked time for a subscription
 */
export const updateSubscriptionLastPost = async (
  chatId: number,
  instagramUsername: string,
  lastPostId: string
): Promise<void> => {
  const db = getDb();
  await db.collection<Subscription>('subscriptions').updateOne(
    { chatId, instagramUsername },
    { $set: { lastPostId, lastCheckedAt: new Date(), updatedAt: new Date() } }
  );
};

/**
 * Increment error count for an account's subscriptions; deactivate if threshold reached
 */
export const incrementErrorCount = async (instagramUsername: string): Promise<void> => {
  const db = getDb();
  await db.collection<Subscription>('subscriptions').updateMany(
    { instagramUsername, isActive: true },
    { $inc: { errorCount: 1 }, $set: { updatedAt: new Date() } }
  );
  // Deactivate subscriptions that exceeded error threshold
  await db.collection<Subscription>('subscriptions').updateMany(
    { instagramUsername, isActive: true, errorCount: { $gte: 10 } },
    { $set: { isActive: false, updatedAt: new Date() } }
  );
};

/**
 * Reset error count for an account's subscriptions
 */
export const resetErrorCount = async (instagramUsername: string): Promise<void> => {
  const db = getDb();
  await db.collection<Subscription>('subscriptions').updateMany(
    { instagramUsername },
    { $set: { errorCount: 0, updatedAt: new Date() } }
  );
};

/**
 * Store new posts, skipping duplicates
 */
export const storeNewPosts = async (posts: Omit<InstagramPost, '_id'>[]): Promise<InstagramPost[]> => {
  if (posts.length === 0) return [];

  const db = getDb();
  const stored: InstagramPost[] = [];

  for (const post of posts) {
    try {
      const result = await db.collection<InstagramPost>('instagram_posts').insertOne(post as InstagramPost);
      stored.push({ ...post, _id: result.insertedId } as InstagramPost);
    } catch (error: unknown) {
      // Skip duplicate posts (unique index violation)
      if (error instanceof Error && error.message.includes('duplicate key')) {
        continue;
      }
      throw error;
    }
  }

  return stored;
};

/**
 * Get posts newer than a given postId for an account
 */
export const getNewPostsSince = async (
  instagramUsername: string,
  lastPostId?: string
): Promise<InstagramPost[]> => {
  const db = getDb();

  if (!lastPostId) {
    // Return the most recent post only (first poll)
    return db.collection<InstagramPost>('instagram_posts')
      .find({ instagramUsername })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();
  }

  const lastPost = await db.collection<InstagramPost>('instagram_posts').findOne({
    instagramUsername,
    postId: lastPostId,
  });

  if (!lastPost) {
    return db.collection<InstagramPost>('instagram_posts')
      .find({ instagramUsername })
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();
  }

  return db.collection<InstagramPost>('instagram_posts')
    .find({
      instagramUsername,
      timestamp: { $gt: lastPost.timestamp },
    })
    .sort({ timestamp: 1 })
    .toArray();
};

/**
 * Get total counts for stats
 */
export const getStats = async (): Promise<{
  totalUsers: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  totalPosts: number;
}> => {
  const db = getDb();
  const [totalUsers, totalSubscriptions, activeSubscriptions, totalPosts] = await Promise.all([
    db.collection('telegram_users').countDocuments(),
    db.collection('subscriptions').countDocuments(),
    db.collection('subscriptions').countDocuments({ isActive: true }),
    db.collection('instagram_posts').countDocuments(),
  ]);

  return { totalUsers, totalSubscriptions, activeSubscriptions, totalPosts };
};
