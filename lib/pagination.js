import { z } from 'zod';

/**
 * Shared pagination utilities.
 *
 * Query pattern: append  COUNT(*) OVER() AS _total, LIMIT $N OFFSET $M
 * Repo returns:  paginateResult(rows, shaper)  →  { rows: [...], total: N }
 */

/** Zod schema for ?limit= & ?offset= query params (coerce from string). */
export const paginationSchema = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Transform raw DB rows (with _total window column) into { rows, total }.
 *
 * @param {Array}    rows   — raw rows from a query with COUNT(*) OVER() AS _total
 * @param {Function} shaper — row transformation function (e.g. shapeRow)
 * @returns {{ rows: Array, total: number }}
 */
export function paginateResult(rows, shaper) {
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return {
    rows: rows.map(r => {
      const { _total, ...rest } = r;
      return shaper ? shaper(rest) : rest;
    }),
    total,
  };
}
