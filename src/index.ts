import { createServer } from './server.js';
import { connectToDatabase, closeDatabaseConnection } from './shared/database/connection.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/config/logger.js';


/**
 * Main application entry point
 */
const start = async () => {
  try {
    // Connect to MongoDB
    await connectToDatabase();

    // Create and start Fastify server
    const app = await createServer();

    await app.listen({
      port: parseInt(env.PORT),
      host: '0.0.0.0',
    });

    logger.info(`🚀 Server listening on port ${env.PORT}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);

      await app.close();
      await closeDatabaseConnection();

      logger.info('✅ Shutdown complete');
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
