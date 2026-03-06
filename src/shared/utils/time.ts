import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

/**
 * Convert a date to a specific time zone
 */
export const toTimeZone = (date: Date, timeZone: string): Date => {
  return toZonedTime(date, timeZone);
};

/**
 * Format a date in a specific time zone
 */
export const fmt = (
  date: Date,
  timeZone: string,
  formatStr: string = "yyyy-MM-dd'T'HH:mm:ssXXX"
): string => {
  return formatInTimeZone(date, timeZone, formatStr);
};

/**
 * Check if a time zone is valid
 */
export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a date has expired
 */
export const isExpired = (date: Date): boolean => {
  return date < new Date();
};

/**
 * Parse a duration string like "15m", "7d", "1h" to milliseconds.
 */
export const parseDurationMs = (duration: string): number => {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
};
