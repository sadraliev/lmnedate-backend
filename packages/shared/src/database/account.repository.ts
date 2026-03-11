import type { Collection } from 'mongodb';
import { getDatabase } from './connection.js';
import type { Account, AccountStatus } from './account.types.js';

const COLLECTION = 'accounts';

const getCollection = (): Collection<Account> =>
  getDatabase().collection<Account>(COLLECTION);

export const ensureAccountIndexes = async (): Promise<void> => {
  await getCollection().createIndex(
    { instagramUsername: 1 },
    { unique: true },
  );
};

export const findOrCreateAccount = async (
  instagramUsername: string,
  chatId: number,
): Promise<Account> => {
  const now = new Date();
  const result = await getCollection().findOneAndUpdate(
    { instagramUsername },
    {
      $setOnInsert: { instagramUsername, addedBy: chatId, status: 'scrapeable' as AccountStatus, createdAt: now },
      $set: { updatedAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );

  return result!;
};

export const findAccountByUsername = async (
  instagramUsername: string,
): Promise<Account | null> => {
  return getCollection().findOne({ instagramUsername });
};

export const updateLastScraped = async (
  instagramUsername: string,
): Promise<void> => {
  const now = new Date();
  await getCollection().updateOne(
    { instagramUsername },
    { $set: { lastScrapedAt: now, updatedAt: now } },
  );
};

export const updateAccountStatus = async (
  instagramUsername: string,
  status: AccountStatus,
): Promise<void> => {
  const now = new Date();
  await getCollection().updateOne(
    { instagramUsername },
    { $set: { status, updatedAt: now } },
  );
};
