import { ObjectId } from 'mongodb';
import type { ScrapedPost } from '@app/shared';

export type TelegramUser = {
  _id: ObjectId;
  chatId: number;
  username?: string;
  firstName?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Subscription = {
  _id: ObjectId;
  chatId: number;
  instagramUsername: string;
  lastPostId?: string;
  lastCheckedAt?: Date;
  isActive: boolean;
  errorCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type InstagramPost = ScrapedPost & {
  _id: ObjectId;
};
