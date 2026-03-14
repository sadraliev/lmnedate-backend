export interface ScrapeJobData {
  username: string;
}

import type { CarouselMediaItem } from './post-types.js';

export interface DeliverJobData {
  chatId: number;
  scrapedInMs?: number;
  post?: {
    instagramUsername: string;
    caption?: string;
    mediaUrl: string;
    mediaType: 'image' | 'video' | 'carousel';
    permalink: string;
    videoUrl?: string;
    carouselMedia?: CarouselMediaItem[];
  };
  error?: string;
}
