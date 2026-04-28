# Panama V1 OS Release Gates

Use this before each weekly merge from `v1-os` to `main`.

## Technical Gates

- `npm run lint`
- `npm run build`
- `npm run test:ci`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run audit:routes`
- `npm run verify:action-backfill`
- `npm run verify:v1-operational`
- `npm audit --omit=dev`

## Operational Gates

- Migrations run cleanly on a disposable database.
- Portfolio dashboard is checked with at least three homes of seed/live-like data.
- Escalation cron is tested with simulated overdue dates.
- Action-item backfill has `expected = matched` for every legacy source.
- Portfolio board pack PDF is generated for a full week and reviewed.
- Emergency agency override report is reviewed; more than 20% emergency overrides is treated as red.
- Teddy signs off one feature end-to-end manually each week.
- No blocker is deferred silently.
- External CQC inspector or quality consultant reviews the evidence pack and board pack before V1 close.

## Week-4 Legacy Action Freeze

Before freezing legacy corrective-action fields:

1. Run `npm run verify:action-backfill`.
2. Spot-check at least 10 random legacy action rows against `action_items`.
3. Confirm new/edit workflows write through `action_items`.
4. Turn on service-layer legacy write guards only after the checks above are clean.
5. Set `V1_LEGACY_ACTION_FREEZE=1` in the target environment and re-run the affected legacy action routes against empty/no-action payloads.

## External Quality Review Evidence

Before V1 close, store the signed review notes or email reference against the release record:

- Reviewer name, role, and organisation.
- Date reviewed.
- Board-pack period reviewed.
- Homes covered.
- Findings that must be fixed before go-live.
- Findings accepted for a later iteration.
- Teddy sign-off that the board pack answers the operational question: "is each home under control, or hiding chaos?"
