import { ObjectId } from 'mongodb';

export type TelegramSubscriber = {
  _id: ObjectId;
  chatId: number;
  username?: string;
  firstName?: string;
  instagramUsername: string;
  createdAt: Date;
  updatedAt: Date;
};
