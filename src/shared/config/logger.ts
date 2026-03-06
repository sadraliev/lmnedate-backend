import pino from "pino";
import { env } from "./env.js";

/**
 * Structured logger configuration
 */
export const createLogger = () => {
  return pino({
    level:
      env.NODE_ENV === "production" || env.NODE_ENV === "test"
        ? "info"
        : "debug",
    transport:
      env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname",
            },
          }
        : undefined,
  });
};

export const logger = createLogger();
