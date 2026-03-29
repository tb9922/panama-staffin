import { z } from 'zod';

function blankToNull(value) {
  return value === '' ? null : value;
}

export function isValidIsoDateOnly(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const isoDateCore = z
  .string()
  .max(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
  .refine(isValidIsoDateOnly, 'Invalid calendar date');

export const isoDateRequired = isoDateCore;
export const isoDateNullable = isoDateCore.nullable();
export const requiredDateInput = z.preprocess(blankToNull, isoDateRequired);
export const nullableDateInput = z.preprocess(blankToNull, isoDateNullable);

// Backwards-compatible aliases for existing callers.
export const dateStr = isoDateNullable;
export const dateStrRequired = isoDateRequired;

export const timeStr = z.string().max(5).regex(/^\d{2}:\d{2}$/, 'Invalid time format').nullable();
export const timeStrRequired = z.string().max(5).regex(/^\d{2}:\d{2}$/, 'Invalid time format');

export const shortText = z.string().max(200);
export const mediumText = z.string().max(2000);
export const longText = z.string().max(5000);
export const idStr = z.string().max(50);

const staffingPeriodSchema = z.object({
  heads: z.number().int().min(0),
  skill_points: z.number().min(0),
}).passthrough();

const shiftDefSchema = z.object({
  hours: z.number().positive(),
}).passthrough();

export const homeConfigSchema = z.object({
  minimum_staffing: z.object({
    early: staffingPeriodSchema,
    late: staffingPeriodSchema,
    night: staffingPeriodSchema,
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
