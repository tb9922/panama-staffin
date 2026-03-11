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

// ── Config validation ─────────────────────────────────────────────────────────
// Validates safety-critical fields that affect coverage calculation, NLW
// compliance, and scheduling limits. Other config fields pass through unchecked.

// NOTE: .passthrough() is intentional on all three schemas below.
// The config object contains 30+ fields (home_name, registered_beds, care_type,
// bank_holidays, training_types, supervision_frequency_*, incident_types,
// complaint_categories, maintenance_categories, ipc_audit_types, etc.) that are
// NOT declared here. Only safety-critical fields are type-checked; everything
// else must pass through unchanged. Switching to .strip() would silently delete
// all unlisted config fields — a data-destroying bug.

const staffingPeriodSchema = z.object({
  heads: z.number().int().min(0),
  skill_points: z.number().min(0),
}).passthrough();

const shiftDefSchema = z.object({
  hours: z.number().positive(),
}).passthrough();

/**
 * Schema for the inner config object. Safety-critical fields are type-checked;
 * everything else passes through to support new features without schema changes.
 * .passthrough() is required — see note above.
 */
export const homeConfigSchema = z.object({
  minimum_staffing: z.object({
    early:  staffingPeriodSchema,
    late:   staffingPeriodSchema,
    night:  staffingPeriodSchema,
  }).optional(),
  nlw_rate: z.number().positive().optional(),
  shifts: z.record(z.string(), shiftDefSchema).optional(),
  max_consecutive_days: z.number().int().min(1).max(14).optional(),
  max_al_same_day: z.number().int().min(1).optional(),
  cycle_start_date: dateStr.optional(),
  leave_year_start: z.string().regex(/^\d{2}-\d{2}$/).optional(),
  agency_rate_day: z.number().min(0).optional(),
  agency_rate_night: z.number().min(0).optional(),
  ot_premium: z.number().min(0).optional(),
  bh_premium_multiplier: z.number().min(1).optional(),
}).passthrough();
