const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');

const { db, nowIso } = require('./db');
const {
  normalizeText,
  parseReferenceWorkbook,
  parseSoftwareRequirementsWorkbook,
  parseTransactionsWorkbook
} = require('./excel');
const { runEngineForPeriod, getProductivityReport, generatePaymentsFromRun, buildDateRange } = require('./engine');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'rrcp-local-secret';
const uploadsDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ dest: uploadsDir });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

function issueToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

function parseIntSafe(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function quoteCsv(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => quoteCsv(row[h])).join(','));
  }
  return lines.join('\n');
}

function isPeriodLocked(periodYear, periodMonth) {
  const row = db
    .prepare(
      `SELECT is_locked FROM locked_periods
       WHERE period_year = ? AND period_month = ?`
    )
    .get(periodYear, periodMonth);
  return !!(row && row.is_locked === 1);
}

function cleanupUpload(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // ignore cleanup failures
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: nowIso() });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
  const token = issueToken(user);

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status
    }
  });
});

app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  db.prepare(
    `INSERT INTO contact_messages (name, email, subject, message, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)`
  ).run(String(name).trim(), String(email).trim(), String(subject).trim(), String(message).trim(), nowIso());

  return res.json({ ok: true });
});

app.use('/api', requireAuth);

app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/dashboard', (req, res) => {
  const now = dayjs();
  const periodYear = parseIntSafe(req.query.year, now.year());
  const periodMonth = parseIntSafe(req.query.month, now.month() + 1);
  const { start, end } = buildDateRange(periodYear, periodMonth);

  const totals = db
    .prepare(
      `SELECT
          COUNT(*) AS total_cases,
          COALESCE(SUM(COALESCE(total_price, 0)), 0) AS gross,
          COALESCE(SUM(COALESCE(total_discount, 0)), 0) AS discount,
          COALESCE(SUM(COALESCE(total_net, 0)), 0) AS net
       FROM transactions
       WHERE visit_date IS NOT NULL
         AND visit_date >= ?
         AND visit_date <= ?`
    )
    .get(start, end);

  const topPros = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED') AS pro_name,
              COUNT(*) AS cases,
              COALESCE(SUM(COALESCE(total_net, 0)), 0) AS net
       FROM transactions
       WHERE visit_date IS NOT NULL
         AND visit_date >= ?
         AND visit_date <= ?
       GROUP BY COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED')
       ORDER BY net DESC
       LIMIT 8`
    )
    .all(start, end);

  const latestRun = db
    .prepare(
      `SELECT * FROM engine_runs
       WHERE period_year = ? AND period_month = ?
       ORDER BY run_at DESC LIMIT 1`
    )
    .get(periodYear, periodMonth);

  const pendingApprovals = db
    .prepare("SELECT COUNT(*) AS count FROM approval_requests WHERE status = 'pending'")
    .get().count;

  const pendingPayments = db
    .prepare(
      `SELECT
          COUNT(*) AS count,
          COALESCE(SUM(amount), 0) AS amount
       FROM payments
       WHERE period_year = ?
         AND period_month = ?
         AND approval_status = 'pending'`
    )
    .get(periodYear, periodMonth);

  const referenceSummary = {
    services: db.prepare('SELECT COUNT(*) AS count FROM service_prices').get().count,
    discountRules: db.prepare('SELECT COUNT(*) AS count FROM discount_rules').get().count,
    doctors: db.prepare('SELECT COUNT(*) AS count FROM doctor_master').get().count
  };

  res.json({
    periodYear,
    periodMonth,
    totals,
    topPros,
    latestRun,
    pendingApprovals,
    pendingPayments,
    referenceSummary,
    isLocked: isPeriodLocked(periodYear, periodMonth)
  });
});

app.get('/api/users', requireAdmin, (_req, res) => {
  const users = db
    .prepare('SELECT id, email, role, status, created_at, updated_at, last_login_at FROM users ORDER BY id ASC')
    .all();
  res.json({ users });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password and role are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const ts = nowIso();
  const passwordHash = bcrypt.hashSync(String(password), 10);
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`
    )
    .run(normalizedEmail, passwordHash, role, ts, ts);

  return res.json({ id: result.lastInsertRowid });
});

app.patch('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'User not found' });

  const nextRole = req.body.role || current.role;
  const nextStatus = req.body.status || current.status;
  let passwordHash = current.password_hash;
  if (req.body.password) {
    passwordHash = bcrypt.hashSync(String(req.body.password), 10);
  }

  db.prepare(
    `UPDATE users
     SET role = ?, status = ?, password_hash = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextRole, nextStatus, passwordHash, nowIso(), id);

  return res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.json({ ok: true });
});

app.get('/api/reference/summary', (req, res) => {
  const services = db.prepare('SELECT COUNT(*) AS count FROM service_prices').get().count;
  const discountRules = db.prepare('SELECT COUNT(*) AS count FROM discount_rules').get().count;
  const doctors = db.prepare('SELECT COUNT(*) AS count FROM doctor_master').get().count;
  const requirements = db.prepare('SELECT COUNT(*) AS count FROM software_requirements').get().count;

  const latestUploads = db
    .prepare('SELECT * FROM reference_uploads ORDER BY uploaded_at DESC LIMIT 6')
    .all();

  res.json({ services, discountRules, doctors, requirements, latestUploads });
});

app.get('/api/reference/doctors', (req, res) => {
  const page = Math.max(parseIntSafe(req.query.page, 1), 1);
  const pageSize = Math.min(Math.max(parseIntSafe(req.query.pageSize, 20), 1), 200);
  const offset = (page - 1) * pageSize;
  const search = String(req.query.search || '').trim();

  let where = '';
  const params = [];
  if (search) {
    where = 'WHERE doctor_name LIKE ? OR present_pro LIKE ? OR incentive_group LIKE ?';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) AS count FROM doctor_master ${where}`).get(...params).count;
  const rows = db
    .prepare(
      `SELECT id, location, doctor_name, doctor_code, hospital_name, degree, present_pro,
              old_pro, incentive_group, verified
       FROM doctor_master
       ${where}
       ORDER BY doctor_name ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  res.json({ rows, page, pageSize, total });
});

app.post('/api/reference/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });

  try {
    const parsed = parseReferenceWorkbook(req.file.path);

    const insertService = db.prepare(
      `INSERT INTO service_prices (name, normalized_name, unit_price, currency, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insertRule = db.prepare(
      `INSERT INTO discount_rules
        (item_name, normalized_item, modality, max_discount_price, group_json, exception_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertDoctor = db.prepare(
      `INSERT INTO doctor_master
        (location, doctor_name, normalized_name, doctor_code, hospital_name, degree, contact_no,
         old_pro, present_pro, pro_change_date, hospital_address, area, lead_score, lead_stage,
         incentive_group, conversion_incentive_group, target_investigation, verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM service_prices').run();
      db.prepare('DELETE FROM discount_rules').run();
      db.prepare('DELETE FROM doctor_master').run();

      for (const service of parsed.services) {
        insertService.run(
          service.name,
          service.normalizedName,
          service.unitPrice,
          service.currency,
          nowIso()
        );
      }

      for (const rule of parsed.discountRules) {
        insertRule.run(
          rule.itemName,
          rule.normalizedItem,
          rule.modality,
          rule.maxDiscountPrice,
          JSON.stringify(rule.groupValues),
          rule.exceptionText,
          nowIso()
        );
      }

      for (const doctor of parsed.doctors) {
        insertDoctor.run(
          doctor.location,
          doctor.doctorName,
          doctor.normalizedName,
          doctor.doctorCode,
          doctor.hospitalName,
          doctor.degree,
          doctor.contactNo,
          doctor.oldPro,
          doctor.presentPro,
          doctor.proDateChange,
          doctor.hospitalAddress,
          doctor.area,
          doctor.leadScore,
          doctor.leadStage,
          doctor.incentiveGroup,
          doctor.conversionIncentiveGroup,
          doctor.targetInvestigation,
          doctor.verified ? 1 : 0,
          nowIso()
        );

        if (doctor.presentPro) {
          db.prepare(
            `INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
             VALUES (?, 0, ?)
             ON CONFLICT(pro_name) DO NOTHING`
          ).run(doctor.presentPro.trim(), nowIso());
        }
      }

      db.prepare(
        `INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
         VALUES ('reference_master', ?, ?, ?, ?)`
      ).run(
        parsed.fileName,
        parsed.services.length + parsed.discountRules.length + parsed.doctors.length,
        JSON.stringify({
          services: parsed.services.length,
          discountRules: parsed.discountRules.length,
          doctors: parsed.doctors.length
        }),
        nowIso()
      );
    });

    tx();

    res.json({
      ok: true,
      fileName: parsed.fileName,
      inserted: {
        services: parsed.services.length,
        discountRules: parsed.discountRules.length,
        doctors: parsed.doctors.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    cleanupUpload(req.file.path);
  }
});

app.post('/api/reference/software/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });

  try {
    const parsed = parseSoftwareRequirementsWorkbook(req.file.path);
    const insertReq = db.prepare(
      `INSERT INTO software_requirements (category, requirement_text, created_at)
       VALUES (?, ?, ?)`
    );

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM software_requirements').run();
      for (const item of parsed.requirements) {
        insertReq.run(item.category, item.requirementText, nowIso());
      }
      db.prepare(
        `INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
         VALUES ('software_requirements', ?, ?, ?, ?)`
      ).run(
        parsed.fileName,
        parsed.requirements.length,
        JSON.stringify({ requirements: parsed.requirements.length }),
        nowIso()
      );
    });

    tx();

    res.json({
      ok: true,
      fileName: parsed.fileName,
      inserted: parsed.requirements.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    cleanupUpload(req.file.path);
  }
});

app.get('/api/reference/requirements', (_req, res) => {
  const rows = db
    .prepare('SELECT id, category, requirement_text FROM software_requirements ORDER BY id ASC')
    .all();
  res.json({ rows });
});

app.patch('/api/reference/doctors/:id/verify', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const verified = req.body.verified ? 1 : 0;
  db.prepare('UPDATE doctor_master SET verified = ? WHERE id = ?').run(verified, id);
  res.json({ ok: true });
});

app.post('/api/reference/doctors/change-pro', (req, res) => {
  const { doctorId, nextPro, reason } = req.body || {};
  if (!doctorId || !nextPro) {
    return res.status(400).json({ error: 'doctorId and nextPro are required' });
  }

  const requestId = db
    .prepare(
      `INSERT INTO approval_requests
        (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
       VALUES ('change_of_pro', ?, ?, 'pending', ?, NULL, ?, ?)`
    )
    .run(
      String(doctorId),
      JSON.stringify({ doctorId, nextPro, reason: reason || null }),
      req.user.email,
      nowIso(),
      nowIso()
    ).lastInsertRowid;

  res.json({ ok: true, requestId });
});

app.post('/api/data/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File is required' });

  const explicitYear = parseIntSafe(req.body.year, null);
  const explicitMonth = parseIntSafe(req.body.month, null);
  if (explicitYear && explicitMonth && isPeriodLocked(explicitYear, explicitMonth)) {
    cleanupUpload(req.file.path);
    return res.status(409).json({ error: 'Selected period is locked' });
  }

  try {
    const parsed = parseTransactionsWorkbook(req.file.path);
    const insert = db.prepare(
      `INSERT INTO transactions
        (source_file, source_type, visit_id, visit_date, patient_id, patient_name, sex, modality,
         visit_description, referring_doctor, normalized_doctor, pro_name, status, receipt_status,
         billable_items, total_price, total_discount, total_net, total_payment, balance_amount,
         notes, raw_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      for (const row of parsed.transactions) {
        insert.run(
          row.sourceFile,
          row.sourceType,
          row.visitId,
          row.visitDate,
          row.patientId,
          row.patientName,
          row.sex,
          row.modality,
          row.visitDescription,
          row.referringDoctor,
          row.normalizedDoctor,
          row.proName,
          row.status,
          row.receiptStatus,
          row.billableItems,
          row.totalPrice,
          row.totalDiscount,
          row.totalNet,
          row.totalPayment,
          row.balanceAmount,
          row.notes,
          row.rawJson,
          nowIso()
        );

        if (row.proName) {
          db.prepare(
            `INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
             VALUES (?, 0, ?)
             ON CONFLICT(pro_name) DO NOTHING`
          ).run(row.proName.trim(), nowIso());
        }
      }

      db.prepare(
        `INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
         VALUES ('transaction_data', ?, ?, ?, ?)`
      ).run(
        parsed.fileName,
        parsed.transactions.length,
        JSON.stringify({ sourceType: parsed.transactions[0]?.sourceType || 'unknown' }),
        nowIso()
      );
    });

    tx();

    res.json({ ok: true, inserted: parsed.transactions.length, fileName: parsed.fileName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    cleanupUpload(req.file.path);
  }
});

app.get('/api/data/records', (req, res) => {
  const page = Math.max(parseIntSafe(req.query.page, 1), 1);
  const pageSize = Math.min(Math.max(parseIntSafe(req.query.pageSize, 25), 1), 250);
  const offset = (page - 1) * pageSize;
  const year = parseIntSafe(req.query.year, null);
  const month = parseIntSafe(req.query.month, null);
  const search = String(req.query.search || '').trim();

  const clauses = [];
  const params = [];

  if (year && month) {
    const { start, end } = buildDateRange(year, month);
    clauses.push('visit_date IS NOT NULL AND visit_date >= ? AND visit_date <= ?');
    params.push(start, end);
  }

  if (search) {
    clauses.push('(patient_name LIKE ? OR referring_doctor LIKE ? OR billable_items LIKE ? OR pro_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions ${where}`).get(...params).count;
  const rows = db
    .prepare(
      `SELECT
          id, visit_date, patient_id, patient_name, referring_doctor, pro_name,
          billable_items, total_price, total_discount, total_net, status, receipt_status
       FROM transactions
       ${where}
       ORDER BY COALESCE(visit_date, created_at) DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  res.json({ rows, page, pageSize, total });
});

app.get('/api/data/export', (req, res) => {
  const year = parseIntSafe(req.query.year, null);
  const month = parseIntSafe(req.query.month, null);

  const clauses = [];
  const params = [];

  if (year && month) {
    const { start, end } = buildDateRange(year, month);
    clauses.push('visit_date IS NOT NULL AND visit_date >= ? AND visit_date <= ?');
    params.push(start, end);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT
          visit_date, patient_id, patient_name, referring_doctor, pro_name, billable_items,
          total_price, total_discount, total_net, status, receipt_status, notes
       FROM transactions
       ${where}
       ORDER BY COALESCE(visit_date, created_at) DESC`
    )
    .all(...params);

  const csv = toCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="data-export-${Date.now()}.csv"`);
  res.send(csv);
});

app.post('/api/engine/run', (req, res) => {
  const year = parseIntSafe(req.body.year, dayjs().year());
  const month = parseIntSafe(req.body.month, dayjs().month() + 1);

  if (isPeriodLocked(year, month)) {
    return res.status(409).json({ error: 'Selected period is locked' });
  }

  try {
    const result = runEngineForPeriod(db, nowIso, year, month);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/engine/runs', (req, res) => {
  const limit = Math.min(Math.max(parseIntSafe(req.query.limit, 12), 1), 100);
  const runs = db.prepare('SELECT * FROM engine_runs ORDER BY run_at DESC LIMIT ?').all(limit);
  res.json({ runs });
});

app.get('/api/engine/results', (req, res) => {
  const runId = parseIntSafe(req.query.runId, null);
  if (!runId) return res.status(400).json({ error: 'runId is required' });

  const page = Math.max(parseIntSafe(req.query.page, 1), 1);
  const pageSize = Math.min(Math.max(parseIntSafe(req.query.pageSize, 50), 1), 500);
  const offset = (page - 1) * pageSize;
  const flaggedOnly = req.query.flaggedOnly === 'true';

  const where = flaggedOnly ? 'WHERE run_id = ? AND approval_required = 1' : 'WHERE run_id = ?';
  const total = db.prepare(`SELECT COUNT(*) AS count FROM engine_results ${where}`).get(runId).count;

  const rows = db
    .prepare(
      `SELECT
          id, transaction_id, doctor_name, doctor_group, pro_name, modality, status,
          allowed_discount, actual_discount, payable_discount, variance, approval_required, remark, net_amount
       FROM engine_results
       ${where}
       ORDER BY approval_required DESC, ABS(variance) DESC
       LIMIT ? OFFSET ?`
    )
    .all(runId, pageSize, offset);

  res.json({ rows, page, pageSize, total });
});

app.get('/api/engine/productivity', (req, res) => {
  const year = parseIntSafe(req.query.year, dayjs().year());
  const month = parseIntSafe(req.query.month, dayjs().month() + 1);
  const rows = getProductivityReport(db, year, month);
  res.json({ rows });
});

app.post('/api/engine/override-incentive', (req, res) => {
  const { runId, paymentId, oldAmount, newAmount, reason } = req.body || {};
  if (!paymentId || oldAmount === undefined || newAmount === undefined || !reason) {
    return res.status(400).json({ error: 'paymentId, oldAmount, newAmount, and reason are required' });
  }

  const requestId = db
    .prepare(
      `INSERT INTO approval_requests
        (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
       VALUES ('override_of_incentive_amount', ?, ?, 'pending', ?, NULL, ?, ?)`
    )
    .run(
      String(paymentId),
      JSON.stringify({ runId, paymentId, oldAmount, newAmount, reason }),
      req.user.email,
      nowIso(),
      nowIso()
    ).lastInsertRowid;

  res.json({ ok: true, requestId });
});

app.get('/api/payments', (req, res) => {
  const year = parseIntSafe(req.query.year, null);
  const month = parseIntSafe(req.query.month, null);
  const status = req.query.status ? String(req.query.status).trim() : null;

  const clauses = [];
  const params = [];
  if (year) {
    clauses.push('period_year = ?');
    params.push(year);
  }
  if (month) {
    clauses.push('period_month = ?');
    params.push(month);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT
          id, run_id, doctor_name, pro_name, period_year, period_month, amount,
          status, approval_status, cash_in_hand_snapshot, disbursed_on, notes,
          created_at, updated_at
       FROM payments
       ${where}
       ORDER BY created_at DESC`
    )
    .all(...params);

  const summary = db
    .prepare(
      `SELECT
          COUNT(*) AS total,
          COALESCE(SUM(amount), 0) AS total_amount,
          COALESCE(SUM(CASE WHEN approval_status = 'pending' THEN amount ELSE 0 END), 0) AS pending_approval_amount,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_amount
       FROM payments
       ${where}`
    )
    .get(...params);

  res.json({ rows, summary });
});

app.post('/api/payments/generate', (req, res) => {
  const runId = parseIntSafe(req.body.runId, null);
  if (!runId) return res.status(400).json({ error: 'runId is required' });

  try {
    const result = generatePaymentsFromRun(db, nowIso, runId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/payments/:id', (req, res) => {
  const id = Number(req.params.id);
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const nextStatus = req.body.status || payment.status;
  const nextApproval = req.body.approvalStatus || payment.approval_status;
  const notes = req.body.notes !== undefined ? req.body.notes : payment.notes;
  const cashInHand = req.body.cashInHand !== undefined ? Number(req.body.cashInHand || 0) : payment.cash_in_hand_snapshot;

  if (payment.pro_name) {
    db.prepare(
      `INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(pro_name) DO UPDATE SET cash_in_hand = excluded.cash_in_hand, updated_at = excluded.updated_at`
    ).run(payment.pro_name, Number(cashInHand || 0), nowIso());
  }

  const resolvedStatus = Number(cashInHand || 0) > 0 && nextStatus === 'pending' ? 'on_hold' : nextStatus;
  const disbursedOn = resolvedStatus === 'paid' ? nowIso() : payment.disbursed_on;

  db.prepare(
    `UPDATE payments
     SET status = ?, approval_status = ?, notes = ?, cash_in_hand_snapshot = ?, disbursed_on = ?, updated_at = ?
     WHERE id = ?`
  ).run(resolvedStatus, nextApproval, notes || null, Number(cashInHand || 0), disbursedOn, nowIso(), id);

  res.json({ ok: true });
});

app.get('/api/reports/individual', (req, res) => {
  const doctor = String(req.query.doctor || '').trim();
  const year = parseIntSafe(req.query.year, dayjs().year());
  const month = parseIntSafe(req.query.month, dayjs().month() + 1);

  if (!doctor) return res.status(400).json({ error: 'doctor is required' });

  const latestRun = db
    .prepare(
      `SELECT id FROM engine_runs
       WHERE period_year = ? AND period_month = ?
       ORDER BY run_at DESC
       LIMIT 1`
    )
    .get(year, month);

  if (!latestRun) return res.status(404).json({ error: 'No engine run found for period' });

  const rows = db
    .prepare(
      `SELECT
          doctor_name, doctor_group, pro_name, modality,
          actual_discount, allowed_discount, payable_discount,
          variance, approval_required, remark, status, net_amount
       FROM engine_results
       WHERE run_id = ? AND doctor_name = ?
       ORDER BY ABS(variance) DESC`
    )
    .all(latestRun.id, doctor);

  const csv = toCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="individual-report-${Date.now()}.csv"`);
  res.send(csv);
});

app.get('/api/reports/multiple', (req, res) => {
  const year = parseIntSafe(req.query.year, dayjs().year());
  const month = parseIntSafe(req.query.month, dayjs().month() + 1);
  const groupBy = String(req.query.groupBy || 'pro').trim().toLowerCase();

  const latestRun = db
    .prepare(
      `SELECT id FROM engine_runs
       WHERE period_year = ? AND period_month = ?
       ORDER BY run_at DESC
       LIMIT 1`
    )
    .get(year, month);

  if (!latestRun) return res.status(404).json({ error: 'No engine run found for period' });

  let groupExpr = 'COALESCE(NULLIF(TRIM(pro_name), \'\'), \'UNASSIGNED\')';
  if (groupBy === 'doctor') groupExpr = 'COALESCE(NULLIF(TRIM(doctor_name), \'\'), \'UNASSIGNED\')';
  if (groupBy === 'group') groupExpr = 'COALESCE(NULLIF(TRIM(doctor_group), \'\'), \'UNASSIGNED\')';

  const rows = db
    .prepare(
      `SELECT
          ${groupExpr} AS grouping,
          COUNT(*) AS total_records,
          COALESCE(SUM(actual_discount), 0) AS actual_discount,
          COALESCE(SUM(allowed_discount), 0) AS allowed_discount,
          COALESCE(SUM(payable_discount), 0) AS payable_discount,
          COALESCE(SUM(net_amount), 0) AS net_amount,
          COALESCE(SUM(CASE WHEN approval_required = 1 THEN 1 ELSE 0 END), 0) AS flagged
       FROM engine_results
       WHERE run_id = ?
       GROUP BY ${groupExpr}
       ORDER BY net_amount DESC`
    )
    .all(latestRun.id);

  const csv = toCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="multiple-report-${Date.now()}.csv"`);
  res.send(csv);
});

app.get('/api/approvals', (req, res) => {
  const status = req.query.status ? String(req.query.status).trim() : null;
  const rows = status
    ? db
        .prepare('SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC')
        .all(status)
    : db.prepare('SELECT * FROM approval_requests ORDER BY created_at DESC').all();
  res.json({ rows });
});

app.post('/api/approvals', (req, res) => {
  const { type, entityId, payload } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type is required' });

  const id = db
    .prepare(
      `INSERT INTO approval_requests
        (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, NULL, ?, ?)`
    )
    .run(type, entityId ? String(entityId) : null, JSON.stringify(payload || {}), req.user.email, nowIso(), nowIso())
    .lastInsertRowid;

  res.json({ id });
});

app.patch('/api/approvals/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const decision = String(req.body.status || '').trim().toLowerCase();
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }

  const request = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: 'Approval request not found' });

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE approval_requests
       SET status = ?, approved_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(decision, req.user.email, nowIso(), id);

    if (request.type === 'approval_of_disbursal' && request.entity_id) {
      if (decision === 'approved') {
        db.prepare(
          `UPDATE payments
           SET approval_status = 'approved', updated_at = ?
           WHERE id = ?`
        ).run(nowIso(), Number(request.entity_id));
      } else {
        db.prepare(
          `UPDATE payments
           SET approval_status = 'rejected', status = 'on_hold', notes = COALESCE(notes, '') || ' | Disbursal rejected', updated_at = ?
           WHERE id = ?`
        ).run(nowIso(), Number(request.entity_id));
      }
    }

    if (request.type === 'change_of_pro' && request.entity_id && decision === 'approved') {
      const payload = JSON.parse(request.payload_json || '{}');
      if (payload.nextPro) {
        db.prepare(
          `UPDATE doctor_master
           SET old_pro = present_pro, present_pro = ?
           WHERE id = ?`
        ).run(payload.nextPro, Number(request.entity_id));
      }
    }

    if (request.type === 'override_of_incentive_amount' && request.entity_id && decision === 'approved') {
      const payload = JSON.parse(request.payload_json || '{}');
      if (payload.newAmount !== undefined) {
        db.prepare('UPDATE payments SET amount = ?, updated_at = ? WHERE id = ?').run(
          Number(payload.newAmount),
          nowIso(),
          Number(request.entity_id)
        );
      }
    }
  });

  tx();

  res.json({ ok: true });
});

app.get('/api/period-locks', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT period_year, period_month, is_locked, lock_reason, locked_by, locked_at
       FROM locked_periods
       ORDER BY period_year DESC, period_month DESC`
    )
    .all();
  res.json({ rows });
});

app.post('/api/period-locks', requireAdmin, (req, res) => {
  const periodYear = parseIntSafe(req.body.year, null);
  const periodMonth = parseIntSafe(req.body.month, null);
  const locked = !!req.body.locked;
  const reason = req.body.reason ? String(req.body.reason).trim() : null;

  if (!periodYear || !periodMonth || periodMonth < 1 || periodMonth > 12) {
    return res.status(400).json({ error: 'Valid year and month are required' });
  }

  db.prepare(
    `INSERT INTO locked_periods
      (period_year, period_month, is_locked, lock_reason, locked_by, locked_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(period_year, period_month)
     DO UPDATE SET is_locked = excluded.is_locked,
                   lock_reason = excluded.lock_reason,
                   locked_by = excluded.locked_by,
                   locked_at = excluded.locked_at`
  ).run(periodYear, periodMonth, locked ? 1 : 0, reason, req.user.email, locked ? nowIso() : null);

  res.json({ ok: true });
});

app.get('/api/contact', requireAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT id, name, email, subject, message, status, created_at FROM contact_messages ORDER BY created_at DESC')
    .all();
  res.json({ rows });
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`RRCP app running at http://localhost:${PORT}`);
});
