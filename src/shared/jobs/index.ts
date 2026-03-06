import { logger } from '../config/logger.js';
import { redisClient, closeRedisConnection } from './connection.js';

const workers: { close(): Promise<void> }[] = [];

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  try {
    for (const worker of workers) {
      await worker.close();
    }
    logger.info('Workers closed');
    await closeRedisConnection(redisClient);
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
