# Referral Revenue Calculation Platform (RRCP)

PHP + SQLite + vanilla HTML/CSS/JS implementation built from your source files:
- `Dashboard2025-07-16 17_55_45.xlsx`
- `Incentive_check_ 1-8th July 2025.xlsx`
- `Special Discount Master.xlsx`
- `Software requirement.xlsx`
- `Referral Calculation Screens.pptx`

## Stack

- Backend: PHP (PDO SQLite)
- Frontend: Vanilla HTML/CSS/JS in `public/`
- Excel parsing: `PhpSpreadsheet`
- Database: `data/app.db`

## Features

- JWT-like token auth with role checks
- Admin, mapper, accountant and doctor roles
- Dashboard metrics with monthly filters
- User management
- Reference master + software requirements upload
- Transaction file upload with parsing
- Engine run + results + productivity projection
- Payment generation and disbursal approval flow
- Reports (individual / grouped) as CSV
- Period lock controls
- Contact form and inbox

## Setup

```bash
cd /Applications/XAMPP/xamppfiles/htdocs/doctor
composer install
```

The database schema, demo master data, demo transactions, and demo users are initialized automatically.

Demo users:
- Email: `admin@rrcp.local`
- Password: `Admin@123`
- Email: `mapper@rrcp.local`
- Password: `Mapper@123`
- Email: `accountant@rrcp.local`
- Password: `Accountant@123`
- Email: `doctor.aarav@rrcp.local`
- Password: `Doctor@123`
- Email: `doctor.naina@rrcp.local`
- Password: `Doctor@123`

Demo data seeded automatically:
- Demo doctors with linked doctor-user accounts
- Demo discount rules and service prices
- Demo transactions (`source_type = demo_seed`) for current and previous month
- Auto engine run for current month (if not already present)
- Demo payments and pending approval requests

## Quick usage flow

1. Log in with a role-based demo account.
2. Set period (year/month) from Dashboard filters.
3. Upload or review data in Data Input.
4. Admin/accountant runs RRCP Engine and reviews flags.
5. Generate payments, handle approvals, and export reports.

## Usability improvements included

- Quick role-based demo login buttons on login screen
- Page-level "How to use this page" guidance on all major modules
- Role-aware hints (doctor scope, admin-only actions, report limitations)
- Cleaner formal theme with responsive layout for desktop/mobile

## Role access matrix

| Page / Action | Admin | Mapper | Accountant | Doctor |
|---|---|---|---|---|
| Dashboard | Yes | Yes | Yes | Yes (own scope) |
| User Maintenance | Yes | No | No | No |
| Data Input upload/list/export | Yes | Yes | Yes | Yes (own doctor only) |
| Reference Tables upload/verify | Yes | Yes | Yes | No |
| RRCP Engine run/results | Yes | Yes | Yes | No |
| Payment Management | Yes | Yes | Yes | View own payments only |
| Reports (Individual) | Yes | Yes | Yes | Yes (own doctor only) |
| Reports (Multiple/Grouped) | Yes | Yes | Yes | No |
| Approvals list/decision | Yes | No | No | No |
| Contact Us submit | Yes | Yes | Yes | Yes |

## Page-by-page behavior

### Dashboard
- Shows period totals, discount trend, net revenue, and top PRO.
- Shows pending approvals/payments and latest engine run.
- Includes role-specific quick-start guide.
- Doctor users see only their own transaction/payout scope.

### User Maintenance
- Admin only.
- Create users for `admin`, `mapper`, `accountant`, `doctor`.
- For `doctor` role, linking to a `doctor_master` record is mandatory.
- One doctor profile can be linked to only one doctor user.

### Data Input
- Upload `.xlsx/.xls` transactions.
- List parsed records with search and period filter.
- CSV export for current filtered period.
- Doctor role: upload is blocked if file contains any other doctor rows.

### Reference Tables
- Upload special discount master and software requirement sheets.
- View doctor master and requirement rows.
- Admin can toggle doctor verification.

### RRCP Engine
- Runs period calculation against discount rules + doctor groups.
- Produces allowed discount, actual discount, variance, payable discount, and remarks.
- Shows flagged records and productivity projection.
- Generates payment rows from selected run.

### Payment Management
- Shows payout rows with status, approval status, and cash-in-hand.
- Saves disbursal decisions and updates PRO wallet snapshot.
- Doctor users are restricted to their own payment rows.

### Reports
- Individual report exports doctor-level result rows from latest run in selected period.
- Multiple report exports grouped summary (PRO/doctor/group).
- Doctor role can download only their own individual report.

### Approvals
- Admin only.
- Tracks requests such as disbursal approval, PRO change, and incentive override.
- Approve/reject actions update target entities (payments/doctor mapping).

### Contact Us
- All roles can submit requests/messages.
- Admin can view inbox list and message details.

## Run locally (PHP built-in)

```bash
php -S 127.0.0.1:8080 -t .
```

Open the app at:
- `http://127.0.0.1:8080/`

If using Apache/XAMPP from `htdocs`, open:
- `http://localhost/doctor/`

Routing works in both modes:
- Rewritten URLs: `/api/...`
- Rewrite-free fallback: `/api/index.php?route=...`

## Seed from provided files

```bash
php scripts/seed-from-user-files.php
```

Override file paths with env vars:
- `REFERENCE_MASTER`
- `SOFTWARE_REQUIREMENTS`
- `DASHBOARD_FILE`
- `INCENTIVE_FILE`

## Upload format templates

Ready templates with sample rows are generated at:
- `/Applications/XAMPP/xamppfiles/htdocs/doctor/templates/Special_Discount_Master_Template.xlsx`
- `/Applications/XAMPP/xamppfiles/htdocs/doctor/templates/Software_Requirement_Template.xlsx`

Regenerate anytime:

```bash
php scripts/create-upload-templates.php
```
