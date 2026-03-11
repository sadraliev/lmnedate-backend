import { describe, it, expect } from 'vitest';
import { extractHashtags, extractMentions } from '../caption-utils.js';

describe('extractHashtags', () => {
  it('extracts hashtags from caption', () => {
    expect(extractHashtags('Hello #world #travel')).toEqual(['world', 'travel']);
  });

  it('returns lowercased tags', () => {
    expect(extractHashtags('#Hello #WORLD')).toEqual(['hello', 'world']);
  });

  it('deduplicates tags', () => {
    expect(extractHashtags('#food #Food #FOOD')).toEqual(['food']);
  });

  it('returns empty array for no hashtags', () => {
    expect(extractHashtags('no tags here')).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(extractHashtags(undefined)).toEqual([]);
  });

  it('handles cyrillic hashtags', () => {
    expect(extractHashtags('#москва #алматы')).toEqual(['москва', 'алматы']);
  });

  it('strips the # symbol', () => {
    const result = extractHashtags('#test');
    expect(result[0]).not.toContain('#');
  });
});

describe('extractMentions', () => {
  it('extracts mentions from caption', () => {
    expect(extractMentions('Thanks @john and @jane')).toEqual(['john', 'jane']);
  });

  it('returns lowercased mentions', () => {
    expect(extractMentions('@John @JANE')).toEqual(['john', 'jane']);
  });

  it('deduplicates mentions', () => {
    expect(extractMentions('@user @User @USER')).toEqual(['user']);
  });

  it('returns empty array for no mentions', () => {
    expect(extractMentions('no mentions')).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(extractMentions(undefined)).toEqual([]);
  });

  it('handles usernames with dots', () => {
    expect(extractMentions('@user.name')).toEqual(['user.name']);
  });

  it('strips the @ symbol', () => {
    const result = extractMentions('@test');
    expect(result[0]).not.toContain('@');
  });
});
