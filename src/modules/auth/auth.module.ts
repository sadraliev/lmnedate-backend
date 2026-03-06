import type { Module } from '../../core/app.js';
import { registerAuthRoutes } from './auth.routes.js';

export const authModule: Module = {
  name: 'auth',
  tag: { name: 'Auth', description: 'Authentication service' },
  routes: registerAuthRoutes,
};
