const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS reference_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  unit_price REAL,
  currency TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_prices_normalized_name ON service_prices(normalized_name);

CREATE TABLE IF NOT EXISTS discount_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT NOT NULL,
  normalized_item TEXT NOT NULL,
  modality TEXT,
  max_discount_price REAL,
  group_json TEXT NOT NULL,
  exception_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discount_rules_normalized_item ON discount_rules(normalized_item);

CREATE TABLE IF NOT EXISTS doctor_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location TEXT,
  doctor_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  doctor_code TEXT,
  hospital_name TEXT,
  degree TEXT,
  contact_no TEXT,
  old_pro TEXT,
  present_pro TEXT,
  pro_change_date TEXT,
  hospital_address TEXT,
  area TEXT,
  lead_score TEXT,
  lead_stage TEXT,
  incentive_group TEXT,
  conversion_incentive_group TEXT,
  target_investigation TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doctor_master_normalized_name ON doctor_master(normalized_name);

CREATE TABLE IF NOT EXISTS software_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  requirement_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  source_type TEXT NOT NULL,
  visit_id TEXT,
  visit_date TEXT,
  patient_id TEXT,
  patient_name TEXT,
  sex TEXT,
  modality TEXT,
  visit_description TEXT,
  referring_doctor TEXT,
  normalized_doctor TEXT,
  pro_name TEXT,
  status TEXT,
  receipt_status TEXT,
  billable_items TEXT,
  total_price REAL,
  total_discount REAL,
  total_net REAL,
  total_payment REAL,
  balance_amount REAL,
  notes TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_visit_date ON transactions(visit_date);
CREATE INDEX IF NOT EXISTS idx_transactions_doctor ON transactions(normalized_doctor);

CREATE TABLE IF NOT EXISTS engine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  total_records INTEGER NOT NULL,
  total_flags INTEGER NOT NULL,
  summary_json TEXT,
  run_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  transaction_id INTEGER NOT NULL,
  doctor_name TEXT,
  doctor_group TEXT,
  pro_name TEXT,
  modality TEXT,
  status TEXT,
  item_list TEXT,
  allowed_discount REAL,
  actual_discount REAL,
  payable_discount REAL,
  variance REAL,
  approval_required INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  net_amount REAL,
  FOREIGN KEY(run_id) REFERENCES engine_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_engine_results_run_id ON engine_results(run_id);
CREATE INDEX IF NOT EXISTS idx_engine_results_approval_required ON engine_results(approval_required);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  doctor_name TEXT,
  pro_name TEXT,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  cash_in_hand_snapshot REAL,
  disbursed_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES engine_runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_period ON payments(period_year, period_month);

CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

CREATE TABLE IF NOT EXISTS pro_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pro_name TEXT NOT NULL UNIQUE,
  cash_in_hand REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locked_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  lock_reason TEXT,
  locked_by TEXT,
  locked_at TEXT,
  UNIQUE(period_year, period_month)
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
`;

db.exec(schema);

const nowIso = () => new Date().toISOString();

function seedDefaults() {
  const hasUsers = db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (!hasUsers) {
    const createdAt = nowIso();
    const passwordHash = bcrypt.hashSync('Admin@123', 10);
    db.prepare(
      `INSERT INTO users (email, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`
    ).run('admin@rrcp.local', passwordHash, 'admin', createdAt, createdAt);
  }

  const requirementsCount = db.prepare('SELECT COUNT(*) AS count FROM software_requirements').get().count;
  if (requirementsCount === 0) {
    const items = [
      ['Approval process required', 'Override of incentive amount'],
      ['Approval process required', 'Change in information of doctor (group etc)'],
      ['Approval process required', 'Change of PRO'],
      ['Approval process required', 'Addition of doctor'],
      ['Approval process required', 'Approval of disbursal'],
      ['Additional doctor information', 'Incentive cycle'],
      ['Additional doctor information', 'Cash in hand with PRO manager & PRO'],
      ['Additional doctor information', 'Until cash in hand is zero, no fresh disbursal'],
      ['Additional doctor information', 'Return of incentive to be accounted for'],
      ['Additional doctor information', 'Delay in handover time by cashier'],
      ['Additional doctor information', 'Delay in handover time by PRO to doctor'],
      ['Additional doctor information', 'Confirmation remarks options'],
      ['Additional doctor information', 'No confirmation option in doctor info'],
      ['Additional doctor information', 'Reporting Doctor'],
      ['Additional doctor information', 'Adjustment column for payment'],
      ['Additional doctor information', 'Advance payment'],
      ['Additional doctor information', 'Date lock'],
      ['Additional doctor information', 'Verified doctor']
    ];
    const stmt = db.prepare(
      'INSERT INTO software_requirements (category, requirement_text, created_at) VALUES (?, ?, ?)'
    );
    const insertMany = db.transaction((rows) => {
      for (const [category, text] of rows) {
        stmt.run(category, text, nowIso());
      }
    });
    insertMany(items);
  }
}

seedDefaults();

module.exports = {
  db,
  nowIso
};
