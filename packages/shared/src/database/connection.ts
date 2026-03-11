import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export const connectToDatabase = async (uri: string): Promise<Db> => {
  if (db) {
    return db;
  }

  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  db = client.db();

  return db;
};

export const getDatabase = (): Db => {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase first.');
  }
  return db;
};

export const closeDatabaseConnection = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
};
