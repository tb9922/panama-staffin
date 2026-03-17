/**
 * payRateConsistency.js — Compares escalation config (ot_premium, bh_premium_multiplier)
 * against DB-backed pay_rate_rules to surface divergence between the two cost models.
 *
 * Pure helper — no DB access, no side effects. Used by:
 *   routes/payroll.js GET /rates/consistency → feeds PayRatesConfig + Config banners
 */

/**
 * Check consistency between home config cost settings and active pay rate rules.
 *
 * @param {Object} config - Home config (ot_premium, bh_premium_multiplier)
 * @param {Array}  activeRules - Active pay_rate_rules rows from DB
 * @returns {{ consistent: boolean, warnings: Array<{ field: string, message: string, configValue: number, rulesValue: number|null }> }}
 */
export function checkConsistency(config, activeRules) {
  const warnings = [];

  if (!config || !activeRules) {
    return { consistent: true, warnings };
  }

  // --- On-call / OT premium comparison ---
  const onCallRules = activeRules.filter(r => r.applies_to === 'on_call' && r.effective_to == null);
  const configOtPremium = parseFloat(config.ot_premium) || 0;

  if (onCallRules.length === 1) {
    const rule = onCallRules[0];
    if (rule.rate_type === 'fixed_hourly') {
      const ruleAmount = parseFloat(rule.amount) || 0;
      if (Math.abs(configOtPremium - ruleAmount) > 0.001) {
        warnings.push({
          field: 'ot_premium',
          message: `Extra Shift Premium in Pay Rate Rules is \u00A3${ruleAmount.toFixed(2)}/hr, but Home Settings OT Premium is \u00A3${configOtPremium.toFixed(2)}/hr. CostTracker uses the Home Settings value; Payroll uses Pay Rate Rules.`,
          configValue: configOtPremium,
          rulesValue: ruleAmount,
        });
      }
    } else {
      // Non-fixed_hourly on_call rule — structural mismatch, can't compare directly
      warnings.push({
        field: 'ot_premium',
        message: `Extra Shift Premium rule uses "${rule.rate_type}" rate type, but Home Settings OT Premium is a flat \u00A3/hr value. These cannot be compared directly.`,
        configValue: configOtPremium,
        rulesValue: null,
      });
    }
  } else if (onCallRules.length > 1) {
    // Multiple stacked on_call rules — structural mismatch
    warnings.push({
      field: 'ot_premium',
      message: `${onCallRules.length} active Extra Shift Premium rules found in Pay Rate Rules. Home Settings uses a single OT Premium value (\u00A3${configOtPremium.toFixed(2)}/hr). Compare Pay Rate Rules and Home Settings manually.`,
      configValue: configOtPremium,
      rulesValue: null,
    });
  }
  // onCallRules.length === 0: no rules seeded yet — no warning (avoid noise before first payroll access)

  // --- Bank holiday premium comparison ---
  const bhRules = activeRules.filter(r => r.applies_to === 'bank_holiday' && r.effective_to == null);
  const configBhMultiplier = parseFloat(config.bh_premium_multiplier) || 0;
  // Config stores multiplier (e.g. 1.5 = 50% premium), rules store percentage (e.g. 50)
  const configBhPct = (configBhMultiplier - 1) * 100;

  if (bhRules.length === 1) {
    const rule = bhRules[0];
    if (rule.rate_type === 'percentage') {
      const ruleAmount = parseFloat(rule.amount) || 0;
      if (Math.abs(configBhPct - ruleAmount) > 0.1) {
        warnings.push({
          field: 'bh_premium_multiplier',
          message: `Bank Holiday Premium in Pay Rate Rules is ${ruleAmount}%, but Home Settings BH multiplier is ${configBhMultiplier}x (=${configBhPct.toFixed(0)}%). CostTracker uses the Home Settings value; Payroll uses Pay Rate Rules.`,
          configValue: configBhMultiplier,
          rulesValue: ruleAmount,
        });
      }
    } else {
      warnings.push({
        field: 'bh_premium_multiplier',
        message: `Bank Holiday rule uses "${rule.rate_type}" rate type, but Home Settings uses a percentage multiplier. These cannot be compared directly.`,
        configValue: configBhMultiplier,
        rulesValue: null,
      });
    }
  } else if (bhRules.length > 1) {
    warnings.push({
      field: 'bh_premium_multiplier',
      message: `${bhRules.length} active Bank Holiday rules found in Pay Rate Rules. Home Settings uses a single BH multiplier (${configBhMultiplier}x). Compare Pay Rate Rules and Home Settings manually.`,
      configValue: configBhMultiplier,
      rulesValue: null,
    });
  }

  return {
    consistent: warnings.length === 0,
    warnings,
  };
}
