# Panama Delivery Workflow

## 1. Confirm Baseline

Run `bash scripts/verify-baseline.sh` before starting a new round. If VPS access is available, include `VPS_HOST`, `VPS_USER`, `VPS_PATH`, and optionally `VPS_SSH_KEY` so local, `origin/main`, and deployed code are compared.

The full source-of-truth and release gate lives in [MAINLINE.md](MAINLINE.md).

## 2. Review Before Changing

For each module, create or update a file from `docs/MODULE_REVIEW_TEMPLATE.md`. Cover:

- route/auth gates
- data schemas and migrations
- frontend states, buttons, modals, and empty/error/loading states
- a11y labels and keyboard path
- role visibility and sensitive data handling
- tests that prove the fix

## 3. Fix In Small Batches

Keep each batch tied to a concrete finding. Prefer one module or one shared pattern per commit. Avoid unrelated refactors during a fix pass unless the refactor is needed to make the fix safe.

## 4. Verify

Use the narrowest fast tests first, then broaden:

```bash
npm run test:frontend -- src/pages/__tests__/ModuleName.test.jsx
npm test -- tests/unit/specific.test.js
npm run build
npm run test:golden
```

For route or database changes, run integration tests against a real test database:

```bash
npm run test:integration
```

## 5. Commit, Push, Deploy

Use a direct commit message that names the module and risk reduced. After pushing main, deploy to the VPS, run the smoke script, and record the deployed commit in `docs/CURRENT_BASELINE.md` when it becomes the new known-good baseline.

## 6. Tag Known-Good Releases

Tag only after local, main, and VPS all match and smoke checks pass:

```bash
git tag -a vYYYY.MM.DD-short-name -m "Known-good: short name"
git push origin vYYYY.MM.DD-short-name
```
