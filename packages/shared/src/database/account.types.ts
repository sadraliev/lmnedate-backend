import { ObjectId } from 'mongodb';

export type Account = {
  _id: ObjectId;
  instagramUsername: string;
  addedBy: number;
  lastScrapedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
