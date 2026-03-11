import { ObjectId } from 'mongodb';
import type { ScrapedPost } from '../post-types.js';

export type InstagramPost = ScrapedPost & {
  _id: ObjectId;
};
