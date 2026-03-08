import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import {
  validatorCompiler,
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
} from "fastify-type-provider-zod";
import { $ZodType } from "zod/v4/core";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { registerModules } from "./core/app.js";
import { authModule } from "./modules/auth/auth.module.js";
import { telegramModule } from "./modules/telegram/telegram.module.js";
import type { Module } from "./core/app.js";

// Custom swagger transform: passes only Zod schemas to jsonSchemaTransform,
// preserving plain JSON Schema objects (params, querystring, response) as-is.
const mixedSchemaTransform: typeof jsonSchemaTransform = (input) => {
  const { schema } = input;
  if (!schema) return jsonSchemaTransform(input);

  const jsonSchemaProps: Record<string, unknown> = {};
  const zodOnlySchema: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (value instanceof $ZodType) {
      zodOnlySchema[key] = value;
    } else {
      jsonSchemaProps[key] = value;
    }
  }

  const result = jsonSchemaTransform({ ...input, schema: zodOnlySchema });
  Object.assign(result.schema, jsonSchemaProps);
  return result;
};

// Extend Fastify types for JWT
declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: {
      userId: string;
      role: "admin" | "user";
    };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

const modules: Module[] = [authModule, telegramModule];

export const createServer = async () => {
  const app = Fastify({
    logger: {
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
    },
  });

  // Set Zod validator compiler (request body validation)
  app.setValidatorCompiler(validatorCompiler);

  // Register plugins
  await app.register(cors, {
    origin: true, // Allow all origins in development
  });

  // Derive Swagger tags from modules
  const tags = modules
    .filter((m) => m.tag)
    .map((m) => m.tag!);

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Fastify API",
        description:
          "Production-ready Fastify API with authentication",
        version: "1.0.0",
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: "Development server",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      tags,
    },
    transform: mixedSchemaTransform,
  });

  await app.register(swaggerUI, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  // Rate limiting (global defaults, overridden per-route)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // JWT authentication decorator
  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // Health check
  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Register all modules
  await registerModules(app, modules);

  // 404 handler
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: "Route not found" });
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((v: any) =>
        v.params?.issue ?? { message: v.message }
      );
      reply.code(400).send({ error: 'Validation error', details });
      return;
    }

    logger.error(
      { error, url: request.url, method: request.method },
      "Request error"
    );

    const statusCode = (error as any).statusCode || 500;
    const message = (error as Error).message || "Internal server error";

    reply.code(statusCode).send({ error: message });
  });

  return app;
};
