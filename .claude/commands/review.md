---
allowed-tools: Bash(node:*), Read, Grep, Glob
description: Compliance and competitive gap review
---

## Your task

Evaluate the app's current state against UK care home requirements and competitive standards. Check:

### 1. NLW Compliance
- Read the home data file(s) in `homes/` directory
- Check every staff member's `hourly_rate` >= 12.21 (UK NLW 2025-26)
- Report any staff below minimum

### 2. CQC Safe Staffing (Regulation 18)
- Check `config.minimum_staffing` is configured for early/late/night
- Verify heads and skill_points thresholds are set and reasonable
- Check `max_consecutive_days` is set (should be 5-7)

### 3. Bank Holidays
- Check `config.bank_holidays` array exists and has entries
- Verify dates cover the current year

### 4. Data Integrity
- Check all staff have required fields (id, name, role, team, hourly_rate, skill)
- Check for duplicate staff IDs
- Check overrides reference valid staff IDs

### 5. Competitive Gap Summary
List features present vs missing compared to RotaCloud/CoolCare/Deputy:
- Present: rotation engine, escalation, costs, AL, fatigue, scenarios, PDF reports
- Missing: mobile app, notifications, payroll integration, time & attendance, staff self-service, DBS tracking, shift swap

Report findings as a clear summary with any action items.
