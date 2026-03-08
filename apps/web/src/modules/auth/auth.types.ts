import { ObjectId } from 'mongodb';

export type UserRole = 'admin' | 'user';

export type User = {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: UserRole;
  name: string;
  timeZone: string;
  pushToken?: string;
  emailVerified: boolean;
  emailVerificationTokenHash?: string;
  emailVerificationTokenExpiresAt?: Date;
  lastLoginAt?: Date;
  loginAttempts: number;
  lockedUntil?: Date;
  resetTokenHash?: string;
  resetTokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type Session = {
  _id: ObjectId;
  userId: ObjectId;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceInfo?: string;
  createdAt: Date;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    timeZone: string;
    emailVerified: boolean;
  };
};

export type RefreshRequest = {
  refreshToken: string;
};

export type LogoutRequest = {
  refreshToken: string;
};

export type ForgotPasswordRequest = {
  email: string;
};

export type ResetPasswordRequest = {
  token: string;
  password: string;
};

export type ConfirmEmailRequest = {
  token: string;
};
