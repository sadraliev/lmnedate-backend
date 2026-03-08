import type { FastifyInstance } from 'fastify';
import { getStats } from './telegram.service.js';
import { getBot } from './telegram.bot.js';

export const registerTelegramRoutes = async (app: FastifyInstance) => {
  app.get(
    '/telegram/stats',
    {
      schema: {
        tags: ['Telegram'],
        summary: 'Get Telegram bot statistics',
        response: {
          200: {
            type: 'object',
            properties: {
              totalUsers: { type: 'number' },
              totalSubscriptions: { type: 'number' },
              activeSubscriptions: { type: 'number' },
              totalPosts: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const stats = await getStats();
      reply.send(stats);
    }
  );

  app.get(
    '/telegram/health',
    {
      schema: {
        tags: ['Telegram'],
        summary: 'Check Telegram bot health',
        response: {
          200: {
            type: 'object',
            properties: {
              botRunning: { type: 'boolean' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const bot = getBot();
      reply.send({
        botRunning: bot !== null,
        timestamp: new Date().toISOString(),
      });
    }
  );
};
