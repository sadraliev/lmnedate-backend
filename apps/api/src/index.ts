import { createServer } from './server.js';
import { connectToDatabase, closeDatabaseConnection } from './database/connection.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { ensureIndexes } from './modules/telegram/telegram.service.js';

/**
 * Main application entry point
 */
const start = async () => {
  try {
    // Connect to MongoDB
    await connectToDatabase();

    // Ensure MongoDB indexes
    await ensureIndexes();

    // Create and start Fastify server
    const app = await createServer();

    await app.listen({
      port: parseInt(env.PORT),
      host: '0.0.0.0',
    });

    logger.info({ port: env.PORT }, 'Server listening');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down');
      await app.close();
      await closeDatabaseConnection();
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start application');
    process.exit(1);
  }
};

start();
