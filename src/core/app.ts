import type { FastifyInstance } from 'fastify';
import { logger } from '../shared/config/logger.js';

export type Module = {
  name: string;
  tag?: { name: string; description: string };
  routes: (app: FastifyInstance) => Promise<void>;
};

export const registerModules = async (
  app: FastifyInstance,
  modules: Module[]
): Promise<void> => {
  for (const mod of modules) {
    await mod.routes(app);
    logger.info(`Registered module: ${mod.name}`);
  }
};

