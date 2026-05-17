# Export Schemas

Panama Staffing supports CSV, JSON, and Excel exports from various modules.

---

## Payroll CSV Exports

Generated from `Reports > Monthly Cost Report` or via the Payroll module's export button.

### Sage Format

| Column | Type | Description |
|--------|------|-------------|
| Staff_Name | String | Full name |
| NI_Number | String | UK National Insurance number (blank if not set) |
| Tax_Code | String | PAYE tax code used for the run |
| Student_Loan_Plan | String | Student loan plan code, if present |
| Pay_Period_Start / Pay_Period_End | Date | Run period |
| Basic/Night/Weekend/Bank Holiday/Overtime/Sleep-in/On-call columns | Decimal | Hours and pay/enhancement breakdown |
| Total_Gross_Pay | Decimal | Gross pay including holiday pay and SSP |
| Ref:* columns | Decimal | Panama-estimated PAYE, NI, pension, student loan, net pay and YTD cross-checks |

### Xero Format

| Column | Type | Description |
|--------|------|-------------|
| PayrollCalendarID | String | Always "MONTHLY" |
| EmployeeID | String | Staff ID |
| EmployeeName | String | Full name |
| EarningsRateID | String | Rate type: "ORDINARY" or "OVERTIME" |
| NumberOfUnits | Decimal | Hours worked |
| RatePerUnit | Decimal | Hourly rate |
| GrossPay | Decimal | Gross pay including holiday pay and SSP |
| PayPeriodStart / PayPeriodEnd | Date | Run period |

### Generic Format

| Column | Type | Description |
|--------|------|-------------|
| staff_id | String | Staff ID |
| name | String | Full name |
| role | String | Staff role |
| team | String | Team name |
| hours | Decimal | Total hours |
| base_pay | Decimal | Base pay amount |
| ot_premium | Decimal | Overtime premium |
| bh_premium | Decimal | Bank holiday premium |
| total | Decimal | Total pay |

---

## JSON Export

`GET /api/export?home=X` returns the complete home data object as JSON. Structure matches the data model documented in CLAUDE.md.

Fields included: `config`, `staff`, `overrides`, `training`, `supervisions`, `appraisals`, `fire_drills`, `incidents`, `complaints`, `complaint_surveys`, `maintenance`, `ipc_audits`, `risk_register`, `policy_reviews`, `whistleblowing_concerns`, `dols`, `mca_assessments`, `care_certificate`, `cqc_evidence`, `budget`.

**Note:** Viewer role receives a filtered subset (no hourly rates, no DoLS date of birth).

---

## Excel Exports (XLSX)

Several modules provide XLSX export via the `downloadXLSX(filename, sheets)` utility.

### Roster Export

Available from RotationGrid page. Contains:
- Sheet "Roster": Date, Staff Name, Role, Team, Shift, Covers For

### Training Matrix Export

Available from TrainingMatrix page. Contains:
- Sheet "Training": Staff Name, Role, then one column per training type (status/expiry)

### CQC Evidence Export

Available from CQCEvidence page. Contains:
- Sheet "Evidence": CQC Ref, Statement, Type, Title, Value, Description, Period

### Staff Register Export

Available from StaffRegister page. Contains:
- Sheet "Staff": ID, Name, Role, Team, Preference, Skill, Hourly Rate, Contract Hours, Start Date, Active

---

## Staff CSV Import

`POST /api/import/staff?home=X&dryRun=true|false`

Template available at `GET /api/import/staff/template?home=X`.

### CSV Columns (required)

| Column | Type | Description |
|--------|------|-------------|
| name | String | Full name (required) |
| role | Enum | One of: Senior Carer, Carer, Team Lead, Night Senior, Night Carer, Float Senior, Float Carer |
| team | Enum | One of: Day A, Day B, Night A, Night B, Float |
| pref | Enum | Shift preference: E, L, EL, N, ANY (or blank) |
| skill | Number | Skill points 0-5 (default 1) |
| hourly_rate | Number | Positive decimal |
| start_date | Date | YYYY-MM-DD format |
| contract_hours | Number | Weekly contracted hours (or blank) |
| wtr_opt_out | Boolean | true/false or 1/0 (default false) |

### Behaviour

- **Dry run** (default): validates all rows, returns error details without persisting
- **Live run** (`dryRun=false`): inserts all rows in a single transaction — all or nothing
- **Duplicate detection**: rejects batch if any `name + start_date` combination already exists in the home
- **ID generation**: server generates staff IDs — do not include an ID column
- **File limits**: 2MB max, UTF-8 with optional BOM
