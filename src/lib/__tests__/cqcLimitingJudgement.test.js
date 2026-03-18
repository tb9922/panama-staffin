/**
 * Unit tests for CQC limiting-judgement scoring model.
 *
 * Validates: applyLimitingJudgement aggregation rules, per-question scoring,
 * KEY_QUESTIONS, METRIC_DEFINITIONS question assignments, ENGINE_VERSION.
 */

import { describe, it, expect } from 'vitest';
import {
  applyLimitingJudgement, SCORE_BANDS, KEY_QUESTIONS, METRIC_DEFINITIONS,
  getScoreBand, ENGINE_VERSION,
} from '../cqc.js';

describe('ENGINE_VERSION', () => {
  it('is v2', () => expect(ENGINE_VERSION).toBe('v2'));
});

describe('KEY_QUESTIONS', () => {
  it('has 5 CQC key questions', () => {
    expect(KEY_QUESTIONS).toEqual(['safe', 'effective', 'caring', 'responsive', 'well-led']);
  });
});

describe('METRIC_DEFINITIONS question assignments', () => {
  it('every metric has a question field', () => {
    for (const m of METRIC_DEFINITIONS) {
      expect(KEY_QUESTIONS).toContain(m.question);
    }
  });

  it('safe has the most metrics (7)', () => {
    expect(METRIC_DEFINITIONS.filter(m => m.question === 'safe').length).toBe(7);
  });

  it('effective has 4 metrics', () => {
    expect(METRIC_DEFINITIONS.filter(m => m.question === 'effective').length).toBe(4);
  });

  it('caring has 2 metrics', () => {
    expect(METRIC_DEFINITIONS.filter(m => m.question === 'caring').length).toBe(2);
  });

  it('responsive has 1 metric', () => {
    expect(METRIC_DEFINITIONS.filter(m => m.question === 'responsive').length).toBe(1);
  });

  it('well-led has 4 metrics', () => {
    expect(METRIC_DEFINITIONS.filter(m => m.question === 'well-led').length).toBe(4);
  });

  it('all 18 metrics are assigned', () => {
    expect(METRIC_DEFINITIONS.length).toBe(18);
  });

  it('weights still sum to 1.0', () => {
    const total = METRIC_DEFINITIONS.reduce((s, m) => s + m.weight, 0);
    expect(total).toBeCloseTo(1.0);
  });
});

describe('applyLimitingJudgement', () => {
  const outstanding = SCORE_BANDS[0]; // Outstanding
  const good = SCORE_BANDS[1];        // Good
  const ri = SCORE_BANDS[2];          // Requires Improvement
  const inadequate = SCORE_BANDS[3];  // Inadequate

  it('Outstanding: 2+ Outstanding + rest Good', () => {
    const result = applyLimitingJudgement({
      safe: outstanding, effective: outstanding, caring: good, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Outstanding');
  });

  it('Outstanding: 3 Outstanding + 2 Good', () => {
    const result = applyLimitingJudgement({
      safe: outstanding, effective: outstanding, caring: outstanding, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Outstanding');
  });

  it('NOT Outstanding: only 1 Outstanding (rest Good)', () => {
    const result = applyLimitingJudgement({
      safe: outstanding, effective: good, caring: good, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Good');
  });

  it('Good: all Good', () => {
    const result = applyLimitingJudgement({
      safe: good, effective: good, caring: good, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Good');
  });

  it('Good: 1 RI + rest Good (max 1 RI allowed)', () => {
    const result = applyLimitingJudgement({
      safe: good, effective: ri, caring: good, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Good');
  });

  it('Requires Improvement: 2 RI', () => {
    const result = applyLimitingJudgement({
      safe: ri, effective: ri, caring: good, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Requires Improvement');
  });

  it('Requires Improvement: 1 Inadequate + 1 RI', () => {
    const result = applyLimitingJudgement({
      safe: inadequate, effective: ri, caring: good, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Requires Improvement');
  });

  it('Inadequate: 2+ Inadequate', () => {
    const result = applyLimitingJudgement({
      safe: inadequate, effective: inadequate, caring: good, responsive: good, 'well-led': good,
    });
    expect(result.label).toBe('Inadequate');
  });

  it('Inadequate: all Inadequate', () => {
    const result = applyLimitingJudgement({
      safe: inadequate, effective: inadequate, caring: inadequate, responsive: inadequate, 'well-led': inadequate,
    });
    expect(result.label).toBe('Inadequate');
  });

  it('NOT Outstanding if any RI present (even with 2 Outstanding)', () => {
    const result = applyLimitingJudgement({
      safe: outstanding, effective: outstanding, caring: ri, responsive: good, 'well-led': good,
    });
    expect(result.label).not.toBe('Outstanding');
  });

  it('returns a SCORE_BANDS object with label, color, badgeKey', () => {
    const result = applyLimitingJudgement({
      safe: good, effective: good, caring: good, responsive: good, 'well-led': good,
    });
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('color');
    expect(result).toHaveProperty('badgeKey');
  });
});
