# QA Walkthrough Checklist

Run this before a release or after a large cross-module change. The goal is not
exhaustiveness; it is to catch product-level breakage quickly with one focused
manual pass.

## 1. Shell and auth

- Log in as an admin and confirm the dashboard loads without an inline error state.
- Switch to `e2e-test-home` (or the target pilot home) and confirm the shell remounts cleanly.
- Open and close the sidebar on mobile width and desktop width.
- Trigger the notifications panel and confirm it opens and closes cleanly.
- Open the change-password modal and confirm focus stays trapped inside it.

## 2. Scheduling

- Open `Roster` and confirm the grid renders with the expected month and filters.
- Click a rota cell, change a shift, and confirm the impact panel updates before save.
- Revert that change and confirm the scheduled value returns.
- Open `Daily Status` for today, add `SICK`, and confirm the staff member moves to the Sick list.
- Add `No Show` on a known working day and confirm the staff member moves to the No Show list.
- Add `Annual Leave` on a known working day and confirm it lands in the Annual Leave list.
- Add an agency booking and confirm the cost panel updates.
- Add a sleep-in and confirm the `SI` badge appears.
- Reload `Daily Status` and confirm all saved overrides persist.

## 3. Annual leave

- Open `Annual Leave` and book one day for a staff member with remaining entitlement.
- Confirm the success message renders inline and the page stays mounted.
- Confirm the booking appears in `Upcoming AL Bookings`.
- Cancel the booking and confirm the confirmation dialog appears before deletion.
- Re-open the page and confirm the cancelled booking is gone.

## 4. Staff database and portal admin

- Open `Staff Database` and confirm the Add Staff modal opens and validates required fields.
- Edit an existing staff member inline and confirm Save persists the change.
- Use `Invite` for a staff member and confirm the invite modal shows a usable setup link.
- Use `Revoke` for a staff member and confirm the success message appears.

## 5. Staff portal

- Complete an invite setup flow for a test staff member.
- Log in as that staff member and confirm the staff dashboard loads.
- Open `My Schedule`, `My Leave`, `My Payslips`, `My Training`, and `My Profile`.
- Submit a leave request and confirm it appears in the staff request list.
- Cancel a pending leave request and confirm the confirmation dialog appears.
- Change the staff password and confirm re-login works with the new password.

## 6. Incidents and compliance

- Open `Incidents`, create a new incident, and confirm it appears in the table.
- Re-open the incident and confirm the saved values persisted.
- Open the incident modal and confirm required fields show visible errors instead of failing silently.
- Open one modal-heavy compliance page (for example `DoLS` or `Maintenance`) and save a valid record.

## 7. Clock-in and attendance

- As staff, record a clock-in and clock-out.
- As manager, open `Clock In Audit` and confirm the entries are visible.
- Approve the entries and confirm the status updates without a page error.

## 8. Finance and exports

- Open `Payroll Detail` and confirm the run page loads with KPI cards and tables.
- Export one payroll artifact and confirm the download starts.
- Open `Residents` or finance billing, create or edit one record, and confirm the save persists.

## 9. Documents and scan intake

- Upload one attachment through a direct file-attachment flow.
- Use one contextual scan path and confirm the item lands in the expected module.
- Download the uploaded file and confirm the file opens.

## 10. Final safety checks

- Run `npm run lint`.
- Run `npm run test:frontend -- --maxWorkers=1`.
- Run `npx playwright test tests/e2e/module-smoke.spec.js tests/e2e/a11y.spec.js --project=chromium --workers=1`.
- If visual baselines changed intentionally, rerun `npx playwright test tests/e2e/visual-smoke.spec.js --project=chromium --update-snapshots`.
