# RRCP Rule Book

Last updated: 18 March 2026 (Asia/Kolkata)

## 1) Data Prerequisites

The system expects these inputs before monthly processing:

1. Reference master upload:
- Service prices
- Discount rules by group
- Doctor master (doctor, group, PRO, cycle, reporting, confirmation, verified)

2. Monthly transaction upload:
- Patient-level billing and discount rows

3. Incentive workbook upload (optional but preferred):
- Row-level exact payable incentive mapping

If reference tables are missing or incomplete, engine rows are flagged with remarks.

## 2) Core Engine Formulas

For each transaction row:

1. `Allowed Discount`
- Computed from item rule + doctor group
- Shown only if doctor, group, and item mapping are all available
- Else forced to `0`

2. `Total Discount Amount`
- From uploaded transaction `total_discount` (display may be overridden by group policy in UI, see Section 4)

3. `Incentive To Doctors`
- Priority order:
  - exact `payable_discount` from incentive mapping
  - fallback `incentive_amount` from incentive mapping
  - fallback `max(allowed - actual, 0)`

4. `Sum Of Both`
- `Total Discount Amount + Incentive To Doctors`

5. `Variance`
- `Allowed - (Actual Discount + Payable Incentive)`
- If incentive mapping provides exact variance, that value is used.

## 3) Allowed-Visibility Rule

`Allowed` is considered valid only when all are true:

1. Doctor exists in doctor master
2. Doctor group exists
3. Item exists in discount master mapping

If any is missing:
- `Allowed = 0`
- Row gets a missing-data remark
- Row is flagged

## 4) Group-Specific Policy (A/B/C)

These rules are now enforced in calculation results:

1. Group `A`
- Expected:
  - Total Discount Amount = `0`
  - Incentive To Doctors = `0`
- If source row does not match expected:
  - `group_rule_violation = 1`
  - Variance badge shown in red (regardless of positive/zero/negative)
  - Remark: `Group A rule mismatch: discount and incentive must be 0`

2. Group `B`
- Allowed is calculated using **Group D** rule values
- Expected:
  - Total Discount Amount = Allowed (Group D basis)
  - Incentive To Doctors = `0`
- If source row does not match expected:
  - `group_rule_violation = 1`
  - Variance badge shown in red (regardless of sign)
  - Remark: `Group B rule mismatch: use Group D discount and zero incentive`

3. Group `C`
- Allowed is calculated using **Group F** rule values
- Expected:
  - Total Discount Amount = Allowed (Group F basis)
  - Incentive To Doctors = `0`
- If source row does not match expected:
  - `group_rule_violation = 1`
  - Variance badge shown in red (regardless of sign)
  - Remark: `Group C rule mismatch: use Group F discount and zero incentive`

## 5) Approval Rules

Approval request types in system:

1. `override_of_incentive_amount`
2. `change_of_doctor_info`
3. `change_of_pro`
4. `addition_of_doctor`
5. `approval_of_disbursal`

Effect:
- Request is created as `pending`
- Master/payment records change only after `approved`

## 6) Doctor Master Governance

Tracked doctor fields include:

1. Incentive cycle
2. Reporting doctor
3. Confirmation status
4. Confirmation remarks
5. Verified flag
6. Group and PRO ownership
7. Degree and contact number

## 7) Payout and Cash Controls

At payout row level:

1. Supports adjustment amount, advance payment, return incentive
2. Tracks PRO cash-in-hand and manager cash-in-hand separately
3. Tracks cashier handover time and PRO handover time
4. Final payable formula:
- `base + adjustment - advance - return`

Disbursal safety gate:

1. If `pro_cash_in_hand > 0` OR `manager_cash_in_hand > 0`
- payout status is forced to `on_hold`
- fresh disbursal should not proceed

## 8) Period Lock

When a period is locked:

1. Monthly upload is blocked
2. Engine run is blocked
3. Lock is stored with reason, user, and timestamp

## 9) Productivity Projection Rule

`Suggested Incentive` in PRO productivity table is:

1. `SUM(allowed_discount)` per PRO
2. Taken from latest engine run of the selected month

## 10) Report and Table Behaviors

1. Calculation Review supports:
- run selection
- flagged-only toggle
- search
- column filters (doctor/group/PRO/item/variance/remark)

2. Variance badge color:
- normal rule: negative red, zero/positive green
- override: if `group_rule_violation = 1`, always red

## 11) Active Requirement Checklist (from software requirements table)

Approval process required:

1. Override of incentive amount
2. Change in information of doctor (group etc)
3. Change of PRO
4. Addition of doctor
5. Approval of disbursal

Additional doctor information:

1. Incentive cycle
2. Cash in hand with PRO manager & PRO
3. Until cash in hand is zero, no fresh disbursal
4. Return of incentive to be accounted for
5. Delay in handover time by cashier
6. Delay in handover time by PRO to doctor
7. Confirmation remarks options
8. No confirmation option in doctor info
9. Reporting doctor
10. Adjustment column for payment
11. Advance payment
12. Date lock
13. Verified doctor

## 12) Operational Sequence (Recommended)

1. Upload latest reference master and requirement sheet
2. Verify doctor mapping/group/PRO
3. Upload monthly transaction file
4. Upload incentive workbook for exact row-level incentive mapping
5. Run Calculation Review for month
6. Resolve flagged rows and approvals
7. Generate payouts and process disbursal
8. Lock period
