export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  protocol: string;
  url: string;
}

/**
 * Parse a Redis URL into a config object.
 * Pure function — no dependency on env.ts.
 */
export const parseRedisUrl = (redisUrl: string): RedisConfig => {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    protocol: parsed.protocol,
    url: redisUrl,
  };
};

/**
 * Create a Redis connection config suitable for BullMQ.
 * Includes retry strategy with exponential backoff (capped at 30s)
 * and maxRetriesPerRequest: null (required for BullMQ workers).
 */
export const createRedisConnection = (url: string, name: string, log?: import('./logger.js').Logger) => {
  const config = parseRedisUrl(url);
  return {
    host: config.host,
    port: config.port,
    ...(config.password ? { password: config.password } : {}),
    ...(config.username ? { username: config.username } : {}),
    maxRetriesPerRequest: null as null,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 500, 30_000);
      if (log) {
        log.info({ attempt: times, delay }, 'Redis reconnecting');
      } else {
        console.log(`[${name}] Redis reconnecting (attempt ${times}, next in ${delay}ms)`);
      }
      return delay;
    },
  };
};
