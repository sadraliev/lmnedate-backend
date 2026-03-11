import { ObjectId } from 'mongodb';

export type AccountStatus = 'scrapeable' | 'unscrapeable';

export type Account = {
  _id: ObjectId;
  instagramUsername: string;
  addedBy: number;
  status: AccountStatus;
  lastScrapedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
