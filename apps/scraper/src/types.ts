export interface ScrapedPost {
  instagramUsername: string;
  postId: string;
  caption?: string;
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'carousel';
  permalink: string;
  timestamp: Date;
  createdAt: Date;
}
