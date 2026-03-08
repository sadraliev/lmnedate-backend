import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  registerUser,
  authenticateUser,
  findUserById,
  createSession,
  consumeRefreshToken,
  revokeRefreshToken,
  generatePasswordResetToken,
  resetPassword,
  confirmEmail,
} from './auth.service.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  confirmEmailSchema,
} from './auth.schemas.js';
import { parseDurationMs } from '../../utils/time.js';
import { env } from '../../config/env.js';
import type { AuthResponse } from './auth.types.js';

export const registerAuthRoutes = async (app: FastifyInstance) => {
  // Register
  app.post<{ Body: z.infer<typeof registerSchema> }>(
    '/auth/register',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Register a new user',
        description: 'Create a new user account with email verification and refresh token',
        body: registerSchema,
        response: {
          201: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                  role: { type: 'string' },
                  timeZone: { type: 'string' },
                  emailVerified: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { user } = await registerUser(request.body);

        const refreshExpiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRY));
        const refreshToken = await createSession(user._id, refreshExpiresAt);

        const accessToken = app.jwt.sign(
          { userId: user._id.toString(), role: user.role },
          { expiresIn: env.JWT_ACCESS_EXPIRY }
        );

        const response: AuthResponse = {
          accessToken,
          refreshToken,
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            role: user.role,
            timeZone: user.timeZone,
            emailVerified: user.emailVerified,
          },
        };

        reply.code(201).send(response);
      } catch (error) {
        if (error instanceof Error && error.message === 'User with this email already exists') {
          reply.code(409).send({ error: error.message });
        } else if (error instanceof Error) {
          reply.code(500).send({ error: 'Internal server error' });
        }
      }
    }
  );

  // Login
  app.post<{ Body: z.infer<typeof loginSchema> }>(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['Auth'],
        summary: 'Login',
        description: 'Authenticate user and receive access + refresh tokens',
        body: loginSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                  role: { type: 'string' },
                  timeZone: { type: 'string' },
                  emailVerified: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const user = await authenticateUser(request.body.email, request.body.password);

        const refreshExpiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRY));
        const refreshToken = await createSession(user._id, refreshExpiresAt);

        const accessToken = app.jwt.sign(
          { userId: user._id.toString(), role: user.role },
          { expiresIn: env.JWT_ACCESS_EXPIRY }
        );

        const response: AuthResponse = {
          accessToken,
          refreshToken,
          user: {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            role: user.role,
            timeZone: user.timeZone,
            emailVerified: user.emailVerified,
          },
        };

        reply.send(response);
      } catch (error) {
        if (error instanceof Error) {
          const statusCode = (error as Error & { statusCode?: number }).statusCode || 500;
          reply.code(statusCode).send({ error: error.message });
        }
      }
    }
  );

  // Me
  app.get(
    '/auth/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Get current user',
        description: 'Retrieve authenticated user details including emailVerified status',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              name: { type: 'string' },
              role: { type: 'string' },
              timeZone: { type: 'string' },
              emailVerified: { type: 'boolean' },
            },
          },
          401: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.user;
      const user = await findUserById(userId);

      if (!user) {
        reply.code(401).send({ error: 'User not found' });
        return;
      }

      reply.send({
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        timeZone: user.timeZone,
        emailVerified: user.emailVerified,
      });
    }
  );

  // Logout
  app.post<{ Body: z.infer<typeof logoutSchema> }>(
    '/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Logout',
        description: 'Revoke refresh token',
        body: logoutSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        await revokeRefreshToken(request.body.refreshToken);
        reply.send({ success: true });
      } catch (error) {
        reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );

  // Refresh
  app.post<{ Body: z.infer<typeof refreshSchema> }>(
    '/auth/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Refresh tokens',
        description: 'Exchange refresh token for a new access + refresh token pair (rotation)',
        body: refreshSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await consumeRefreshToken(request.body.refreshToken);

        if (!session) {
          reply.code(401).send({ error: 'Invalid or expired refresh token' });
          return;
        }

        const user = await findUserById(session.userId.toString());
        if (!user) {
          reply.code(401).send({ error: 'User not found' });
          return;
        }

        const refreshExpiresAt = new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRY));
        const newRefreshToken = await createSession(user._id, refreshExpiresAt, session.deviceInfo);

        const accessToken = app.jwt.sign(
          { userId: user._id.toString(), role: user.role },
          { expiresIn: env.JWT_ACCESS_EXPIRY }
        );

        reply.send({ accessToken, refreshToken: newRefreshToken });
      } catch (error) {
        reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );

  // Forgot Password
  app.post<{ Body: z.infer<typeof forgotPasswordSchema> }>(
    '/auth/password/forgot',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['Auth'],
        summary: 'Forgot password',
        description: 'Request a password reset link. Always returns 200 to prevent email enumeration.',
        body: forgotPasswordSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        await generatePasswordResetToken(request.body.email);
        reply.send({ message: 'If the email exists, a reset link has been sent.' });
      } catch (error) {
        reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );

  // Reset Password
  app.post<{ Body: z.infer<typeof resetPasswordSchema> }>(
    '/auth/password/reset',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Reset password',
        description: 'Reset password using a valid reset token',
        body: resetPasswordSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const success = await resetPassword(request.body.token, request.body.password);

        if (!success) {
          reply.code(400).send({ error: 'Invalid or expired reset token' });
          return;
        }

        reply.send({ message: 'Password has been reset successfully.' });
      } catch (error) {
        reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );

  // Confirm Email
  app.post<{ Body: z.infer<typeof confirmEmailSchema> }>(
    '/auth/email/confirm',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Confirm email',
        description: 'Confirm email address using a verification token',
        body: confirmEmailSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const success = await confirmEmail(request.body.token);

        if (!success) {
          reply.code(400).send({ error: 'Invalid or expired verification token' });
          return;
        }

        reply.send({ message: 'Email confirmed successfully.' });
      } catch (error) {
        reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
};
