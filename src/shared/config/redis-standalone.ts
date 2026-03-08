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
