const dayjs = require('dayjs');
const { normalizeText } = require('./excel');

function buildDateRange(periodYear, periodMonth) {
  const start = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`).startOf('month');
  const end = start.endOf('month');
  return { start: start.toISOString(), end: end.toISOString(), daysInMonth: end.date() };
}

function extractGroupCode(value) {
  const text = String(value || '').toUpperCase().trim();
  if (!text) return null;
  if (text === 'NEL') return 'NEL';
  const direct = text.match(/^([A-Z])$/);
  if (direct) return direct[1];
  const named = text.match(/GROUP\s*([A-Z]+)/);
  if (named) return named[1];
  const letters = text.match(/[A-Z]+/);
  if (letters) return letters[0];
  return null;
}

function splitItems(text) {
  return String(text || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function findRuleForItem(item, exactRuleMap, allRules) {
  const normalized = normalizeText(item);
  if (!normalized) return null;
  if (exactRuleMap.has(normalized)) return exactRuleMap.get(normalized);

  for (const rule of allRules) {
    if (rule.normalized_item.includes(normalized) || normalized.includes(rule.normalized_item)) {
      return rule;
    }
  }
  return null;
}

function calculateAllowedDiscountForItem(item, doctorGroup, exactRuleMap, allRules) {
  const rule = findRuleForItem(item, exactRuleMap, allRules);
  if (!rule) {
    return { allowed: 0, found: false };
  }

  const groupMap = JSON.parse(rule.group_json || '{}');
  const groupCode = extractGroupCode(doctorGroup);
  let allowed = null;

  if (groupCode && Object.prototype.hasOwnProperty.call(groupMap, groupCode)) {
    allowed = Number(groupMap[groupCode]);
  }

  if ((allowed === null || Number.isNaN(allowed)) && groupCode === 'F' && groupMap.G !== undefined) {
    allowed = Number(groupMap.G);
  }

  if (allowed === null || Number.isNaN(allowed)) {
    allowed = rule.max_discount_price !== null ? Number(rule.max_discount_price) : 0;
  }

  if (!Number.isFinite(allowed)) {
    allowed = 0;
  }

  return { allowed, found: true };
}

function suggestIncentive(projectedRevenue) {
  if (projectedRevenue >= 2000000) return 15000;
  if (projectedRevenue >= 1000000) return 10000;
  if (projectedRevenue >= 500000) return 5000;
  return 0;
}

function runEngineForPeriod(db, nowIso, periodYear, periodMonth) {
  const { start, end } = buildDateRange(periodYear, periodMonth);

  const transactions = db
    .prepare(
      `SELECT * FROM transactions
       WHERE visit_date IS NOT NULL
         AND visit_date >= ?
         AND visit_date <= ?`
    )
    .all(start, end);

  const doctorRows = db.prepare('SELECT * FROM doctor_master').all();
  const doctorMap = new Map();
  for (const doctor of doctorRows) {
    doctorMap.set(doctor.normalized_name, doctor);
  }

  const ruleRows = db.prepare('SELECT * FROM discount_rules').all();
  const exactRuleMap = new Map();
  for (const rule of ruleRows) {
    if (!exactRuleMap.has(rule.normalized_item)) {
      exactRuleMap.set(rule.normalized_item, rule);
    }
  }

  const runAt = nowIso();
  const insertRun = db.prepare(
    `INSERT INTO engine_runs
      (period_year, period_month, total_records, total_flags, summary_json, run_at)
     VALUES (?, ?, 0, 0, NULL, ?)`
  );
  const runInfo = insertRun.run(periodYear, periodMonth, runAt);
  const runId = runInfo.lastInsertRowid;

  const insertResult = db.prepare(
    `INSERT INTO engine_results
      (run_id, transaction_id, doctor_name, doctor_group, pro_name, modality, status, item_list,
       allowed_discount, actual_discount, payable_discount, variance, approval_required, remark, net_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let totalFlags = 0;
  let overDiscountCount = 0;
  let missingDoctorCount = 0;
  let missingItemCount = 0;
  let totalPayable = 0;

  const tx = db.transaction(() => {
    for (const row of transactions) {
      const normalizedDoctor = normalizeText(row.referring_doctor);
      const doctor = doctorMap.get(normalizedDoctor) || null;
      const doctorGroup = doctor?.incentive_group || null;
      const items = splitItems(row.billable_items || row.visit_description);

      let allowedDiscount = 0;
      let missingRuleForAnyItem = false;

      if (items.length === 0) {
        missingRuleForAnyItem = true;
      }

      for (const item of items) {
        const calc = calculateAllowedDiscountForItem(item, doctorGroup, exactRuleMap, ruleRows);
        allowedDiscount += calc.allowed;
        if (!calc.found) {
          missingRuleForAnyItem = true;
        }
      }

      const actualDiscount = Number(row.total_discount || 0);
      const variance = actualDiscount - allowedDiscount;
      const approvalRequired = variance > 0.01 ? 1 : 0;
      const payableDiscount = Math.max(0, Math.min(actualDiscount, allowedDiscount));
      totalPayable += payableDiscount;

      let remark = 'OK';
      if (!doctor) {
        remark = 'Doctor name missing in master sheet';
        missingDoctorCount += 1;
      } else if (missingRuleForAnyItem) {
        remark = 'Need to master sheet for item';
        missingItemCount += 1;
      } else if (approvalRequired) {
        remark = 'Over-discount requires approval';
        overDiscountCount += 1;
      } else if (variance < -0.01) {
        remark = 'Lower discount than allowed';
      }

      if (approvalRequired || !doctor || missingRuleForAnyItem) {
        totalFlags += 1;
      }

      insertResult.run(
        runId,
        row.id,
        row.referring_doctor,
        doctorGroup,
        row.pro_name,
        row.modality,
        row.status || row.receipt_status,
        JSON.stringify(items),
        Number(allowedDiscount.toFixed(2)),
        Number(actualDiscount.toFixed(2)),
        Number(payableDiscount.toFixed(2)),
        Number(variance.toFixed(2)),
        approvalRequired,
        remark,
        Number((row.total_net || 0).toFixed(2))
      );
    }
  });

  tx();

  const summary = {
    periodYear,
    periodMonth,
    totalRecords: transactions.length,
    totalFlags,
    overDiscountCount,
    missingDoctorCount,
    missingItemCount,
    totalPayable: Number(totalPayable.toFixed(2))
  };

  db.prepare(
    'UPDATE engine_runs SET total_records = ?, total_flags = ?, summary_json = ? WHERE id = ?'
  ).run(summary.totalRecords, totalFlags, JSON.stringify(summary), runId);

  return { runId, summary };
}

function getProductivityReport(db, periodYear, periodMonth) {
  const { start, end, daysInMonth } = buildDateRange(periodYear, periodMonth);
  const now = dayjs();
  const monthStart = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`);
  const elapsedDays = Math.max(
    1,
    now.isAfter(monthStart.endOf('month')) ? daysInMonth : now.diff(monthStart.startOf('day'), 'day') + 1
  );

  const rows = db
    .prepare(
      `SELECT
          COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED') AS pro_name,
          COUNT(*) AS total_cases,
          COALESCE(SUM(COALESCE(total_net, 0)), 0) AS total_net
       FROM transactions
       WHERE visit_date IS NOT NULL
         AND visit_date >= ?
         AND visit_date <= ?
       GROUP BY COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED')
       ORDER BY total_net DESC`
    )
    .all(start, end);

  return rows.map((row) => {
    const projectedMonthly = (row.total_net / elapsedDays) * daysInMonth;
    return {
      proName: row.pro_name,
      totalCases: row.total_cases,
      totalNet: Number(row.total_net.toFixed(2)),
      projectedMonthly: Number(projectedMonthly.toFixed(2)),
      suggestedIncentive: suggestIncentive(projectedMonthly)
    };
  });
}

function generatePaymentsFromRun(db, nowIso, runId) {
  const run = db.prepare('SELECT * FROM engine_runs WHERE id = ?').get(runId);
  if (!run) {
    throw new Error('Run not found');
  }

  const rows = db
    .prepare(
      `SELECT
          er.doctor_name,
          COALESCE(NULLIF(TRIM(er.pro_name), ''), 'UNASSIGNED') AS pro_name,
          SUM(COALESCE(er.payable_discount, 0)) AS amount,
          SUM(CASE WHEN er.approval_required = 1 THEN 1 ELSE 0 END) AS approval_flags
       FROM engine_results er
       WHERE er.run_id = ?
         AND (LOWER(COALESCE(er.status, '')) = 'paid')
         AND er.payable_discount > 0
       GROUP BY er.doctor_name, COALESCE(NULLIF(TRIM(er.pro_name), ''), 'UNASSIGNED')
       HAVING amount > 0`
    )
    .all(runId);

  const insertPayment = db.prepare(
    `INSERT INTO payments
      (run_id, doctor_name, pro_name, period_year, period_month, amount, status, approval_status,
       cash_in_hand_snapshot, disbursed_on, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertApproval = db.prepare(
    `INSERT INTO approval_requests
      (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, NULL, ?, ?)`
  );

  let generated = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const wallet = db
        .prepare('SELECT cash_in_hand FROM pro_wallets WHERE pro_name = ?')
        .get(row.pro_name);
      const cashInHand = wallet ? Number(wallet.cash_in_hand || 0) : 0;

      const now = nowIso();
      const holdForCash = cashInHand > 0;
      const paymentStatus = holdForCash ? 'on_hold' : 'pending';
      const notes = holdForCash
        ? 'Cash in hand pending settlement. Fresh disbursal blocked.'
        : null;

      const paymentResult = insertPayment.run(
        runId,
        row.doctor_name,
        row.pro_name,
        run.period_year,
        run.period_month,
        Number(row.amount.toFixed(2)),
        paymentStatus,
        'pending',
        cashInHand,
        null,
        notes,
        now,
        now
      );

      insertApproval.run(
        'approval_of_disbursal',
        String(paymentResult.lastInsertRowid),
        JSON.stringify({
          runId,
          doctorName: row.doctor_name,
          proName: row.pro_name,
          amount: Number(row.amount.toFixed(2)),
          approvalFlags: row.approval_flags
        }),
        'system',
        now,
        now
      );

      generated += 1;
    }
  });

  tx();
  return { generated };
}

module.exports = {
  runEngineForPeriod,
  getProductivityReport,
  generatePaymentsFromRun,
  buildDateRange
};
