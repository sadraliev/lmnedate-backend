import { createServer } from './server.js';
import { connectToDatabase, closeDatabaseConnection } from './shared/database/connection.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/config/logger.js';
import { createBot } from './modules/telegram/telegram.bot.js';
import { ensureIndexes } from './modules/telegram/telegram.service.js';
import type { Bot } from 'grammy';


/**
 * Main application entry point
 */
const start = async () => {
  let bot: Bot | undefined;

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

    logger.info(`🚀 Server listening on port ${env.PORT}`);

    // Start Telegram bot (long-polling)
    if (env.TELEGRAM_BOT_TOKEN) {
      bot = createBot(env.TELEGRAM_BOT_TOKEN);
      bot.start({
        onStart: () => logger.info('🤖 Telegram bot started'),
      });
    } else {
      logger.warn('TELEGRAM_BOT_TOKEN not set, bot disabled');
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);

      if (bot) {
        await bot.stop();
        logger.info('Telegram bot stopped');
      }

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
