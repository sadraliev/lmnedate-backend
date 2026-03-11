import type { FastifyInstance } from 'fastify';
import { getStats } from './telegram.service.js';

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
};
