import { env } from './env.js';

let redisConfig: RedisConfig | null = null;
interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  protocol: string;
  url: string;
}
export const getRedisConfig = () => {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL is not set');
  }
  if (redisConfig) {
    return redisConfig;
  }
  const parsedUrl = new URL(env.REDIS_URL);
  redisConfig = {
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port),
    password: parsedUrl.password,
    username: parsedUrl.username,
    protocol: parsedUrl.protocol,
    url: env.REDIS_URL,
  }

  return redisConfig;
}
