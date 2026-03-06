import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { beforeAll, afterAll, afterEach } from 'vitest';

let mongoServer: MongoMemoryServer;
let client: MongoClient;
let testDb: Db;

export const setupTestDatabase = () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    client = new MongoClient(uri);
    await client.connect();
    testDb = client.db('fastify-app-test');
  });

  afterEach(async () => {
    // Clear all collections after each test
    const collections = await testDb.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  return () => testDb;
};
