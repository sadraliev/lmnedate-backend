import { Redis, } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { logger } from '../config/logger.js';
import { getRedisConfig } from '../config/redis.js';

export type RedisClient = Redis;
let client: RedisClient | null = null;

/**
 * Creates a Redis client with proper error handling and event listeners
 * @param config - Configuration object with optional redisUrl
 * @returns IORedis client instance
 */
export function createRedisClient(redisUrl: string): RedisClient {
    if (client) {
        return client;
    }
    const redisOptions: RedisOptions = {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        enableOfflineQueue: true,
        retryStrategy: (times: number) => {
            const attempts = 3
            const delay = Math.min(times * attempts, 2000);
            logger.info(`Redis connection retry attempt ${times}, waiting ${delay}ms`);
            return delay;
        },
        reconnectOnError: (err: Error) => {
            const targetError = 'READONLY';
            if (err.message.includes(targetError)) {
                logger.info('Reconnecting due to READONLY error');
                return true;
            }
            return false;
        },
        connectTimeout: 10000,
        keepAlive: 30000,
        lazyConnect: false,
        ...(redisUrl.startsWith('rediss://') && {
            tls: {
                rejectUnauthorized: process.env.NODE_ENV === 'production',
            },
        }),
    };

    client = new Redis(redisUrl, redisOptions);

    // Event listeners for monitoring
    client.on('connect', () => {
        logger.info('✅ Redis client connected');
    });

    client.on('ready', () => {
        logger.info('Redis client ready');
    });

    client.on('error', (err: Error) => {
        logger.error({ error: err }, 'Redis client error');
    });

    client.on('close', () => {
        logger.info('Redis client connection closed');
    });

    client.on('reconnecting', (delay: number) => {
        logger.info(`Redis client reconnecting in ${delay}ms`);
    });

    client.on('end', () => {
        logger.info('Redis client connection ended');
    });

    return client;
}

/**
 * Graceful shutdown handler for Redis connections
 */
export async function closeRedisConnection(client: RedisClient): Promise<void> {
    try {
        logger.info('Closing Redis connection...');
        await client.quit();
        logger.info('Redis connection closed successfully');
    } catch (error) {
        logger.error({ error }, 'Error closing Redis connection');
        // Force close if graceful shutdown fails
        client.disconnect();
    }
}

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth(client: RedisClient): Promise<boolean> {
    try {
        const result = await client.ping();
        return result === 'PONG';
    } catch (error) {
        logger.error({ error }, 'Redis health check failed');
        return false;
    }
}


export const redisClient: RedisClient = createRedisClient(getRedisConfig().url);
