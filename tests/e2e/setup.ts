import { Db } from 'mongodb';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Set test environment before importing server
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI_TEST = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27019/fastify-app-e2e-test';

// Import server after setting environment
const { createServer } = await import('../../src/server.js');
const { connectToDatabase, getDatabase, closeDatabaseConnection } = await import('../../src/shared/database/connection.js');

// E2E test configuration
export const E2E_CONFIG = {
  SERVER_PORT: 3001, // Different from dev port
  API_BASE_URL: 'http://localhost:3001',
};

let testDb: Db;
let app: FastifyInstance;

/**
 * Setup E2E test environment
 * - Connects to real MongoDB test database
 * - Starts actual Fastify server
 * - Cleans database before each test suite
 */
export const setupE2E = () => {
  beforeAll(async () => {
    // Connect to test database first
    await connectToDatabase();
    testDb = getDatabase();
    console.log(`[E2E] Connected to test database via MONGODB_URI_TEST`);

    // Start Fastify server
    app = await createServer();
    await app.listen({ port: E2E_CONFIG.SERVER_PORT, host: '127.0.0.1' });

    console.log(`[E2E] Server started on port ${E2E_CONFIG.SERVER_PORT}`);
  }, 30000); // 30 second timeout for setup

  beforeEach(async () => {
    // Clean database before each test to ensure isolation
    const collections = await testDb.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
    console.log('[E2E] Database cleaned');
  });

  afterAll(async () => {
    // Cleanup
    if (app) {
      await app.close();
      console.log('[E2E] Server stopped');
    }

    // Close database connection
    await closeDatabaseConnection();
    console.log('[E2E] MongoDB connection closed');
  });

  return {
    getDb: () => testDb,
    getApp: () => app,
    getBaseUrl: () => E2E_CONFIG.API_BASE_URL,
  };
};

/**
 * Make HTTP request to API
 */
export const apiRequest = async <T = any>(
  method: string,
  path: string,
  options: {
    body?: any;
    token?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{
  status: number;
  body: T;
  headers: Record<string, string>;
}> => {
  const url = `${E2E_CONFIG.API_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    ...options.headers,
  };

  // Only set Content-Type if there's a body
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let body: any;
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  return {
    status: response.status,
    body,
    headers: Object.fromEntries(response.headers.entries()),
  };
};

/**
 * Helper to verify data exists in database
 */
export const verifyInDatabase = async (
  collection: string,
  query: any
): Promise<any> => {
  return testDb.collection(collection).findOne(query);
};

/**
 * Helper to count documents in database
 */
export const countInDatabase = async (
  collection: string,
  query: any = {}
): Promise<number> => {
  return testDb.collection(collection).countDocuments(query);
};
