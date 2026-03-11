import {
  connectToDatabase as sharedConnect,
  getDatabase,
  closeDatabaseConnection,
} from '@app/shared';
import type { Db } from 'mongodb';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export { getDatabase, closeDatabaseConnection };

export const connectToDatabase = async (): Promise<Db> => {
  const uri =
    env.NODE_ENV === 'test' && env.MONGODB_URI_TEST
      ? env.MONGODB_URI_TEST
      : env.MONGODB_URI;

  const db = await sharedConnect(uri);
  logger.info(`Connected to MongoDB (${env.NODE_ENV})`);
  return db;
};
