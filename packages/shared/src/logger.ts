import pino from 'pino';

export type Logger = pino.Logger;

export const createLogger = ({ name }: { name: string }): Logger => {
  const level =
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
      ? 'info'
      : 'debug');

  const isProd = process.env.NODE_ENV === 'production';

  // Production: stdout only, no transports (PM2 handles log rotation).
  // Pino transports use worker_threads via thread-stream which can't be bundled.
  if (isProd) {
    return pino({ name, level });
  }

  const fileTransport: pino.TransportTargetOptions = {
    target: 'pino-roll',
    options: {
      file: `logs/${name}`,
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      limit: { count: 7 },
      mkdir: true,
    },
    level,
  };

  return pino({
    name,
    level,
    transport: {
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          level,
        },
        fileTransport,
      ],
    },
  });
};
