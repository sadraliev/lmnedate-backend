export interface CarouselMediaItem {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  videoUrl?: string;
}

export interface ScrapedPost {
  instagramUsername: string;
  postId: string;
  caption?: string;
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'carousel';
  permalink: string;
  timestamp: Date;
  createdAt: Date;
  // Analytics
  likesCount?: number;
  commentsCount?: number;
  videoViewsCount?: number;
  // Reposting
  videoUrl?: string;
  carouselMedia?: CarouselMediaItem[];
  // Caption
  hashtags?: string[];
  mentions?: string[];
  // Metadata
  location?: string;
}
