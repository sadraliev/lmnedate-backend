/**
 * Extract deduplicated, lowercased hashtags from a caption (without #)
 */
export const extractHashtags = (caption: string | undefined): string[] => {
  if (!caption) return [];
  const matches = caption.match(/#([\w\u0400-\u04FF]+)/g);
  if (!matches) return [];
  const tags = matches.map((m) => m.slice(1).toLowerCase());
  return [...new Set(tags)];
};

/**
 * Extract deduplicated, lowercased mentions from a caption (without @)
 */
export const extractMentions = (caption: string | undefined): string[] => {
  if (!caption) return [];
  const matches = caption.match(/@([\w.]+)/g);
  if (!matches) return [];
  const mentions = matches.map((m) => m.slice(1).toLowerCase());
  return [...new Set(mentions)];
};
