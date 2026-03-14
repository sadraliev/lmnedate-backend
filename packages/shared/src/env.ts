import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import dotenv from 'dotenv';

/**
 * Find monorepo root by walking up from `startDir` looking for pnpm-workspace.yaml.
 */
function findRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

/**
 * Load .env from monorepo root. Works regardless of CWD or file depth.
 */
export function loadEnv(): void {
  const root = findRoot(process.cwd());
  dotenv.config({ path: resolve(root, '.env') });
}
