import type { Module } from '../../core/app.js';
import { registerTelegramRoutes } from './telegram.routes.js';

export const telegramModule: Module = {
  name: 'telegram',
  tag: { name: 'Telegram', description: 'Telegram bot & Instagram delivery' },
  routes: registerTelegramRoutes,
};
