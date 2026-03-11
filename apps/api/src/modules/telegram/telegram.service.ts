import {
  getDatabase,
  ensurePostIndexes,
  ensureSubscriptionIndexes,
  ensureAccountIndexes,
  addSubscription,
  removeSubscription,
  getSubscriptionsByUser,
  getDistinctActiveAccounts,
  getSubscribersByAccount,
  storeNewPosts,
  getNewPostsSince,
} from '@app/shared';

/**
 * Ensure required indexes exist
 */
export const ensureIndexes = async (): Promise<void> => {
  await ensureSubscriptionIndexes();
  await ensureAccountIndexes();
  await ensurePostIndexes();
};

/**
 * Get total counts for stats
 */
export const getStats = async (): Promise<{
  totalUsers: number;
  totalSubscriptions: number;
  totalPosts: number;
}> => {
  const db = getDatabase();
  const [totalUsers, totalSubscriptions, totalPosts] = await Promise.all([
    db.collection('telegram_users').distinct('chatId').then((ids) => ids.length),
    db.collection('telegram_users').countDocuments(),
    db.collection('instagram_posts').countDocuments(),
  ]);

  return { totalUsers, totalSubscriptions, totalPosts };
};

// Re-export shared functions so existing API callers still work
export {
  addSubscription,
  removeSubscription,
  getSubscriptionsByUser,
  getDistinctActiveAccounts,
  getSubscribersByAccount,
  storeNewPosts,
  getNewPostsSince,
};
