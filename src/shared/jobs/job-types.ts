export interface ScrapeJobData {
  username: string;
  chatId: number;
  enqueuedAt: string;
}

export interface DeliverJobData {
  chatId: number;
  post?: {
    instagramUsername: string;
    caption?: string;
    mediaUrl: string;
    mediaType: 'image' | 'video' | 'carousel';
    permalink: string;
  };
  error?: string;
}
