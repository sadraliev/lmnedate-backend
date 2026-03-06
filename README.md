# Fastify Template

Production-ready Fastify API starter template with authentication, MongoDB, Redis, and BullMQ.

## Features

- **Auth module** — register, login, JWT access/refresh tokens with rotation, password reset, email verification, account lockout
- **MongoDB** — connection management with graceful shutdown
- **Redis + BullMQ** — job queue infrastructure with workers
- **Swagger UI** — auto-generated API docs at `/docs`
- **Zod validation** — request schema validation with type inference
- **Rate limiting** — global and per-route configuration
- **Modular architecture** — plug-and-play module system
- **Testing** — unit tests (Vitest + mongodb-memory-server) and E2E tests

## Quick Start

```bash
# Clone and install
git clone https://github.com/sadraliev/fastify-template.git
cd fastify-template
make setup

# Start infrastructure
make up

# Run dev server
make dev
```

The API will be available at `http://localhost:3000` and Swagger docs at `http://localhost:3000/docs`.

## Project Structure

```
src/
├── core/                    # Module registration system
│   └── app.ts
├── modules/                 # Feature modules
│   └── auth/
│       ├── auth.module.ts   # Module definition
│       ├── auth.routes.ts   # Route handlers
│       ├── auth.service.ts  # Business logic
│       ├── auth.schemas.ts  # Zod validation schemas
│       ├── auth.types.ts    # TypeScript types
│       └── __tests__/       # Unit tests
├── shared/
│   ├── config/              # Environment, logger, Redis config
│   ├── database/            # MongoDB connection
│   ├── jobs/                # BullMQ worker infrastructure
│   ├── testing/             # Test setup and fixtures
│   ├── types/               # Shared type definitions
│   └── utils/               # Crypto, time, validation helpers
├── server.ts                # Fastify app factory
└── index.ts                 # Entry point
tests/
└── e2e/                     # End-to-end tests
```

## API Endpoints

| Method | Path                   | Description                     |
|--------|------------------------|---------------------------------|
| POST   | `/auth/register`       | Register a new user             |
| POST   | `/auth/login`          | Login and receive tokens        |
| GET    | `/auth/me`             | Get current user profile        |
| POST   | `/auth/refresh`        | Refresh access token (rotation) |
| POST   | `/auth/logout`         | Revoke refresh token            |
| POST   | `/auth/password/forgot`| Request password reset          |
| POST   | `/auth/password/reset` | Reset password with token       |
| POST   | `/auth/email/confirm`  | Confirm email address           |
| GET    | `/health`              | Health check                    |

## Adding a New Module

1. Create `src/modules/your-module/`:

```typescript
// your-module.module.ts
import type { Module } from '../../core/app.js';
import { registerYourRoutes } from './your-module.routes.js';

export const yourModule: Module = {
  name: 'your-module',
  tag: { name: 'YourModule', description: 'Your module description' },
  routes: registerYourRoutes,
};
```

2. Register it in `src/server.ts`:

```typescript
import { yourModule } from './modules/your-module/your-module.module.js';

const modules: Module[] = [authModule, yourModule];
```

## Scripts

```bash
make dev          # Dev server with hot reload
make build        # Build TypeScript
make start        # Run production build
make lint         # Type-check
make up           # Start Docker containers (MongoDB, Redis, Bull Board)
make down         # Stop containers
make db-shell     # Open MongoDB shell
make redis-cli    # Open Redis CLI
```

## Testing

```bash
npm test              # Unit tests
npm run test:watch    # Watch mode
npm run test:e2e      # E2E tests (requires Docker containers running)
npm run test:coverage # Coverage report
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable           | Description                | Default                                    |
|--------------------|----------------------------|--------------------------------------------|
| `PORT`             | Server port                | `3000`                                     |
| `NODE_ENV`         | Environment                | `development`                              |
| `JWT_SECRET`       | JWT signing secret (32+)   | —                                          |
| `JWT_ACCESS_EXPIRY`| Access token TTL           | `15m`                                      |
| `JWT_REFRESH_EXPIRY`| Refresh token TTL         | `7d`                                       |
| `MONGODB_URI`      | MongoDB connection string  | `mongodb://localhost:27019/fastify-app`     |
| `MONGODB_URI_TEST` | Test database URI          | `mongodb://localhost:27019/fastify-app-e2e-test` |
| `REDIS_URL`        | Redis connection string    | `redis://localhost:6381`                   |

## Tech Stack

- [Fastify](https://fastify.dev/) — web framework
- [TypeScript](https://www.typescriptlang.org/) — language
- [MongoDB](https://www.mongodb.com/) — database
- [Redis](https://redis.io/) + [BullMQ](https://bullmq.io/) — job queues
- [Zod](https://zod.dev/) — schema validation
- [Vitest](https://vitest.dev/) — testing
- [Pino](https://getpino.io/) — logging

## License

ISC
