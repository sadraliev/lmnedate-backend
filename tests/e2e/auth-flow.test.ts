import { describe, it, expect } from 'vitest';
import { setupE2E, apiRequest, verifyInDatabase } from './setup.js';

describe('Auth Flow E2E', () => {
  const { getDb } = setupE2E();

  const testUser = {
    email: 'e2e@example.com',
    password: 'password123',
    name: 'E2E User',
    role: 'user',
    timeZone: 'America/New_York',
  };

  it('should register, login, access profile, refresh, and logout', async () => {
    // 1. Register
    const register = await apiRequest('POST', '/auth/register', { body: testUser });
    expect(register.status).toBe(201);
    expect(register.body.accessToken).toBeDefined();
    expect(register.body.refreshToken).toBeDefined();
    expect(register.body.user.email).toBe(testUser.email);
    expect(register.body.user.emailVerified).toBe(false);

    const { accessToken, refreshToken } = register.body;

    // 2. Get profile
    const me = await apiRequest('GET', '/auth/me', { token: accessToken });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(testUser.email);
    expect(me.body.name).toBe(testUser.name);

    // 3. Login with same credentials
    const login = await apiRequest('POST', '/auth/login', {
      body: { email: testUser.email, password: testUser.password },
    });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeDefined();
    expect(login.body.refreshToken).toBeDefined();

    // 4. Refresh token
    const refresh = await apiRequest('POST', '/auth/refresh', {
      body: { refreshToken },
    });
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();
    expect(refresh.body.refreshToken).toBeDefined();
    expect(refresh.body.refreshToken).not.toBe(refreshToken); // rotation

    // 5. Old refresh token is consumed (rotation)
    const refreshAgain = await apiRequest('POST', '/auth/refresh', {
      body: { refreshToken },
    });
    expect(refreshAgain.status).toBe(401);

    // 6. Logout with new refresh token
    const logout = await apiRequest('POST', '/auth/logout', {
      body: { refreshToken: refresh.body.refreshToken },
    });
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);

    // 7. Refresh after logout fails
    const refreshAfterLogout = await apiRequest('POST', '/auth/refresh', {
      body: { refreshToken: refresh.body.refreshToken },
    });
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('should reject duplicate registration', async () => {
    await apiRequest('POST', '/auth/register', { body: testUser });
    const duplicate = await apiRequest('POST', '/auth/register', { body: testUser });
    expect(duplicate.status).toBe(409);
  });

  it('should reject login with wrong password', async () => {
    await apiRequest('POST', '/auth/register', { body: testUser });
    const login = await apiRequest('POST', '/auth/login', {
      body: { email: testUser.email, password: 'wrongpassword' },
    });
    expect(login.status).toBe(401);
  });

  it('should reject unauthenticated profile access', async () => {
    const me = await apiRequest('GET', '/auth/me');
    expect(me.status).toBe(401);
  });

  it('should handle password reset flow', async () => {
    await apiRequest('POST', '/auth/register', { body: testUser });

    // Request reset
    const forgot = await apiRequest('POST', '/auth/password/forgot', {
      body: { email: testUser.email },
    });
    expect(forgot.status).toBe(200);

    // Get token from DB
    const dbUser = await verifyInDatabase('users', { email: testUser.email });
    expect(dbUser.resetTokenHash).toBeDefined();
  });

  it('should handle email confirmation flow', async () => {
    const register = await apiRequest('POST', '/auth/register', { body: testUser });
    const { accessToken } = register.body;

    // Verify emailVerified is false
    const meBefore = await apiRequest('GET', '/auth/me', { token: accessToken });
    expect(meBefore.body.emailVerified).toBe(false);

    // Get verification token hash from DB
    const dbUser = await verifyInDatabase('users', { email: testUser.email });
    expect(dbUser.emailVerificationTokenHash).toBeDefined();
  });

  it('should return 200 for forgot password with non-existent email', async () => {
    const forgot = await apiRequest('POST', '/auth/password/forgot', {
      body: { email: 'nonexistent@example.com' },
    });
    expect(forgot.status).toBe(200); // prevents email enumeration
  });

  it('should return health check', async () => {
    const health = await apiRequest('GET', '/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
  });
});
