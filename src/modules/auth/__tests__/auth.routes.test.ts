import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { setupTestDatabase } from '../../../shared/testing/setup.js';
import { createServer } from '../../../server.js';
import { hashToken } from '../../../shared/utils/crypto.js';
import * as connection from '../../../shared/database/connection.js';
import type { FastifyInstance } from 'fastify';
import type { User } from '../auth.types.js';

describe('Auth Routes Integration', () => {
  const getDb = setupTestDatabase();
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.spyOn(connection, 'getDatabase').mockReturnValue(getDb());
    app = await createServer();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const registerUser = (overrides = {}) =>
    app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        role: 'user',
        timeZone: 'America/New_York',
        ...overrides,
      },
    });

  describe('POST /auth/register', () => {
    it('should return accessToken, refreshToken, and user with emailVerified=false', async () => {
      const response = await registerUser();

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.emailVerified).toBe(false);
      expect(body.user.password).toBeUndefined();
      expect(body.user.passwordHash).toBeUndefined();
    });

    it('should reject duplicate email with 409', async () => {
      await registerUser();
      const response = await registerUser();

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('User with this email already exists');
    });

    it('should validate required fields with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('should return tokens and user on valid credentials', async () => {
      await registerUser();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com', password: 'password123' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
    });

    it('should reject bad credentials with 401', async () => {
      await registerUser();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com', password: 'wrongpassword' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid email or password');
    });

    it('should lock account after 5 failed attempts and return 423', async () => {
      await registerUser();

      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'test@example.com', password: 'wrong' },
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com', password: 'password123' },
      });

      expect(response.statusCode).toBe(423);
    });
  });

  describe('GET /auth/me', () => {
    it('should return profile with emailVerified', async () => {
      const regResponse = await registerUser();
      const { accessToken } = JSON.parse(regResponse.body);

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.email).toBe('test@example.com');
      expect(body.emailVerified).toBe(false);
      expect(body.passwordHash).toBeUndefined();
    });

    it('should reject request without token with 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject request with invalid token with 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: 'Bearer invalid-token' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('should invalidate refresh token', async () => {
      const regResponse = await registerUser();
      const { refreshToken } = JSON.parse(regResponse.body);

      const logoutResponse = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken },
      });

      expect(logoutResponse.statusCode).toBe(200);
      const body = JSON.parse(logoutResponse.body);
      expect(body.success).toBe(true);

      // Subsequent refresh should fail
      const refreshResponse = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });

      expect(refreshResponse.statusCode).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should return new token pair', async () => {
      const regResponse = await registerUser();
      const { refreshToken } = JSON.parse(regResponse.body);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.refreshToken).not.toBe(refreshToken); // Rotation
    });

    it('should invalidate old token after rotation', async () => {
      const regResponse = await registerUser();
      const { refreshToken } = JSON.parse(regResponse.body);

      // First refresh succeeds
      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });

      // Second refresh with same token fails
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid refresh token with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'invalid-token' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/password/forgot', () => {
    it('should return 200 for existing email', async () => {
      await registerUser();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/password/forgot',
        payload: { email: 'test@example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('If the email exists');
    });

    it('should return 200 for non-existing email (prevent enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/password/forgot',
        payload: { email: 'nonexistent@example.com' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /auth/password/reset', () => {
    it('should reset password with valid token and allow login with new password', async () => {
      await registerUser();

      // Set a known reset token
      const rawToken = 'reset-integration-test-token123';
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: 'test@example.com' },
          {
            $set: {
              resetTokenHash: hashToken(rawToken),
              resetTokenExpiresAt: new Date(Date.now() + 3600000),
            },
          }
        );

      const response = await app.inject({
        method: 'POST',
        url: '/auth/password/reset',
        payload: { token: rawToken, password: 'newpassword123' },
      });

      expect(response.statusCode).toBe(200);

      // Login with new password
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com', password: 'newpassword123' },
      });

      expect(loginResponse.statusCode).toBe(200);
    });

    it('should reject invalid token with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/password/reset',
        payload: { token: 'invalid-token', password: 'newpassword123' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /auth/email/confirm', () => {
    it('should confirm email with valid token', async () => {
      const regResponse = await registerUser();
      const { accessToken } = JSON.parse(regResponse.body);

      // We can't recover the raw token from the hash, so set a known one
      const rawToken = 'confirm-integration-test-token1';
      await getDb()
        .collection<User>('users')
        .updateOne(
          { email: 'test@example.com' },
          {
            $set: {
              emailVerificationTokenHash: hashToken(rawToken),
              emailVerificationTokenExpiresAt: new Date(Date.now() + 86400000),
            },
          }
        );

      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/confirm',
        payload: { token: rawToken },
      });

      expect(response.statusCode).toBe(200);

      // Verify emailVerified is now true via /me
      const meResponse = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const meBody = JSON.parse(meResponse.body);
      expect(meBody.emailVerified).toBe(true);
    });

    it('should reject invalid token with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/email/confirm',
        payload: { token: 'invalid-token' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
