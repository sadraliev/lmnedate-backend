import { getDatabase } from './connection.js';
import type { InstagramPost } from './post.types.js';

export const ensurePostIndexes = async (): Promise<void> => {
  const db = getDatabase();
  await db.collection('instagram_posts').createIndex(
    { instagramUsername: 1, postId: 1 },
    { unique: true },
  );
  await db.collection('instagram_posts').createIndex({ instagramUsername: 1, timestamp: -1 });
};

export const storeNewPosts = async (posts: Omit<InstagramPost, '_id'>[]): Promise<InstagramPost[]> => {
  if (posts.length === 0) return [];

  const db = getDatabase();
  const stored: InstagramPost[] = [];

  for (const post of posts) {
    try {
      const result = await db.collection<InstagramPost>('instagram_posts').insertOne(post as InstagramPost);
      stored.push({ ...post, _id: result.insertedId } as InstagramPost);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        continue;
      }
      throw error;
    }
  }

  return stored;
};

export const getNewPostsSince = async (
  instagramUsername: string,
  lastPostId?: string,
): Promise<InstagramPost[]> => {
  const db = getDatabase();

  if (!lastPostId) {
    return db.collection<InstagramPost>('instagram_posts')
      .find({ instagramUsername })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();
  }

  const lastPost = await db.collection<InstagramPost>('instagram_posts').findOne({
    instagramUsername,
    postId: lastPostId,
  });

  if (!lastPost) {
    return db.collection<InstagramPost>('instagram_posts')
      .find({ instagramUsername })
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();
  }

  return db.collection<InstagramPost>('instagram_posts')
    .find({
      instagramUsername,
      timestamp: { $gt: lastPost.timestamp },
    })
    .sort({ timestamp: 1 })
    .toArray();
};
