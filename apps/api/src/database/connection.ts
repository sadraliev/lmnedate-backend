import { MongoClient, Db } from 'mongodb';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Connect to MongoDB
 */
export const connectToDatabase = async (): Promise<Db> => {
  if (db) {
    return db;
  }

  try {
    // Use test database URI if in test environment
    const uri = env.NODE_ENV === 'test' && env.MONGODB_URI_TEST
      ? env.MONGODB_URI_TEST
      : env.MONGODB_URI;

    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();

    db = client.db();

    logger.info(`✅ Connected to MongoDB (${env.NODE_ENV})`);

    return db;
  } catch (error) {
    logger.error({ error }, 'Failed to connect to MongoDB');
    throw error;
  }
};

/**
 * Get database instance
 */
export const getDatabase = (): Db => {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase first.');
  }
  return db;
};

/**
 * Close database connection
 */
export const closeDatabaseConnection = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('Closed MongoDB connection');
  }
};
