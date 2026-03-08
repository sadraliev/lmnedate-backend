import { ObjectId } from 'mongodb';

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

export type InstagramPost = {
  _id: ObjectId;
  instagramUsername: string;
  postId: string;
  caption?: string;
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'carousel';
  permalink: string;
  timestamp: Date;
  createdAt: Date;
};
