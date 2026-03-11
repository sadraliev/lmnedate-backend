import pino from 'pino';

export type Logger = pino.Logger;

export const createLogger = ({ name }: { name: string }): Logger => {
  const level =
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
      ? 'info'
      : 'debug');

  const isDev = process.env.NODE_ENV !== 'production';

  let transport: pino.TransportSingleOptions | pino.TransportMultiOptions | undefined;

  if (isDev) {
    transport = {
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          level,
        },
        {
          target: 'pino-roll',
          options: {
            file: `logs/${name}`,
            frequency: 'daily',
            dateFormat: 'yyyy-MM-dd',
            limit: { count: 7 },
            mkdir: true,
          },
          level,
        },
      ],
    };
  }

  return pino({ name, level, transport });
};
