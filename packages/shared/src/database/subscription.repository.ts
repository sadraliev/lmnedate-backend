import { getDatabase } from './connection.js';
import type { TelegramSubscriber } from './subscription.types.js';

const COLLECTION = 'telegram_users';

export const ensureSubscriptionIndexes = async (): Promise<void> => {
  const db = getDatabase();
  await db.collection(COLLECTION).createIndex(
    { chatId: 1, instagramUsername: 1 },
    { unique: true },
  );
};

export const addSubscription = async (
  chatId: number,
  instagramUsername: string,
  username?: string,
  firstName?: string,
): Promise<TelegramSubscriber> => {
  const db = getDatabase();
  const now = new Date();

  const result = await db.collection<TelegramSubscriber>(COLLECTION).findOneAndUpdate(
    { chatId, instagramUsername },
    {
      $set: { username, firstName, updatedAt: now },
      $setOnInsert: { chatId, instagramUsername, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );

  return result!;
};

export const removeSubscription = async (
  chatId: number,
  instagramUsername: string,
): Promise<boolean> => {
  const db = getDatabase();
  const result = await db.collection(COLLECTION).deleteOne({ chatId, instagramUsername });
  return result.deletedCount > 0;
};

export const getSubscribersByAccount = async (
  instagramUsername: string,
): Promise<TelegramSubscriber[]> => {
  const db = getDatabase();
  return db.collection<TelegramSubscriber>(COLLECTION)
    .find({ instagramUsername })
    .toArray();
};

export const getSubscriptionsByUser = async (
  chatId: number,
): Promise<TelegramSubscriber[]> => {
  const db = getDatabase();
  return db.collection<TelegramSubscriber>(COLLECTION)
    .find({ chatId })
    .toArray();
};

export const getDistinctActiveAccounts = async (): Promise<string[]> => {
  const db = getDatabase();
  return db.collection<TelegramSubscriber>(COLLECTION)
    .distinct('instagramUsername');
};
