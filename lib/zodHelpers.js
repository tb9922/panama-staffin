import { z } from 'zod';

/**
 * Shared Zod schemas for common field types.
 *
 * Replaces per-file dateSchema / timeSchema definitions,
 * ensuring consistent max-length + regex constraints everywhere.
 */

/** ISO date string "YYYY-MM-DD", nullable. */
export const dateStr = z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').nullable();

/** ISO date string "YYYY-MM-DD", required (non-nullable). */
export const dateStrRequired = z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format');

/** Time string "HH:MM", nullable. */
export const timeStr = z.string().max(5).regex(/^\d{2}:\d{2}$/, 'Invalid time format').nullable();

/** Time string "HH:MM", required (non-nullable). */
export const timeStrRequired = z.string().max(5).regex(/^\d{2}:\d{2}$/, 'Invalid time format');

/** Short text — up to 200 chars (names, titles, references). */
export const shortText = z.string().max(200);

/** Medium text — up to 2000 chars (descriptions, notes). */
export const mediumText = z.string().max(2000);

/** Long text — up to 5000 chars (investigation findings, detailed notes). */
export const longText = z.string().max(5000);

/** ID string — up to 50 chars (UUIDs, slugs, reference numbers). */
export const idStr = z.string().max(50);
