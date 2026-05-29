<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Shared\Date;

const SECRET_SALT = 'RRCP_TOKEN_V1';
const TOKEN_TTL_SECONDS = 43200;
const DB_INIT_VERSION = '2026-03-17.4';

function nowIso(): string
{
    return gmdate('c');
}

function dbPath(): string
{
    $rootDir = dirname(__DIR__);
    $dataDir = $rootDir . '/data';
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0777, true);
    }

    return $dataDir . '/app.db';
}

function uploadPath(): string
{
    $rootDir = dirname(__DIR__);
    $uploadDir = $rootDir . '/uploads';
    if (!is_dir($uploadDir)) {
        mkdir($uploadDir, 0777, true);
    }

    return $uploadDir;
}

function dbInitMarkerPath(): string
{
    $rootDir = dirname(__DIR__);
    $dataDir = $rootDir . '/data';
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0777, true);
    }

    return $dataDir . '/.db_init_version';
}

function dbInitLockPath(): string
{
    $rootDir = dirname(__DIR__);
    $dataDir = $rootDir . '/data';
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0777, true);
    }

    return $dataDir . '/.db_init.lock';
}

function hasCoreTables(PDO $db): bool
{
    $required = ['users', 'doctor_master', 'transactions'];
    $stmt = $db->query("SELECT name FROM sqlite_master WHERE type = 'table'");
    $rows = $stmt ? $stmt->fetchAll() : [];
    $found = [];
    foreach ($rows as $row) {
        $name = (string) ($row['name'] ?? '');
        if ($name !== '') {
            $found[$name] = true;
        }
    }

    foreach ($required as $table) {
        if (!isset($found[$table])) {
            return false;
        }
    }

    return true;
}

function ensureInitialized(PDO $db): void
{
    $markerPath = dbInitMarkerPath();
    $currentVersion = is_file($markerPath) ? trim((string) file_get_contents($markerPath)) : '';
    if ($currentVersion === DB_INIT_VERSION && hasCoreTables($db)) {
        return;
    }

    $lockHandle = fopen(dbInitLockPath(), 'c');
    if ($lockHandle === false) {
        ensureSchema($db);
        seedDefaults($db);
        return;
    }

    try {
        if (!flock($lockHandle, LOCK_EX)) {
            ensureSchema($db);
            seedDefaults($db);
            return;
        }

        clearstatcache(true, $markerPath);
        $currentVersion = is_file($markerPath) ? trim((string) file_get_contents($markerPath)) : '';
        if ($currentVersion === DB_INIT_VERSION && hasCoreTables($db)) {
            return;
        }

        ensureSchema($db);
        seedDefaults($db);
        @file_put_contents($markerPath, DB_INIT_VERSION);
    } finally {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}

function getDb(): PDO
{
    static $db = null;

    if ($db instanceof PDO) {
        return $db;
    }

    $db = new PDO('sqlite:' . dbPath(), '', '');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->setAttribute(PDO::ATTR_TIMEOUT, 5);
    $db->exec('PRAGMA busy_timeout = 5000;');
    $db->exec('PRAGMA foreign_keys = ON;');
    $db->exec('PRAGMA synchronous = NORMAL;');

    // Avoid forcing WAL write-lock on every request. Only set once when required.
    $journalMode = strtolower((string) $db->query('PRAGMA journal_mode')->fetchColumn());
    if ($journalMode !== 'wal') {
        try {
            $db->exec('PRAGMA journal_mode = WAL;');
        } catch (PDOException $error) {
            if (stripos($error->getMessage(), 'database is locked') === false) {
                throw $error;
            }
            // Continue with existing journal mode if a concurrent request holds lock.
        }
    }

    ensureInitialized($db);

    return $db;
}

function ensureSchema(PDO $db): void
{
    $schema = <<<'SQL'
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  doctor_master_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  FOREIGN KEY(doctor_master_id) REFERENCES doctor_master(id) ON DELETE SET NULL
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
  incentive_cycle TEXT,
  conversion_incentive_group TEXT,
  target_investigation TEXT,
  reporting_doctor TEXT,
  confirmation_status TEXT NOT NULL DEFAULT 'pending',
  confirmation_remarks TEXT,
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
  payment_method TEXT,
  revenue_booked_in TEXT,
  balance_amount REAL,
  notes TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_visit_date ON transactions(visit_date);
CREATE INDEX IF NOT EXISTS idx_transactions_doctor ON transactions(normalized_doctor);

CREATE TABLE IF NOT EXISTS transaction_incentives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  source_sheet TEXT,
  match_key TEXT NOT NULL,
  visit_id TEXT,
  patient_id TEXT,
  patient_name TEXT,
  referring_doctor TEXT,
  normalized_doctor TEXT,
  pro_name TEXT,
  status TEXT,
  billable_items TEXT,
  modality TEXT,
  total_price REAL,
  total_discount REAL,
  total_net REAL,
  total_payment REAL,
  doctor_group TEXT,
  incentive_amount REAL,
  master_discount REAL,
  payable_discount REAL,
  variance_amount REAL,
  notes TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_incentives_period_key ON transaction_incentives(period_year, period_month, match_key);
CREATE INDEX IF NOT EXISTS idx_transaction_incentives_doctor ON transaction_incentives(normalized_doctor);

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
  group_rule_violation INTEGER NOT NULL DEFAULT 0,
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
  adjustment_amount REAL NOT NULL DEFAULT 0,
  advance_payment REAL NOT NULL DEFAULT 0,
  return_incentive_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  cash_in_hand_snapshot REAL,
  pro_cash_in_hand REAL NOT NULL DEFAULT 0,
  manager_cash_in_hand REAL NOT NULL DEFAULT 0,
  cashier_handover_at TEXT,
  pro_handover_at TEXT,
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
SQL;

    $db->exec($schema);
    ensureSchemaMigrations($db);
}

function tableHasColumn(PDO $db, string $table, string $column): bool
{
    $stmt = $db->query("PRAGMA table_info({$table})");
    if (!$stmt) {
        return false;
    }

    $rows = $stmt->fetchAll();
    foreach ($rows as $row) {
        if (($row['name'] ?? null) === $column) {
            return true;
        }
    }

    return false;
}

function ensureSchemaMigrations(PDO $db): void
{
    if (!tableHasColumn($db, 'users', 'doctor_master_id')) {
        $db->exec('ALTER TABLE users ADD COLUMN doctor_master_id INTEGER');
    }

    if (!tableHasColumn($db, 'transactions', 'payment_method')) {
        $db->exec('ALTER TABLE transactions ADD COLUMN payment_method TEXT');
    }

    if (!tableHasColumn($db, 'transactions', 'revenue_booked_in')) {
        $db->exec('ALTER TABLE transactions ADD COLUMN revenue_booked_in TEXT');
    }

    $doctorColumns = [
        'incentive_cycle' => 'TEXT',
        'reporting_doctor' => 'TEXT',
        'confirmation_status' => "TEXT NOT NULL DEFAULT 'pending'",
        'confirmation_remarks' => 'TEXT'
    ];
    foreach ($doctorColumns as $column => $definition) {
        if (!tableHasColumn($db, 'doctor_master', $column)) {
            $db->exec("ALTER TABLE doctor_master ADD COLUMN {$column} {$definition}");
        }
    }

    $paymentColumns = [
        'adjustment_amount' => 'REAL NOT NULL DEFAULT 0',
        'advance_payment' => 'REAL NOT NULL DEFAULT 0',
        'return_incentive_amount' => 'REAL NOT NULL DEFAULT 0',
        'pro_cash_in_hand' => 'REAL NOT NULL DEFAULT 0',
        'manager_cash_in_hand' => 'REAL NOT NULL DEFAULT 0',
        'cashier_handover_at' => 'TEXT',
        'pro_handover_at' => 'TEXT'
    ];
    foreach ($paymentColumns as $column => $definition) {
        if (!tableHasColumn($db, 'payments', $column)) {
            $db->exec("ALTER TABLE payments ADD COLUMN {$column} {$definition}");
        }
    }

    if (!tableHasColumn($db, 'engine_results', 'group_rule_violation')) {
        $db->exec('ALTER TABLE engine_results ADD COLUMN group_rule_violation INTEGER NOT NULL DEFAULT 0');
    }

    $db->exec('CREATE INDEX IF NOT EXISTS idx_users_doctor_master_id ON users(doctor_master_id)');
    backfillTransactionIntakeFields($db);
    backfillTransactionBillableItems($db);
    backfillTransactionIncentiveMappingsFromRawRows($db);
    backfillPaymentEnhancements($db);
}

function transactionPaymentMethodHeaders(): array
{
    return [
        'Payment Method',
        'Payment Mode',
        'Mode of Payment',
        'Payment Types',
        'Receipt Mode',
        'Payment Type',
        'Collection Type'
    ];
}

function transactionRevenueBookedInHeaders(): array
{
    return [
        'Revenue Booked In',
        'Revenue Booked In Sukhmani/Jivada',
        'Revenue Booked In Sukhmani / Jivada',
        'Revenue Booked In (Sukhmani/Jivada)',
        'Booked In',
        'Booking Center',
        'Booked At',
        'Center Name',
        'Centre Name'
    ];
}

function transactionBillableItemHeaders(): array
{
    return [
        'Billable Items',
        'Procedure',
        'Visit Description',
        'Items'
    ];
}

function transactionIncentiveAmountHeaders(): array
{
    return [
        'S Dis',
        'S. Dis',
        'S DIS',
        'Special Discount'
    ];
}

function transactionIncentiveMasterHeaders(): array
{
    return [
        'S. Dis as per master',
        'S Dis as per master',
        'Special Discount as per master'
    ];
}

function transactionIncentivePayableHeaders(): array
{
    return [
        'S. Dis payable',
        'S Dis payable',
        'SD PAID',
        'S DIS PAYABLE',
        'Incentive to Doctors/ RMPs (14)',
        'Incentive to Doctors/RMPs',
        'Incentive to Doctors / RMPs',
        'Incentive to Doctors'
    ];
}

function transactionIncentiveVarianceHeaders(): array
{
    return [
        'Difference',
        'Diff',
        'Variance'
    ];
}

function transactionIncentiveGroupHeaders(): array
{
    return [
        'Doctor group',
        'Incentive group'
    ];
}

function transactionLegacyIncentiveHeaders(): array
{
    return [
        'S Dis',
        'S. Dis',
        'SD PAID',
        'S. Dis payable',
        'Difference',
        'Doctor group'
    ];
}

function transactionCombinedIncentiveHeaders(): array
{
    return [
        'Incentive to Doctors/ RMPs (14)',
        'Incentive to Doctors/RMPs',
        'Incentive to Doctors / RMPs',
        'Incentive to Doctors',
        'Amount After Incentive'
    ];
}

function findRawJsonFieldValue(?string $rawJson, array $candidates): ?string
{
    if ($rawJson === null || trim($rawJson) === '') {
        return null;
    }

    $decoded = json_decode($rawJson, true);
    if (!is_array($decoded)) {
        return null;
    }

    $normalizedMap = [];
    foreach ($decoded as $key => $value) {
        $text = trim((string) $value);
        if ($text === '') {
            continue;
        }

        $rawKey = trim((string) $key);
        $normalizedKey = normalizeText($rawKey);
        if ($normalizedKey === '') {
            continue;
        }

        if (!array_key_exists($normalizedKey, $normalizedMap)) {
            $normalizedMap[$normalizedKey] = [
                'value' => $text,
                'raw_key' => $rawKey
            ];
            continue;
        }

        $existing = $normalizedMap[$normalizedKey];
        $existingIsNumeric = preg_match('/^\d+(?:[.,]\d+)?$/', (string) ($existing['value'] ?? '')) === 1;
        $currentIsNumeric = preg_match('/^\d+(?:[.,]\d+)?$/', $text) === 1;
        $preferCurrent =
            (str_starts_with(ltrim((string) ($existing['raw_key'] ?? '')), '#') && !str_starts_with(ltrim($rawKey), '#')) ||
            ($existingIsNumeric && !$currentIsNumeric);

        if ($preferCurrent) {
            $normalizedMap[$normalizedKey] = [
                'value' => $text,
                'raw_key' => $rawKey
            ];
        }
    }

    if (count($normalizedMap) === 0) {
        return null;
    }

    $normalizedCandidates = array_map('normalizeText', $candidates);
    foreach ($normalizedCandidates as $candidate) {
        if (array_key_exists($candidate, $normalizedMap)) {
            return (string) ($normalizedMap[$candidate]['value'] ?? '');
        }
    }

    foreach ($normalizedMap as $key => $entry) {
        foreach ($normalizedCandidates as $candidate) {
            if (str_contains($key, $candidate)) {
                return (string) ($entry['value'] ?? '');
            }
        }
    }

    return null;
}

function findRawJsonFieldValueExact(?string $rawJson, array $candidates): ?string
{
    if ($rawJson === null || trim($rawJson) === '') {
        return null;
    }

    $decoded = json_decode($rawJson, true);
    if (!is_array($decoded)) {
        return null;
    }

    $normalizedMap = [];
    foreach ($decoded as $key => $value) {
        $rawKey = trim((string) $key);
        $normalizedKey = normalizeText($rawKey);
        if ($normalizedKey === '') {
            continue;
        }

        if (!array_key_exists($normalizedKey, $normalizedMap)) {
            $normalizedMap[$normalizedKey] = $value;
        }
    }

    foreach (array_map('normalizeText', $candidates) as $candidate) {
        if (!array_key_exists($candidate, $normalizedMap)) {
            continue;
        }

        $value = $normalizedMap[$candidate];
        if ($value === null) {
            return null;
        }

        $text = trim((string) $value);
        return $text === '' ? null : $text;
    }

    return null;
}

function backfillTransactionIntakeFields(PDO $db): void
{
    if (!tableHasColumn($db, 'transactions', 'payment_method') || !tableHasColumn($db, 'transactions', 'revenue_booked_in')) {
        return;
    }

    $rows = $db->query(
        "SELECT id, source_type, raw_json, payment_method, revenue_booked_in
         FROM transactions
         WHERE COALESCE(TRIM(payment_method), '') = ''
            OR COALESCE(TRIM(revenue_booked_in), '') = ''"
    )->fetchAll();

    if (count($rows) === 0) {
        return;
    }

    $update = $db->prepare(
        'UPDATE transactions
         SET payment_method = COALESCE(:payment_method, payment_method),
             revenue_booked_in = COALESCE(:revenue_booked_in, revenue_booked_in)
         WHERE id = :id'
    );

    foreach ($rows as $row) {
        $paymentMethod = trim((string) ($row['payment_method'] ?? ''));
        $revenueBookedIn = trim((string) ($row['revenue_booked_in'] ?? ''));

        if ($paymentMethod === '') {
            $paymentMethod = findRawJsonFieldValue((string) ($row['raw_json'] ?? ''), transactionPaymentMethodHeaders()) ?? '';
        }

        if ($revenueBookedIn === '') {
            $revenueBookedIn = findRawJsonFieldValue((string) ($row['raw_json'] ?? ''), transactionRevenueBookedInHeaders()) ?? '';
        }

        if (($row['source_type'] ?? '') === 'demo_seed') {
            if ($paymentMethod === '') {
                $paymentMethod = match (((int) $row['id']) % 3) {
                    1 => 'Cash',
                    2 => 'Card',
                    default => 'UPI',
                };
            }

            if ($revenueBookedIn === '') {
                $revenueBookedIn = (((int) $row['id']) % 2 === 0) ? 'Jivada' : 'Sukhmani';
            }
        }

        if ($paymentMethod === '' && $revenueBookedIn === '') {
            continue;
        }

        $update->execute([
            ':id' => (int) $row['id'],
            ':payment_method' => $paymentMethod !== '' ? $paymentMethod : null,
            ':revenue_booked_in' => $revenueBookedIn !== '' ? $revenueBookedIn : null
        ]);
    }
}

function backfillTransactionBillableItems(PDO $db): void
{
    if (!tableHasColumn($db, 'transactions', 'billable_items')) {
        return;
    }

    $rows = $db->query(
        'SELECT id, raw_json, billable_items
         FROM transactions'
    )->fetchAll();

    if (count($rows) === 0) {
        return;
    }

    $update = $db->prepare(
        'UPDATE transactions
         SET billable_items = :billable_items
         WHERE id = :id'
    );

    foreach ($rows as $row) {
        $currentValue = trim((string) ($row['billable_items'] ?? ''));
        $needsBackfill = ($currentValue === '') || preg_match('/^\d+(?:[.,]\d+)?$/', $currentValue) === 1;
        if (!$needsBackfill) {
            continue;
        }

        $candidate = findRawJsonFieldValue((string) ($row['raw_json'] ?? ''), ['Billable Items', 'Procedure', 'Visit Description']);
        if ($candidate === null || preg_match('/^\d+(?:[.,]\d+)?$/', trim($candidate)) === 1) {
            $candidate = findRawJsonFieldValue((string) ($row['raw_json'] ?? ''), ['Items']);
        }

        $candidate = trim((string) $candidate);
        if ($candidate === '' || preg_match('/^\d+(?:[.,]\d+)?$/', $candidate) === 1) {
            continue;
        }

        $update->execute([
            ':id' => (int) $row['id'],
            ':billable_items' => $candidate
        ]);
    }
}

function backfillTransactionIncentiveMappingsFromRawRows(PDO $db): void
{
    if (!tableHasColumn($db, 'transaction_incentives', 'match_key')) {
        return;
    }

    $rows = $db->query(
        "SELECT id, source_file, visit_date, patient_id, patient_name, referring_doctor, normalized_doctor,
                pro_name, status, billable_items, modality, total_price, total_discount, total_net,
                total_payment, raw_json
         FROM transactions
         WHERE raw_json IS NOT NULL AND TRIM(raw_json) <> ''"
    )->fetchAll();

    if (count($rows) === 0) {
        return;
    }

    $insert = $db->prepare(
        'INSERT INTO transaction_incentives
         (period_year, period_month, source_file, source_sheet, match_key, visit_id, patient_id, patient_name,
          referring_doctor, normalized_doctor, pro_name, status, billable_items, modality, total_price,
          total_discount, total_net, total_payment, doctor_group, incentive_amount, master_discount,
          payable_discount, variance_amount, notes, raw_json, created_at, updated_at)
         VALUES
         (:period_year, :period_month, :source_file, NULL, :match_key, NULL, :patient_id, :patient_name,
          :referring_doctor, :normalized_doctor, :pro_name, :status, :billable_items, :modality, :total_price,
          :total_discount, :total_net, :total_payment, :doctor_group, :incentive_amount, :master_discount,
          :payable_discount, :variance_amount, :notes, :raw_json, :created_at, :updated_at)
         ON CONFLICT(period_year, period_month, match_key) DO NOTHING'
    );

    $startedTransaction = false;
    if (!$db->inTransaction()) {
        $db->beginTransaction();
        $startedTransaction = true;
    }

    try {
        foreach ($rows as $row) {
            $rawJson = (string) ($row['raw_json'] ?? '');
            $payableText = findRawJsonFieldValue($rawJson, transactionIncentivePayableHeaders());
            $amountText = findRawJsonFieldValue($rawJson, transactionIncentiveAmountHeaders());
            $masterText = findRawJsonFieldValue($rawJson, transactionIncentiveMasterHeaders());

            if ($payableText === null && $amountText === null && $masterText === null) {
                continue;
            }

            $visitDate = trim((string) ($row['visit_date'] ?? ''));
            if ($visitDate === '') {
                continue;
            }

            try {
                $date = new DateTimeImmutable($visitDate);
            } catch (Throwable $error) {
                continue;
            }

            $matchKey = buildTransactionMatchKey($row);
            if ($matchKey === '') {
                continue;
            }

            $payableDiscount = parseNumber($payableText);
            $incentiveAmount = parseNumber($amountText);
            if ($payableDiscount === null && $incentiveAmount !== null) {
                $payableDiscount = $incentiveAmount;
            }

            $varianceText = findRawJsonFieldValueExact($rawJson, transactionIncentiveVarianceHeaders());
            $notes = findRawJsonFieldValueExact($rawJson, ['S. Dis Remark', 'Remarks']);

            $now = nowIso();
            $insert->execute([
                ':period_year' => (int) $date->format('Y'),
                ':period_month' => (int) $date->format('m'),
                ':source_file' => (string) ($row['source_file'] ?? 'backfill'),
                ':match_key' => $matchKey,
                ':patient_id' => $row['patient_id'] ?? null,
                ':patient_name' => $row['patient_name'] ?? null,
                ':referring_doctor' => $row['referring_doctor'] ?? null,
                ':normalized_doctor' => $row['normalized_doctor'] ?? null,
                ':pro_name' => $row['pro_name'] ?? null,
                ':status' => $row['status'] ?? null,
                ':billable_items' => $row['billable_items'] ?? null,
                ':modality' => $row['modality'] ?? null,
                ':total_price' => $row['total_price'] ?? null,
                ':total_discount' => $row['total_discount'] ?? null,
                ':total_net' => $row['total_net'] ?? null,
                ':total_payment' => $row['total_payment'] ?? null,
                ':doctor_group' => findRawJsonFieldValueExact($rawJson, transactionIncentiveGroupHeaders()),
                ':incentive_amount' => $incentiveAmount,
                ':master_discount' => parseNumber($masterText),
                ':payable_discount' => $payableDiscount,
                ':variance_amount' => parseNumber($varianceText),
                ':notes' => $notes,
                ':raw_json' => $rawJson,
                ':created_at' => $now,
                ':updated_at' => $now,
            ]);
        }

        if ($startedTransaction) {
            $db->commit();
        }
    } catch (Throwable $error) {
        if ($startedTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function backfillPaymentEnhancements(PDO $db): void
{
    if (!tableHasColumn($db, 'payments', 'pro_cash_in_hand') || !tableHasColumn($db, 'payments', 'manager_cash_in_hand')) {
        return;
    }

    $db->exec(
        'UPDATE payments
         SET pro_cash_in_hand = COALESCE(NULLIF(pro_cash_in_hand, 0), COALESCE(cash_in_hand_snapshot, 0))
         WHERE COALESCE(pro_cash_in_hand, 0) = 0'
    );

    if (tableHasColumn($db, 'doctor_master', 'confirmation_status')) {
        $db->exec(
            "UPDATE doctor_master
             SET confirmation_status = 'pending'
             WHERE confirmation_status IS NULL OR TRIM(confirmation_status) = ''"
        );
    }
}

function seedDefaults(PDO $db): void
{
    seedDefaultAdmin($db);
    seedDefaultRequirements($db);
    seedDemoReferenceData($db);
    seedDemoUsers($db);
    seedDemoTransactions($db);
    seedDemoEngineAndPayments($db);
}

function seedDefaultAdmin(PDO $db): void
{
    $admin = $db->prepare('SELECT id FROM users WHERE email = :email');
    $admin->execute([':email' => 'admin@rrcp.local']);
    if ($admin->fetch()) {
        return;
    }

    $createdAt = nowIso();
    $insert = $db->prepare(
        'INSERT INTO users (email, password_hash, role, doctor_master_id, status, created_at, updated_at)
         VALUES (:email, :password_hash, :role, NULL, \'active\', :created_at, :updated_at)'
    );
    $insert->execute([
        ':email' => 'admin@rrcp.local',
        ':password_hash' => password_hash('Admin@123', PASSWORD_BCRYPT),
        ':role' => 'admin',
        ':created_at' => $createdAt,
        ':updated_at' => $createdAt
    ]);
}

function seedDefaultRequirements(PDO $db): void
{
    $reqCount = (int) $db->query('SELECT COUNT(*) AS count FROM software_requirements')->fetch()['count'];
    if ($reqCount > 0) {
        return;
    }

    $items = [
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
        ['Additional doctor information', 'Reporting doctor'],
        ['Additional doctor information', 'Adjustment column for payment'],
        ['Additional doctor information', 'Advance payment'],
        ['Additional doctor information', 'Date lock'],
        ['Additional doctor information', 'Verified doctor']
    ];

    $insert = $db->prepare('INSERT INTO software_requirements (category, requirement_text, created_at) VALUES (?, ?, ?)');
    $createdAt = nowIso();

    foreach ($items as $item) {
        $insert->execute([$item[0], $item[1], $createdAt]);
    }
}

function seedDemoReferenceData(PDO $db): void
{
    $createdAt = nowIso();

    $demoDoctors = [
        [
            'code' => 'DEMO-DR-A01',
            'name' => 'Dr Aarav Mehta',
            'location' => 'North',
            'hospital' => 'CityCare Diagnostics',
            'degree' => 'MD Radiology',
            'presentPro' => 'PRO-RIYA',
            'group' => 'A',
            'cycle' => 'Monthly',
            'reportingDoctor' => 'Dr Manish Sethi',
            'confirmationStatus' => 'confirmed',
            'confirmationRemarks' => 'On-boarded and confirmed for March cycle',
            'verified' => 1
        ],
        [
            'code' => 'DEMO-DR-B01',
            'name' => 'Dr Naina Kapoor',
            'location' => 'West',
            'hospital' => 'Metro Scan Centre',
            'degree' => 'DMRD',
            'presentPro' => 'PRO-ARJUN',
            'group' => 'B',
            'cycle' => 'Monthly',
            'reportingDoctor' => 'Dr Kavita Malhotra',
            'confirmationStatus' => 'pending',
            'confirmationRemarks' => 'Awaiting fresh monthly confirmation',
            'verified' => 1
        ],
        [
            'code' => 'DEMO-DR-C01',
            'name' => 'Dr Kabir Shah',
            'location' => 'Central',
            'hospital' => 'Prime Imaging Hub',
            'degree' => 'MD Radio Diagnosis',
            'presentPro' => 'PRO-ANIKA',
            'group' => 'C',
            'cycle' => 'Quarterly',
            'reportingDoctor' => 'Dr Sunil Sharma',
            'confirmationStatus' => 'not_confirmed',
            'confirmationRemarks' => 'Verification pending on reporting chain',
            'verified' => 0
        ]
    ];

    $findDoctorByCode = $db->prepare('SELECT id FROM doctor_master WHERE doctor_code = :doctor_code LIMIT 1');
    $insertDoctor = $db->prepare(
        'INSERT INTO doctor_master
         (location, doctor_name, normalized_name, doctor_code, hospital_name, degree, contact_no,
          old_pro, present_pro, pro_change_date, hospital_address, area, lead_score, lead_stage,
          incentive_group, incentive_cycle, conversion_incentive_group, target_investigation,
          reporting_doctor, confirmation_status, confirmation_remarks, verified, created_at)
         VALUES
         (:location, :doctor_name, :normalized_name, :doctor_code, :hospital_name, :degree, :contact_no,
          NULL, :present_pro, NULL, NULL, NULL, NULL, NULL,
          :incentive_group, :incentive_cycle, :conversion_incentive_group, :target_investigation,
          :reporting_doctor, :confirmation_status, :confirmation_remarks, :verified, :created_at)'
    );

    $insertWallet = $db->prepare(
        'INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
         VALUES (:pro_name, 0, :updated_at)
         ON CONFLICT(pro_name) DO NOTHING'
    );

    foreach ($demoDoctors as $doctor) {
        $findDoctorByCode->execute([':doctor_code' => $doctor['code']]);
        if (!$findDoctorByCode->fetch()) {
            $insertDoctor->execute([
                ':location' => $doctor['location'],
                ':doctor_name' => $doctor['name'],
                ':normalized_name' => normalizeText($doctor['name']),
                ':doctor_code' => $doctor['code'],
                ':hospital_name' => $doctor['hospital'],
                ':degree' => $doctor['degree'],
                ':contact_no' => null,
                ':present_pro' => $doctor['presentPro'],
                ':incentive_group' => $doctor['group'],
                ':incentive_cycle' => $doctor['cycle'],
                ':conversion_incentive_group' => null,
                ':target_investigation' => 'MRI,CT,USG',
                ':reporting_doctor' => $doctor['reportingDoctor'],
                ':confirmation_status' => $doctor['confirmationStatus'],
                ':confirmation_remarks' => $doctor['confirmationRemarks'],
                ':verified' => (int) $doctor['verified'],
                ':created_at' => $createdAt
            ]);
        }

        $insertWallet->execute([
            ':pro_name' => $doctor['presentPro'],
            ':updated_at' => $createdAt
        ]);
    }

    $demoServices = [
        ['name' => 'MRI BRAIN PLAIN', 'price' => 9500],
        ['name' => 'CT CHEST HRCT', 'price' => 7000],
        ['name' => 'USG ABDOMEN', 'price' => 3500],
        ['name' => 'X-RAY CHEST', 'price' => 1200],
        ['name' => 'BLOOD TEST PANEL', 'price' => 2200]
    ];

    $findService = $db->prepare('SELECT id FROM service_prices WHERE normalized_name = :normalized_name LIMIT 1');
    $insertService = $db->prepare(
        'INSERT INTO service_prices (name, normalized_name, unit_price, currency, created_at)
         VALUES (:name, :normalized_name, :unit_price, :currency, :created_at)'
    );

    foreach ($demoServices as $service) {
        $normalized = normalizeText($service['name']);
        $findService->execute([':normalized_name' => $normalized]);
        if ($findService->fetch()) {
            continue;
        }

        $insertService->execute([
            ':name' => $service['name'],
            ':normalized_name' => $normalized,
            ':unit_price' => (float) $service['price'],
            ':currency' => 'INR',
            ':created_at' => $createdAt
        ]);
    }

    $demoRules = [
        ['item' => 'MRI BRAIN PLAIN', 'modality' => 'MRI', 'max' => 3200],
        ['item' => 'CT CHEST HRCT', 'modality' => 'CT', 'max' => 2600],
        ['item' => 'USG ABDOMEN', 'modality' => 'USG', 'max' => 1400],
        ['item' => 'X-RAY CHEST', 'modality' => 'XRAY', 'max' => 400],
        ['item' => 'BLOOD TEST PANEL', 'modality' => 'PATHO', 'max' => 800]
    ];

    $defaultGroupMap = [
        'A' => 3200,
        'B' => 2800,
        'C' => 2400,
        'D' => 2000,
        'E' => 1600,
        'F' => 1200,
        'G' => 1000,
        'NEL' => 500
    ];

    $findRule = $db->prepare('SELECT id FROM discount_rules WHERE normalized_item = :normalized_item LIMIT 1');
    $insertRule = $db->prepare(
        'INSERT INTO discount_rules (item_name, normalized_item, modality, max_discount_price, group_json, exception_text, created_at)
         VALUES (:item_name, :normalized_item, :modality, :max_discount_price, :group_json, :exception_text, :created_at)'
    );

    foreach ($demoRules as $rule) {
        $normalized = normalizeText($rule['item']);
        $findRule->execute([':normalized_item' => $normalized]);
        if ($findRule->fetch()) {
            continue;
        }

        $insertRule->execute([
            ':item_name' => $rule['item'],
            ':normalized_item' => $normalized,
            ':modality' => $rule['modality'],
            ':max_discount_price' => (float) $rule['max'],
            ':group_json' => json_encode($defaultGroupMap, JSON_UNESCAPED_UNICODE),
            ':exception_text' => null,
            ':created_at' => $createdAt
        ]);
    }
}

function seedDemoUsers(PDO $db): void
{
    $createdAt = nowIso();
    $findUser = $db->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $insertUser = $db->prepare(
        'INSERT INTO users (email, password_hash, role, doctor_master_id, status, created_at, updated_at)
         VALUES (:email, :password_hash, :role, :doctor_master_id, \'active\', :created_at, :updated_at)'
    );

    $demoUsers = [
        ['email' => 'mapper@rrcp.local', 'password' => 'Mapper@123', 'role' => 'mapper', 'doctorCode' => null],
        ['email' => 'accountant@rrcp.local', 'password' => 'Accountant@123', 'role' => 'accountant', 'doctorCode' => null],
        ['email' => 'doctor.aarav@rrcp.local', 'password' => 'Doctor@123', 'role' => 'doctor', 'doctorCode' => 'DEMO-DR-A01'],
        ['email' => 'doctor.naina@rrcp.local', 'password' => 'Doctor@123', 'role' => 'doctor', 'doctorCode' => 'DEMO-DR-B01']
    ];

    $findDoctor = $db->prepare('SELECT id FROM doctor_master WHERE doctor_code = :doctor_code LIMIT 1');

    foreach ($demoUsers as $demoUser) {
        $findUser->execute([':email' => $demoUser['email']]);
        if ($findUser->fetch()) {
            continue;
        }

        $doctorMasterId = null;
        if ($demoUser['role'] === 'doctor' && $demoUser['doctorCode']) {
            $findDoctor->execute([':doctor_code' => $demoUser['doctorCode']]);
            $doctor = $findDoctor->fetch();
            if (!$doctor) {
                continue;
            }
            $doctorMasterId = (int) $doctor['id'];
        }

        $insertUser->execute([
            ':email' => $demoUser['email'],
            ':password_hash' => password_hash($demoUser['password'], PASSWORD_BCRYPT),
            ':role' => $demoUser['role'],
            ':doctor_master_id' => $doctorMasterId,
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt
        ]);
    }
}

function seedDemoTransactions(PDO $db): void
{
    $existingDemo = $db->prepare("SELECT COUNT(*) AS count FROM transactions WHERE source_type = 'demo_seed'");
    $existingDemo->execute();
    $count = (int) $existingDemo->fetch()['count'];
    if ($count > 0) {
        return;
    }

    $doctorRows = $db->query(
        "SELECT doctor_code, doctor_name, normalized_name, present_pro
         FROM doctor_master
         WHERE doctor_code IN ('DEMO-DR-A01', 'DEMO-DR-B01', 'DEMO-DR-C01')
         ORDER BY doctor_code ASC"
    )->fetchAll();

    if (count($doctorRows) === 0) {
        return;
    }

    $doctorMap = [];
    foreach ($doctorRows as $doctorRow) {
        $doctorMap[(string) $doctorRow['doctor_code']] = $doctorRow;
    }

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $currentMonthDate = $now;
    $previousMonthDate = $now->modify('-1 month');

    $templates = [
        ['code' => 'DEMO-DR-A01', 'month' => 'current', 'day' => 3, 'item' => 'MRI BRAIN PLAIN', 'modality' => 'MRI', 'price' => 9500, 'discount' => 2800, 'patient' => 'Rahul Verma', 'sex' => 'M'],
        ['code' => 'DEMO-DR-A01', 'month' => 'current', 'day' => 7, 'item' => 'CT CHEST HRCT', 'modality' => 'CT', 'price' => 7200, 'discount' => 2900, 'patient' => 'Anita Sharma', 'sex' => 'F'],
        ['code' => 'DEMO-DR-A01', 'month' => 'current', 'day' => 12, 'item' => 'USG ABDOMEN', 'modality' => 'USG', 'price' => 3600, 'discount' => 1100, 'patient' => 'Deepak Nair', 'sex' => 'M'],
        ['code' => 'DEMO-DR-B01', 'month' => 'current', 'day' => 5, 'item' => 'MRI BRAIN PLAIN', 'modality' => 'MRI', 'price' => 9800, 'discount' => 2600, 'patient' => 'Sonal Gupta', 'sex' => 'F'],
        ['code' => 'DEMO-DR-B01', 'month' => 'current', 'day' => 10, 'item' => 'X-RAY CHEST', 'modality' => 'XRAY', 'price' => 1300, 'discount' => 500, 'patient' => 'Ravi Singh', 'sex' => 'M'],
        ['code' => 'DEMO-DR-B01', 'month' => 'current', 'day' => 16, 'item' => 'BLOOD TEST PANEL', 'modality' => 'PATHO', 'price' => 2400, 'discount' => 900, 'patient' => 'Neha Kulkarni', 'sex' => 'F'],
        ['code' => 'DEMO-DR-C01', 'month' => 'current', 'day' => 8, 'item' => 'CT CHEST HRCT', 'modality' => 'CT', 'price' => 7000, 'discount' => 1800, 'patient' => 'Karan Malhotra', 'sex' => 'M'],
        ['code' => 'DEMO-DR-C01', 'month' => 'current', 'day' => 20, 'item' => 'USG ABDOMEN', 'modality' => 'USG', 'price' => 3500, 'discount' => 1200, 'patient' => 'Pooja Iyer', 'sex' => 'F'],
        ['code' => 'DEMO-DR-A01', 'month' => 'previous', 'day' => 11, 'item' => 'MRI BRAIN PLAIN', 'modality' => 'MRI', 'price' => 9300, 'discount' => 2500, 'patient' => 'Arvind Rao', 'sex' => 'M'],
        ['code' => 'DEMO-DR-B01', 'month' => 'previous', 'day' => 13, 'item' => 'CT CHEST HRCT', 'modality' => 'CT', 'price' => 7100, 'discount' => 2200, 'patient' => 'Meera Joshi', 'sex' => 'F']
    ];

    $insert = $db->prepare(
        'INSERT INTO transactions
         (source_file, source_type, visit_id, visit_date, patient_id, patient_name, sex, modality,
          visit_description, referring_doctor, normalized_doctor, pro_name, status, receipt_status,
          billable_items, total_price, total_discount, total_net, total_payment, payment_method, revenue_booked_in, balance_amount,
          notes, raw_json, created_at)
         VALUES
         (:source_file, :source_type, :visit_id, :visit_date, :patient_id, :patient_name, :sex, :modality,
          :visit_description, :referring_doctor, :normalized_doctor, :pro_name, :status, :receipt_status,
          :billable_items, :total_price, :total_discount, :total_net, :total_payment, :payment_method, :revenue_booked_in, :balance_amount,
          :notes, :raw_json, :created_at)'
    );

    $insertWallet = $db->prepare(
        'INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
         VALUES (:pro_name, 0, :updated_at)
         ON CONFLICT(pro_name) DO NOTHING'
    );

    $createdAt = nowIso();
    $db->beginTransaction();
    try {
        $index = 1;
        $insertedRows = 0;
        foreach ($templates as $template) {
            $doctor = $doctorMap[$template['code']] ?? null;
            if (!$doctor) {
                continue;
            }

            $baseDate = $template['month'] === 'previous' ? $previousMonthDate : $currentMonthDate;
            $visitDate = $baseDate
                ->setDate((int) $baseDate->format('Y'), (int) $baseDate->format('m'), (int) $template['day'])
                ->setTime(10 + ($index % 7), 15, 0)
                ->format(DATE_ATOM);

            $totalPrice = (float) $template['price'];
            $totalDiscount = (float) $template['discount'];
            $totalNet = max(0.0, $totalPrice - $totalDiscount);

            $insert->execute([
                ':source_file' => 'demo-seed.xlsx',
                ':source_type' => 'demo_seed',
                ':visit_id' => sprintf('DEMO-%04d', $index),
                ':visit_date' => $visitDate,
                ':patient_id' => sprintf('P-%04d', 1000 + $index),
                ':patient_name' => $template['patient'],
                ':sex' => $template['sex'],
                ':modality' => $template['modality'],
                ':visit_description' => $template['item'],
                ':referring_doctor' => $doctor['doctor_name'],
                ':normalized_doctor' => $doctor['normalized_name'],
                ':pro_name' => $doctor['present_pro'] ?: 'UNASSIGNED',
                ':status' => 'completed',
                ':receipt_status' => 'paid',
                ':billable_items' => $template['item'],
                ':total_price' => $totalPrice,
                ':total_discount' => $totalDiscount,
                ':total_net' => $totalNet,
                ':total_payment' => $totalNet,
                ':payment_method' => match ($index % 3) {
                    1 => 'Cash',
                    2 => 'Card',
                    default => 'UPI',
                },
                ':revenue_booked_in' => ($index % 2 === 0) ? 'Jivada' : 'Sukhmani',
                ':balance_amount' => 0.0,
                ':notes' => 'Demo seeded transaction',
                ':raw_json' => json_encode([
                    'seed' => true,
                    'doctorCode' => $template['code'],
                    'item' => $template['item']
                ], JSON_UNESCAPED_UNICODE),
                ':created_at' => $createdAt
            ]);

            if (!empty($doctor['present_pro'])) {
                $insertWallet->execute([
                    ':pro_name' => $doctor['present_pro'],
                    ':updated_at' => $createdAt
                ]);
            }

            $insertedRows += 1;
            $index += 1;
        }

        $db->prepare(
            'INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
             VALUES (:type, :file_name, :row_count, :meta_json, :uploaded_at)'
        )->execute([
            ':type' => 'transaction_data',
            ':file_name' => 'demo-seed.xlsx',
            ':row_count' => $insertedRows,
            ':meta_json' => json_encode(['sourceType' => 'demo_seed'], JSON_UNESCAPED_UNICODE),
            ':uploaded_at' => $createdAt
        ]);

        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function seedDemoEngineAndPayments(PDO $db): void
{
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $year = (int) $now->format('Y');
    $month = (int) $now->format('m');

    $hasDemoTransactions = $db->prepare(
        'SELECT COUNT(*) AS count
         FROM transactions
         WHERE source_type = :source_type
           AND visit_date IS NOT NULL
           AND visit_date >= :start
           AND visit_date <= :end'
    );
    $range = buildDateRange($year, $month);
    $hasDemoTransactions->execute([
        ':source_type' => 'demo_seed',
        ':start' => $range['start'],
        ':end' => $range['end']
    ]);
    $txCount = (int) $hasDemoTransactions->fetch()['count'];
    if ($txCount === 0) {
        return;
    }

    $runStmt = $db->prepare(
        'SELECT id
         FROM engine_runs
         WHERE period_year = :period_year AND period_month = :period_month
         ORDER BY run_at DESC
         LIMIT 1'
    );
    $runStmt->execute([':period_year' => $year, ':period_month' => $month]);
    $runRow = $runStmt->fetch();

    if (!$runRow) {
        $runResult = runEngineForPeriod($db, $year, $month);
        $runId = (int) ($runResult['runId'] ?? 0);
    } else {
        $runId = (int) $runRow['id'];
    }

    if ($runId <= 0) {
        return;
    }

    $paymentCountStmt = $db->prepare('SELECT COUNT(*) AS count FROM payments WHERE run_id = :run_id');
    $paymentCountStmt->execute([':run_id' => $runId]);
    $paymentCount = (int) $paymentCountStmt->fetch()['count'];
    if ($paymentCount > 0) {
        return;
    }

    generatePaymentsFromRun($db, $runId);

    $paymentCountStmt->execute([':run_id' => $runId]);
    $paymentCountAfterGenerate = (int) $paymentCountStmt->fetch()['count'];
    if ($paymentCountAfterGenerate > 0) {
        return;
    }

    $hasManualDemoPayments = (int) $db->query("SELECT COUNT(*) AS count FROM payments WHERE notes = 'Demo seeded payment'")->fetch()['count'];
    if ($hasManualDemoPayments > 0) {
        return;
    }

    $demoDoctors = $db->query(
        "SELECT doctor_name, present_pro
         FROM doctor_master
         WHERE doctor_code IN ('DEMO-DR-A01', 'DEMO-DR-B01')
         ORDER BY doctor_code ASC"
    )->fetchAll();
    if (count($demoDoctors) === 0) {
        return;
    }

    $insertPayment = $db->prepare(
        'INSERT INTO payments
         (run_id, doctor_name, pro_name, period_year, period_month, amount, status, approval_status,
          cash_in_hand_snapshot, disbursed_on, notes, created_at, updated_at)
         VALUES
         (:run_id, :doctor_name, :pro_name, :period_year, :period_month, :amount, :status, :approval_status,
          :cash_in_hand_snapshot, NULL, :notes, :created_at, :updated_at)'
    );
    $insertApproval = $db->prepare(
        "INSERT INTO approval_requests
         (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
         VALUES ('approval_of_disbursal', :entity_id, :payload_json, 'pending', :requested_by, NULL, :created_at, :updated_at)"
    );

    $db->beginTransaction();
    try {
        foreach ($demoDoctors as $idx => $doctor) {
            $amount = $idx === 0 ? 18500.0 : 14250.0;
            $createdAt = nowIso();

            $insertPayment->execute([
                ':run_id' => $runId,
                ':doctor_name' => $doctor['doctor_name'],
                ':pro_name' => $doctor['present_pro'] ?: 'UNASSIGNED',
                ':period_year' => $year,
                ':period_month' => $month,
                ':amount' => $amount,
                ':status' => 'pending',
                ':approval_status' => 'pending',
                ':cash_in_hand_snapshot' => 0,
                ':notes' => 'Demo seeded payment',
                ':created_at' => $createdAt,
                ':updated_at' => $createdAt
            ]);

            $paymentId = (int) $db->lastInsertId();
            $insertApproval->execute([
                ':entity_id' => (string) $paymentId,
                ':payload_json' => json_encode([
                    'runId' => $runId,
                    'doctorName' => $doctor['doctor_name'],
                    'amount' => $amount,
                    'approvalFlags' => 0,
                    'seeded' => true
                ], JSON_UNESCAPED_UNICODE),
                ':requested_by' => 'system-seed',
                ':created_at' => $createdAt,
                ':updated_at' => $createdAt
            ]);
        }

        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function parseToken(string $token, string $secret): ?array
{
    $segments = explode('.', $token);
    if (count($segments) !== 2) {
        return null;
    }

    [$data, $signature] = $segments;

    $payload = json_decode(base64UrlDecode($data), true);
    if (!is_array($payload)) {
        return null;
    }

    $expectedSig = hash_hmac('sha256', $data, $secret, true);
    $providedSig = base64UrlDecode($signature);
    if (!hash_equals($expectedSig, (string) $providedSig)) {
        return null;
    }

    $exp = $payload['exp'] ?? 0;
    if (!is_int($exp) && !ctype_digit((string) $exp)) {
        return null;
    }

    if ((int) $exp < time()) {
        return null;
    }

    return $payload;
}

function createToken(array $user, string $secret): string
{
    $payload = [
        'id' => (int) $user['id'],
        'email' => (string) $user['email'],
        'role' => (string) $user['role'],
        'iat' => time(),
        'exp' => time() + TOKEN_TTL_SECONDS
    ];

    $encoded = base64UrlEncode(json_encode($payload));
    $signature = hash_hmac('sha256', $encoded, $secret, true);

    return $encoded . '.' . base64UrlEncode($signature);
}

function base64UrlEncode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function base64UrlDecode(string $value): string
{
    $value = strtr($value, '-_', '+/');
    $padding = 4 - (strlen($value) % 4);
    if ($padding !== 4) {
        $value .= str_repeat('=', $padding);
    }

    return (string) base64_decode($value, true);
}

function requestBody(): array
{
    static $body = null;

    if ($body !== null) {
        return $body;
    }

    $raw = file_get_contents('php://input');
    if (!$raw) {
        return $body = [];
    }

    $decoded = json_decode($raw, true);
    return $body = is_array($decoded) ? $decoded : [];
}

function intSafe($value, $fallback = null)
{
    if ($value === null || $value === '') {
        return $fallback;
    }

    if (is_int($value)) {
        return $value;
    }

    if (is_string($value) && !preg_match('/^-?\d+$/', trim($value))) {
        return $fallback;
    }

    $value = (int) $value;
    return is_numeric($value) ? $value : $fallback;
}

function normalizeText($value): string
{
    if ($value === null) {
        return '';
    }

    $text = strtoupper((string) $value);
    $text = preg_replace('/[^A-Z0-9]+/u', ' ', $text);
    $text = preg_replace('/\s+/u', ' ', $text);

    return trim((string) $text);
}

function parseNumber($value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }

    if (is_numeric($value)) {
        return (float) $value;
    }

    $clean = str_replace(',', '', (string) $value);
    $clean = trim($clean);
    if ($clean === '') {
        return null;
    }

    if (!is_numeric($clean)) {
        return null;
    }

    return (float) $clean;
}

function parseDate($value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }

    if ($value instanceof DateTimeInterface) {
        $value = clone $value;
        $value->setTimezone(new DateTimeZone('UTC'));
        return $value->format(DATE_ATOM);
    }

    if (is_numeric($value)) {
        try {
            $date = Date::excelToDateTimeObject((float) $value);
            $date->setTimezone(new DateTimeZone('UTC'));
            return $date->format(DATE_ATOM);
        } catch (Throwable $e) {
            // fall through
        }
    }

    try {
        $date = new DateTimeImmutable((string) $value, new DateTimeZone('UTC'));
        return $date->format(DATE_ATOM);
    } catch (Throwable $e) {
        return null;
    }
}

function readWorkbook(string $filePath)
{
    return IOFactory::load($filePath);
}

function sheetRows($sheet): array
{
    $rows = $sheet->toArray('', true, false, false);
    $cleanRows = [];

    foreach ($rows as $row) {
        $hasValue = false;
        $normalized = [];

        foreach ($row as $col) {
            if ($col !== null && $col !== '') {
                $hasValue = true;
            }
            $normalized[] = $col;
        }

        if (!$hasValue) {
            continue;
        }

        $cleanRows[] = $normalized;
    }

    return $cleanRows;
}

function findHeaderRow(array $rows, array $requiredKeywords): int
{
    $required = array_map('normalizeText', $requiredKeywords);
    $scanLimit = min(count($rows), 60);

    for ($i = 0; $i < $scanLimit; $i += 1) {
        $row = $rows[$i] ?? [];
        $normalizedRow = array_map('normalizeText', $row);

        $hasAll = true;
        foreach ($required as $keyword) {
            $found = false;
            foreach ($normalizedRow as $cell) {
                if (strpos((string) $cell, $keyword) !== false) {
                    $found = true;
                    break;
                }
            }
            if (!$found) {
                $hasAll = false;
                break;
            }
        }

        if ($hasAll) {
            return $i;
        }
    }

    return -1;
}

function buildHeaderIndex(array $headers): array
{
    $map = [];

    foreach ($headers as $index => $value) {
        $rawValue = trim((string) $value);
        $normalized = normalizeText($rawValue);
        if ($normalized === '') {
            continue;
        }

        if (!array_key_exists($normalized, $map)) {
            $map[$normalized] = [
                'index' => (int) $index,
                'raw' => $rawValue
            ];
            continue;
        }

        $existing = $map[$normalized];
        $preferCurrent = str_starts_with(ltrim((string) ($existing['raw'] ?? '')), '#') && !str_starts_with(ltrim($rawValue), '#');
        if ($preferCurrent) {
            $map[$normalized] = [
                'index' => (int) $index,
                'raw' => $rawValue
            ];
        }
    }

    $flat = [];
    foreach ($map as $normalized => $entry) {
        $flat[$normalized] = (int) ($entry['index'] ?? -1);
    }

    return $flat;
}

function indexForExact(array $headerIndex, array $candidates): int
{
    foreach (array_map('normalizeText', $candidates) as $candidate) {
        if (array_key_exists($candidate, $headerIndex)) {
            return (int) $headerIndex[$candidate];
        }
    }

    return -1;
}

function indexFor(array $headerIndex, array $candidates): int
{
    $normalizedCandidates = array_map('normalizeText', $candidates);
    foreach ($normalizedCandidates as $candidate) {
        if (array_key_exists($candidate, $headerIndex)) {
            return (int) $headerIndex[$candidate];
        }
    }

    foreach ($headerIndex as $key => $idx) {
        foreach ($normalizedCandidates as $candidate) {
            if (strpos((string) $key, $candidate) !== false) {
                return (int) $idx;
            }
        }
    }

    return -1;
}

function parseReferenceWorkbook(string $filePath): array
{
    $workbook = readWorkbook($filePath);

    $serviceRows = [];
    $discountRows = [];
    $doctorRows = [];

    $serviceSheet = $workbook->getSheetByName('SERVICE PRICE LIST');
    if ($serviceSheet !== null) {
        $serviceRows = sheetRows($serviceSheet);
    }

    $discountSheet = $workbook->getSheetByName('S. DISCOUNT CALCULATION ');
    if ($discountSheet !== null) {
        $discountRows = sheetRows($discountSheet);
    }

    $doctorSheet = $workbook->getSheetByName('S. DISCOUNT DOCTOR GROUP 2');
    if ($doctorSheet !== null) {
        $doctorRows = sheetRows($doctorSheet);
    }

    return [
        'fileName' => basename($filePath),
        'services' => parseServicePrices($serviceRows),
        'discountRules' => parseDiscountRules($discountRows),
        'doctors' => parseDoctorMaster($doctorRows)
    ];
}

function parseServicePrices(array $rows): array
{
    $headerRow = findHeaderRow($rows, ['Name', 'Unit Price']);
    if ($headerRow === -1) {
        return [];
    }

    $headers = $rows[$headerRow] ?? [];
    $index = buildHeaderIndex($headers);

    $nameIndex = indexFor($index, ['Name']);
    $priceIndex = indexFor($index, ['Unit Price']);
    $currencyIndex = indexFor($index, ['Unit Currency']);

    $services = [];
    for ($i = $headerRow + 1; $i < count($rows); $i += 1) {
        $row = $rows[$i] ?? [];
        $name = isset($row[$nameIndex]) ? trim((string) $row[$nameIndex]) : '';
        if ($name === '') {
            continue;
        }

        $services[] = [
            'name' => $name,
            'normalizedName' => normalizeText($name),
            'unitPrice' => parseNumber($row[$priceIndex] ?? null),
            'currency' => isset($row[$currencyIndex]) ? trim((string) $row[$currencyIndex]) : null
        ];
    }

    return $services;
}

function parseDiscountRules(array $rows): array
{
    $headerRow = findHeaderRow($rows, ['Modalties', 'Name', 'MAXIMUM S. DISCOUNT PRICE']);
    if ($headerRow === -1) {
        return [];
    }

    $headers = $rows[$headerRow] ?? [];
    $index = buildHeaderIndex($headers);

    $modalityIndex = indexFor($index, ['Modalties']);
    $nameIndex = indexFor($index, ['Name']);
    $maxDiscountIndex = indexFor($index, ['MAXIMUM S. DISCOUNT PRICE']);
    $exceptionIndex = indexFor($index, ['Exception']);

    $groupColumns = [];
    foreach ($headers as $idx => $header) {
        $h = strtoupper(trim((string) $header));
        if (strpos($h, 'GROUP') === false) {
            continue;
        }

        $groupCode = null;
        if (preg_match('/GROUP\s*([A-Z]+)/', $h, $matches) === 1) {
            $groupCode = $matches[1] ?? null;
        } elseif (strpos($h, 'NEL') !== false) {
            $groupCode = 'NEL';
        } elseif (substr($h, -1) === 'G') {
            $groupCode = 'G';
        }

        if ($groupCode !== null) {
            $groupColumns[] = ['idx' => (int) $idx, 'code' => $groupCode];
        }
    }

    $groupColumnsUnique = [];
    foreach ($groupColumns as $group) {
        if (!array_key_exists($group['code'], $groupColumnsUnique)) {
            $groupColumnsUnique[$group['code']] = $group['idx'];
        }
    }

    $out = [];
    for ($i = $headerRow + 1; $i < count($rows); $i += 1) {
        $row = $rows[$i] ?? [];
        $itemName = isset($row[$nameIndex]) ? trim((string) $row[$nameIndex]) : '';
        if ($itemName === '') {
            continue;
        }

        $groupValues = [];
        foreach ($groupColumnsUnique as $groupCode => $idx) {
            $value = parseNumber($row[$idx] ?? null);
            if ($value !== null) {
                $groupValues[$groupCode] = $value;
            }
        }

        $maxDiscount = parseNumber($row[$maxDiscountIndex] ?? null);
        if (count($groupValues) === 0 && $maxDiscount === null) {
            continue;
        }

        $out[] = [
            'itemName' => $itemName,
            'normalizedItem' => normalizeText($itemName),
            'modality' => isset($row[$modalityIndex]) ? trim((string) $row[$modalityIndex]) : null,
            'maxDiscountPrice' => $maxDiscount,
            'groupValues' => $groupValues,
            'exceptionText' => isset($row[$exceptionIndex]) ? trim((string) $row[$exceptionIndex]) : null
        ];
    }

    return $out;
}

function parseDoctorMaster(array $rows): array
{
    $headerRow = findHeaderRow($rows, ['DR.NAME', 'INCENTIVE GROUP']);
    if ($headerRow === -1) {
        return [];
    }

    $headers = $rows[$headerRow] ?? [];
    $index = buildHeaderIndex($headers);

    $fieldIndexes = [
        'location' => indexFor($index, ['LOCATION']),
        'doctorName' => indexFor($index, ['DR.NAME']),
        'doctorCode' => indexFor($index, ['DR. NAME CODE', 'DR NAME CODE']),
        'hospitalName' => indexFor($index, ['HOSPITAL NAME']),
        'degree' => indexFor($index, ['DEGREE']),
        'contactNo' => indexFor($index, ['CONTACT NO']),
        'oldPro' => indexFor($index, ['OLD PRO']),
        'presentPro' => indexFor($index, ['PRESENT PRO']),
        'proDateChange' => indexFor($index, ['PRO DATE CHANGE']),
        'hospitalAddress' => indexFor($index, ['HOSPITAL ADDRESS']),
        'area' => indexFor($index, ['AREA']),
        'leadScore' => indexFor($index, ['LEAD SCORE']),
        'leadStage' => indexFor($index, ['LEAD STAGE']),
        'incentiveGroup' => indexFor($index, ['INCENTIVE GROUP']),
        'incentiveCycle' => indexFor($index, ['INCENTIVE CYCLE']),
        'conversionIncentiveGroup' => indexFor($index, ['CONVERSION INCENTIVE GROUP']),
        'targetInvestigation' => indexFor($index, ['TARGET INVESTIGATION']),
        'reportingDoctor' => indexFor($index, ['REPORTING DOCTOR']),
        'confirmationStatus' => indexFor($index, ['CONFIRMATION STATUS', 'CONFIRMATION']),
        'confirmationRemarks' => indexFor($index, ['CONFIRMATION REMARKS', 'CONFIRMATION REMARK'])
    ];

    $out = [];
    for ($i = $headerRow + 1; $i < count($rows); $i += 1) {
        $row = $rows[$i] ?? [];
        $doctorName = isset($row[$fieldIndexes['doctorName']]) ? trim((string) $row[$fieldIndexes['doctorName']]) : '';
        if ($doctorName === '') {
            continue;
        }

        $group = null;
        $rawGroup = $row[$fieldIndexes['incentiveGroup']] ?? null;
        if ($rawGroup !== null && $rawGroup !== '') {
            $group = trim((string) $rawGroup);
            $group = strtoupper($group);
        }

        $confirmationStatus = null;
        $rawConfirmationStatus = $fieldIndexes['confirmationStatus'] !== -1 ? ($row[$fieldIndexes['confirmationStatus']] ?? null) : null;
        if ($rawConfirmationStatus !== null && trim((string) $rawConfirmationStatus) !== '') {
            $confirmationStatus = strtolower(trim((string) $rawConfirmationStatus));
            $confirmationStatus = str_replace([' ', '-'], '_', $confirmationStatus);
        }
        if (!in_array($confirmationStatus, ['pending', 'confirmed', 'not_confirmed'], true)) {
            $confirmationStatus = 'pending';
        }

        $out[] = [
            'location' => isset($row[$fieldIndexes['location']]) ? trim((string) $row[$fieldIndexes['location']]) : null,
            'doctorName' => $doctorName,
            'normalizedName' => normalizeText($doctorName),
            'doctorCode' => isset($row[$fieldIndexes['doctorCode']]) ? trim((string) $row[$fieldIndexes['doctorCode']]) : null,
            'hospitalName' => isset($row[$fieldIndexes['hospitalName']]) ? trim((string) $row[$fieldIndexes['hospitalName']]) : null,
            'degree' => isset($row[$fieldIndexes['degree']]) ? trim((string) $row[$fieldIndexes['degree']]) : null,
            'contactNo' => isset($row[$fieldIndexes['contactNo']]) ? trim((string) $row[$fieldIndexes['contactNo']]) : null,
            'oldPro' => isset($row[$fieldIndexes['oldPro']]) ? trim((string) $row[$fieldIndexes['oldPro']]) : null,
            'presentPro' => isset($row[$fieldIndexes['presentPro']]) ? trim((string) $row[$fieldIndexes['presentPro']]) : null,
            'proDateChange' => isset($row[$fieldIndexes['proDateChange']]) ? parseDate($row[$fieldIndexes['proDateChange']]) : null,
            'hospitalAddress' => isset($row[$fieldIndexes['hospitalAddress']]) ? trim((string) $row[$fieldIndexes['hospitalAddress']]) : null,
            'area' => isset($row[$fieldIndexes['area']]) ? trim((string) $row[$fieldIndexes['area']]) : null,
            'leadScore' => isset($row[$fieldIndexes['leadScore']]) ? trim((string) $row[$fieldIndexes['leadScore']]) : null,
            'leadStage' => isset($row[$fieldIndexes['leadStage']]) ? trim((string) $row[$fieldIndexes['leadStage']]) : null,
            'incentiveGroup' => $group,
            'incentiveCycle' => isset($row[$fieldIndexes['incentiveCycle']]) ? trim((string) $row[$fieldIndexes['incentiveCycle']]) : null,
            'conversionIncentiveGroup' => isset($row[$fieldIndexes['conversionIncentiveGroup']])
                ? trim((string) $row[$fieldIndexes['conversionIncentiveGroup']])
                : null,
            'targetInvestigation' => isset($row[$fieldIndexes['targetInvestigation']])
                ? trim((string) $row[$fieldIndexes['targetInvestigation']])
                : null,
            'reportingDoctor' => isset($row[$fieldIndexes['reportingDoctor']]) ? trim((string) $row[$fieldIndexes['reportingDoctor']]) : null,
            'confirmationStatus' => $confirmationStatus,
            'confirmationRemarks' => isset($row[$fieldIndexes['confirmationRemarks']])
                ? trim((string) $row[$fieldIndexes['confirmationRemarks']])
                : null,
            'verified' => false
        ];
    }

    return $out;
}

function parseSoftwareRequirementsWorkbook(string $filePath): array
{
    $workbook = readWorkbook($filePath);
    $sheet = $workbook->getSheet($workbook->getFirstSheetIndex());
    $rows = sheetRows($sheet);

    $out = [];
    $category = 'General';

    foreach ($rows as $row) {
        $value = null;
        foreach ($row as $cell) {
            if ($cell !== null && $cell !== '') {
                $value = $cell;
                break;
            }
        }

        if ($value === null) {
            continue;
        }

        $text = trim((string) $value);
        if ($text === '') {
            continue;
        }

        if (str_ends_with($text, ':')) {
            $category = trim(rtrim($text, ':'));
            continue;
        }

        $cleaned = preg_replace('/^\d+\.?\s*/', '', $text);
        $cleaned = trim((string) $cleaned);
        if ($cleaned === '') {
            continue;
        }

        $out[] = [
            'category' => $category,
            'requirementText' => $cleaned
        ];
    }

    return [
        'fileName' => basename($filePath),
        'requirements' => $out
    ];
}

function parseTransactionsWorkbook(string $filePath): array
{
    $workbook = readWorkbook($filePath);
    $allRows = [];
    $containsIncentiveRows = false;
    $isIncentiveOnlyWorkbook = false;

    foreach ($workbook->getWorksheetIterator() as $sheet) {
        $rows = sheetRows($sheet);
        if (!$rows) {
            continue;
        }

        $headerRow = findHeaderRow($rows, ['Patient ID', 'Referring Doctor']);
        if ($headerRow === -1) {
            continue;
        }

        $headers = $rows[$headerRow] ?? [];
        $headerIndex = buildHeaderIndex($headers);

        $fields = [
            'visitId' => indexFor($headerIndex, ['Visit ID', 'srno', 'Srno', 'SRNO']),
            'visitDate' => indexFor($headerIndex, ['Visit Date Time', 'Date', 'Last Receipt Date Time']),
            'patientId' => indexFor($headerIndex, ['Patient ID']),
            'patientName' => indexFor($headerIndex, ['Patient Name']),
            'sex' => indexFor($headerIndex, ['Sex']),
            'modality' => indexFor($headerIndex, ['Modalities', 'Procedure']),
            'visitDescription' => indexFor($headerIndex, ['Visit Description']),
            'referringDoctor' => indexFor($headerIndex, ['Referring Doctor']),
            'proName' => indexFor($headerIndex, ['PRO Name']),
            'status' => indexFor($headerIndex, ['Visit Status', 'Status']),
            'receiptStatus' => indexFor($headerIndex, ['Receipt Status', 'Status']),
            'billableItems' => indexFor($headerIndex, transactionBillableItemHeaders()),
            'totalPrice' => indexFor($headerIndex, ['Total Price', 'Price']),
            'totalDiscount' => indexFor($headerIndex, ['Total Discount Amount', 'Dis']),
            'totalNet' => indexFor($headerIndex, ['Total Net Price', 'Net']),
            'totalPayment' => indexFor($headerIndex, ['Total Payment Received', 'Rece']),
            'paymentMethod' => indexFor($headerIndex, transactionPaymentMethodHeaders()),
            'revenueBookedIn' => indexFor($headerIndex, transactionRevenueBookedInHeaders()),
            'balanceAmount' => indexFor($headerIndex, ['Balance Amount']),
            'notes' => indexFor($headerIndex, ['Notes', 'S. Dis Remark']),
            'doctorAlias' => indexFor($headerIndex, ['Doctor']),
            'incentiveAmount' => indexFor($headerIndex, transactionIncentiveAmountHeaders()),
            'incentiveMasterDiscount' => indexFor($headerIndex, transactionIncentiveMasterHeaders()),
            'incentivePayableAmount' => indexFor($headerIndex, transactionIncentivePayableHeaders()),
            'incentiveVarianceAmount' => indexForExact($headerIndex, transactionIncentiveVarianceHeaders()),
            'incentiveDoctorGroup' => indexFor($headerIndex, transactionIncentiveGroupHeaders()),
        ];

        $hasLegacyIncentiveHeaders = indexForExact($headerIndex, transactionLegacyIncentiveHeaders()) !== -1;
        $hasCombinedIncentiveHeaders = indexFor($headerIndex, transactionCombinedIncentiveHeaders()) !== -1;
        $hasIncentiveColumns =
            $fields['incentiveAmount'] !== -1 ||
            $fields['incentiveMasterDiscount'] !== -1 ||
            $fields['incentivePayableAmount'] !== -1 ||
            $fields['incentiveVarianceAmount'] !== -1;

        if ($hasIncentiveColumns) {
            $containsIncentiveRows = true;
        }
        $sheetIsIncentiveOnly =
            $hasIncentiveColumns &&
            $hasLegacyIncentiveHeaders &&
            !$hasCombinedIncentiveHeaders &&
            $fields['paymentMethod'] === -1 &&
            $fields['revenueBookedIn'] === -1;
        if ($sheetIsIncentiveOnly) {
            $isIncentiveOnlyWorkbook = true;
        }

        $sourceType = $sheetIsIncentiveOnly ? 'incentive_line' : 'dashboard';

        for ($i = $headerRow + 1; $i < count($rows); $i += 1) {
            $row = $rows[$i] ?? [];

            $patientId = $fields['patientId'] !== -1 ? ($row[$fields['patientId']] ?? null) : null;
            $patientName = $fields['patientName'] !== -1 ? ($row[$fields['patientName']] ?? null) : null;
            $referringDoctor = $fields['referringDoctor'] !== -1 ? ($row[$fields['referringDoctor']] ?? null) : null;
            $doctorAlias = $fields['doctorAlias'] !== -1 ? ($row[$fields['doctorAlias']] ?? null) : null;

            $hasIdentifiers =
                ($patientId !== null && $patientId !== '') ||
                ($patientName !== null && $patientName !== '') ||
                ($referringDoctor !== null && $referringDoctor !== '') ||
                ($doctorAlias !== null && $doctorAlias !== '');

            if (!$hasIdentifiers) {
                continue;
            }

            $itemValue = $fields['billableItems'] !== -1 ? ($row[$fields['billableItems']] ?? null) : null;
            $referringDoctorText = $referringDoctor !== null ? trim((string) $referringDoctor) : '';
            $doctorAliasText = $doctorAlias !== null ? trim((string) $doctorAlias) : '';
            if ($referringDoctorText === '' && $doctorAliasText !== '') {
                $referringDoctorText = $doctorAliasText;
            }

            $rowData = [
                'sourceFile' => basename($filePath),
                'sourceType' => $sourceType,
                'sourceSheet' => $sheet->getTitle(),
                'visitId' => ($fields['visitId'] !== -1 && isset($row[$fields['visitId']])) ? trim((string) $row[$fields['visitId']]) : null,
                'visitDate' => $fields['visitDate'] !== -1 ? parseDate($row[$fields['visitDate']] ?? null) : null,
                'patientId' => $patientId !== null ? trim((string) $patientId) : null,
                'patientName' => $patientName !== null ? trim((string) $patientName) : null,
                'sex' => $fields['sex'] !== -1 && isset($row[$fields['sex']]) ? trim((string) $row[$fields['sex']]) : null,
                'modality' => $fields['modality'] !== -1 && isset($row[$fields['modality']]) ? trim((string) $row[$fields['modality']]) : null,
                'visitDescription' => $fields['visitDescription'] !== -1 && isset($row[$fields['visitDescription']]) ? trim((string) $row[$fields['visitDescription']]) : null,
                'referringDoctor' => $referringDoctorText !== '' ? $referringDoctorText : null,
                'normalizedDoctor' => normalizeText($referringDoctorText !== '' ? $referringDoctorText : $doctorAliasText),
                'proName' => $fields['proName'] !== -1 && isset($row[$fields['proName']]) ? trim((string) $row[$fields['proName']]) : null,
                'status' => $fields['status'] !== -1 && isset($row[$fields['status']]) ? trim((string) $row[$fields['status']]) : null,
                'receiptStatus' => $fields['receiptStatus'] !== -1 && isset($row[$fields['receiptStatus']]) ? trim((string) $row[$fields['receiptStatus']]) : null,
                'billableItems' => $itemValue !== null && $itemValue !== '' ? trim((string) $itemValue) : null,
                'totalPrice' => $fields['totalPrice'] !== -1 ? parseNumber($row[$fields['totalPrice']] ?? null) : null,
                'totalDiscount' => $fields['totalDiscount'] !== -1 ? parseNumber($row[$fields['totalDiscount']] ?? null) : null,
                'totalNet' => $fields['totalNet'] !== -1 ? parseNumber($row[$fields['totalNet']] ?? null) : null,
                'totalPayment' => $fields['totalPayment'] !== -1 ? parseNumber($row[$fields['totalPayment']] ?? null) : null,
                'paymentMethod' => $fields['paymentMethod'] !== -1 && isset($row[$fields['paymentMethod']]) ? trim((string) $row[$fields['paymentMethod']]) : null,
                'revenueBookedIn' => $fields['revenueBookedIn'] !== -1 && isset($row[$fields['revenueBookedIn']]) ? trim((string) $row[$fields['revenueBookedIn']]) : null,
                'balanceAmount' => $fields['balanceAmount'] !== -1 ? parseNumber($row[$fields['balanceAmount']] ?? null) : null,
                'notes' => $fields['notes'] !== -1 && isset($row[$fields['notes']]) ? trim((string) $row[$fields['notes']]) : null,
                'incentiveAmount' => $fields['incentiveAmount'] !== -1 ? parseNumber($row[$fields['incentiveAmount']] ?? null) : null,
                'incentiveMasterDiscount' => $fields['incentiveMasterDiscount'] !== -1 ? parseNumber($row[$fields['incentiveMasterDiscount']] ?? null) : null,
                'incentivePayableAmount' => $fields['incentivePayableAmount'] !== -1 ? parseNumber($row[$fields['incentivePayableAmount']] ?? null) : null,
                'incentiveVarianceAmount' => $fields['incentiveVarianceAmount'] !== -1 ? parseNumber($row[$fields['incentiveVarianceAmount']] ?? null) : null,
                'incentiveDoctorGroup' => $fields['incentiveDoctorGroup'] !== -1 && isset($row[$fields['incentiveDoctorGroup']]) ? trim((string) $row[$fields['incentiveDoctorGroup']]) : null,
                'rawJson' => json_encode(
                    array_reduce(array_keys($headers), function ($carry, $idx) use ($headers, $row) {
                        $carry[(string) ($headers[$idx] ?? ('col_' . ($idx + 1)))] = $row[$idx] ?? null;
                        return $carry;
                    }, []),
                    JSON_UNESCAPED_UNICODE
                )
            ];

            if ($rowData['billableItems'] === null && $rowData['visitDescription']) {
                $rowData['billableItems'] = $rowData['visitDescription'];
            }

            $allRows[] = $rowData;
        }
    }

    return [
        'fileName' => basename($filePath),
        'transactions' => $allRows,
        'containsIncentiveRows' => $containsIncentiveRows,
        'isIncentiveOnlyWorkbook' => $isIncentiveOnlyWorkbook
    ];
}

function buildDateRange(int $periodYear, int $periodMonth): array
{
    $start = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $periodYear, $periodMonth), new DateTimeZone('UTC'));
    $end = $start->modify('last day of this month')->setTime(23, 59, 59);

    return [
        'start' => $start->format(DATE_ATOM),
        'end' => $end->format(DATE_ATOM),
        'daysInMonth' => (int) $end->format('d')
    ];
}

function summarizeTransactionPeriods(array $transactions): array
{
    $periodCounts = [];

    foreach ($transactions as $row) {
        $visitDate = trim((string) ($row['visitDate'] ?? ''));
        if ($visitDate === '') {
            continue;
        }

        try {
            $date = new DateTimeImmutable($visitDate);
        } catch (Throwable $error) {
            continue;
        }

        $year = (int) $date->format('Y');
        $month = (int) $date->format('m');
        $key = sprintf('%04d-%02d', $year, $month);

        if (!isset($periodCounts[$key])) {
            $periodCounts[$key] = [
                'year' => $year,
                'month' => $month,
                'count' => 0,
            ];
        }

        $periodCounts[$key]['count'] += 1;
    }

    if ($periodCounts === []) {
        return [
            'primaryYear' => null,
            'primaryMonth' => null,
            'periods' => [],
        ];
    }

    uasort($periodCounts, static function (array $left, array $right): int {
        $countCompare = $right['count'] <=> $left['count'];
        if ($countCompare !== 0) {
            return $countCompare;
        }

        $leftKey = sprintf('%04d-%02d', $left['year'], $left['month']);
        $rightKey = sprintf('%04d-%02d', $right['year'], $right['month']);
        return strcmp($leftKey, $rightKey);
    });

    $sorted = array_values($periodCounts);
    $primary = $sorted[0];

    return [
        'primaryYear' => $primary['year'],
        'primaryMonth' => $primary['month'],
        'periods' => $sorted,
    ];
}

function formatMatchAmount($value): string
{
    $number = parseNumber($value);
    if ($number === null) {
        return '';
    }

    return number_format(round($number, 2), 2, '.', '');
}

function buildTransactionMatchKey(array $row): string
{
    $patientId = normalizeText($row['patientId'] ?? $row['patient_id'] ?? null);
    $patientName = normalizeText($row['patientName'] ?? $row['patient_name'] ?? null);
    $doctor = trim((string) ($row['normalizedDoctor'] ?? $row['normalized_doctor'] ?? ''));
    if ($doctor === '') {
        $doctor = normalizeText($row['referringDoctor'] ?? $row['referring_doctor'] ?? null);
    }

    $item = normalizeText($row['billableItems'] ?? $row['billable_items'] ?? $row['visitDescription'] ?? $row['visit_description'] ?? null);
    $identifier = $patientId !== '' ? $patientId : $patientName;

    if ($identifier === '' || $doctor === '' || $item === '') {
        return '';
    }

    return implode('|', [
        $identifier,
        $doctor,
        $item,
        formatMatchAmount($row['totalPrice'] ?? $row['total_price'] ?? null),
        formatMatchAmount($row['totalDiscount'] ?? $row['total_discount'] ?? null),
        formatMatchAmount($row['totalNet'] ?? $row['total_net'] ?? null),
    ]);
}

function importIncentiveWorkbookRows(PDO $db, string $fileName, array $rows, int $periodYear, int $periodMonth): array
{
    $range = buildDateRange($periodYear, $periodMonth);
    $txStmt = $db->prepare(
        'SELECT patient_id, patient_name, normalized_doctor, referring_doctor, billable_items, visit_description,
                total_price, total_discount, total_net
         FROM transactions
         WHERE visit_date IS NOT NULL
           AND visit_date >= :start
           AND visit_date <= :end'
    );
    $txStmt->execute([':start' => $range['start'], ':end' => $range['end']]);

    $transactionKeyMap = [];
    foreach ($txStmt->fetchAll() as $transactionRow) {
        $matchKey = buildTransactionMatchKey($transactionRow);
        if ($matchKey !== '') {
            $transactionKeyMap[$matchKey] = true;
        }
    }

    $delete = $db->prepare('DELETE FROM transaction_incentives WHERE period_year = :period_year AND period_month = :period_month');
    $insert = $db->prepare(
        'INSERT INTO transaction_incentives
         (period_year, period_month, source_file, source_sheet, match_key, visit_id, patient_id, patient_name,
          referring_doctor, normalized_doctor, pro_name, status, billable_items, modality, total_price,
          total_discount, total_net, total_payment, doctor_group, incentive_amount, master_discount,
          payable_discount, variance_amount, notes, raw_json, created_at, updated_at)
         VALUES
         (:period_year, :period_month, :source_file, :source_sheet, :match_key, :visit_id, :patient_id, :patient_name,
          :referring_doctor, :normalized_doctor, :pro_name, :status, :billable_items, :modality, :total_price,
          :total_discount, :total_net, :total_payment, :doctor_group, :incentive_amount, :master_discount,
          :payable_discount, :variance_amount, :notes, :raw_json, :created_at, :updated_at)
         ON CONFLICT(period_year, period_month, match_key) DO UPDATE SET
          source_file = excluded.source_file,
          source_sheet = excluded.source_sheet,
          visit_id = excluded.visit_id,
          patient_id = excluded.patient_id,
          patient_name = excluded.patient_name,
          referring_doctor = excluded.referring_doctor,
          normalized_doctor = excluded.normalized_doctor,
          pro_name = excluded.pro_name,
          status = excluded.status,
          billable_items = excluded.billable_items,
          modality = excluded.modality,
          total_price = excluded.total_price,
          total_discount = excluded.total_discount,
          total_net = excluded.total_net,
          total_payment = excluded.total_payment,
          doctor_group = excluded.doctor_group,
          incentive_amount = excluded.incentive_amount,
          master_discount = excluded.master_discount,
          payable_discount = excluded.payable_discount,
          variance_amount = excluded.variance_amount,
          notes = excluded.notes,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at'
    );

    $savedCount = 0;
    $matchedCount = 0;
    $skippedCount = 0;
    $exactPayableCount = 0;

    $startedTransaction = false;
    if (!$db->inTransaction()) {
        $db->beginTransaction();
        $startedTransaction = true;
    }

    try {
        $delete->execute([
            ':period_year' => $periodYear,
            ':period_month' => $periodMonth,
        ]);

        foreach ($rows as $row) {
            $matchKey = buildTransactionMatchKey($row);
            if ($matchKey === '') {
                $skippedCount += 1;
                continue;
            }

            $payableDiscount = $row['incentivePayableAmount'] ?? $row['incentiveAmount'] ?? null;
            if ($payableDiscount !== null) {
                $exactPayableCount += 1;
            }

            if (isset($transactionKeyMap[$matchKey])) {
                $matchedCount += 1;
            }

            $now = nowIso();
            $insert->execute([
                ':period_year' => $periodYear,
                ':period_month' => $periodMonth,
                ':source_file' => $fileName,
                ':source_sheet' => $row['sourceSheet'] ?? null,
                ':match_key' => $matchKey,
                ':visit_id' => $row['visitId'] ?? null,
                ':patient_id' => $row['patientId'] ?? null,
                ':patient_name' => $row['patientName'] ?? null,
                ':referring_doctor' => $row['referringDoctor'] ?? null,
                ':normalized_doctor' => $row['normalizedDoctor'] ?? null,
                ':pro_name' => $row['proName'] ?? null,
                ':status' => $row['status'] ?? null,
                ':billable_items' => $row['billableItems'] ?? null,
                ':modality' => $row['modality'] ?? null,
                ':total_price' => $row['totalPrice'] ?? null,
                ':total_discount' => $row['totalDiscount'] ?? null,
                ':total_net' => $row['totalNet'] ?? null,
                ':total_payment' => $row['totalPayment'] ?? null,
                ':doctor_group' => $row['incentiveDoctorGroup'] ?? null,
                ':incentive_amount' => $row['incentiveAmount'] ?? null,
                ':master_discount' => $row['incentiveMasterDiscount'] ?? null,
                ':payable_discount' => $payableDiscount,
                ':variance_amount' => $row['incentiveVarianceAmount'] ?? null,
                ':notes' => $row['notes'] ?? null,
                ':raw_json' => $row['rawJson'] ?? null,
                ':created_at' => $now,
                ':updated_at' => $now,
            ]);
            $savedCount += 1;
        }

        if ($startedTransaction) {
            $db->commit();
        }
    } catch (Throwable $error) {
        if ($startedTransaction && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }

    return [
        'savedCount' => $savedCount,
        'matchedCount' => $matchedCount,
        'skippedCount' => $skippedCount,
        'exactPayableCount' => $exactPayableCount,
    ];
}

function extractGroupCode($value): ?string
{
    $text = strtoupper(trim((string) $value));
    if ($text === '') {
        return null;
    }

    if ($text === 'NEL') {
        return 'NEL';
    }

    if (preg_match('/^([A-Z])$/', $text, $m) === 1) {
        return $m[1] ?? null;
    }

    if (preg_match('/GROUP\s*([A-Z]+)/', $text, $m) === 1) {
        return $m[1] ?? null;
    }

    if (preg_match('/[A-Z]+/', $text, $m) === 1) {
        return $m[0] ?? null;
    }

    return null;
}

function splitItems(?string $text): array
{
    $text = trim((string) $text);
    if ($text === '') {
        return [];
    }

    $parts = explode(',', $text);
    $out = [];

    foreach ($parts as $part) {
        $trimmed = trim((string) $part);
        if ($trimmed !== '') {
            $out[] = $trimmed;
        }
    }

    return $out;
}

function findRuleForItem(string $item, array $exactRuleMap, array $allRules): ?array
{
    $normalized = normalizeText($item);
    if ($normalized === '') {
        return null;
    }

    if (array_key_exists($normalized, $exactRuleMap)) {
        return $exactRuleMap[$normalized];
    }

    foreach ($allRules as $rule) {
        $r = (string) ($rule['normalized_item'] ?? '');
        if ($r === '') {
            continue;
        }

        if (str_contains($r, $normalized) || str_contains($normalized, $r)) {
            return $rule;
        }
    }

    return null;
}

function calculateAllowedDiscountForItem(string $item, ?string $doctorGroup, array $exactRuleMap, array $allRules): array
{
    $rule = findRuleForItem($item, $exactRuleMap, $allRules);
    if (!$rule) {
        return ['allowed' => 0.0, 'found' => false];
    }

    $groupMap = json_decode((string) ($rule['group_json'] ?? '{}'), true);
    if (!is_array($groupMap)) {
        $groupMap = [];
    }

    $groupCode = extractGroupCode((string) $doctorGroup);
    $allowed = null;

    if ($groupCode !== null && array_key_exists($groupCode, $groupMap)) {
        $allowed = (float) $groupMap[$groupCode];
    }

    if (($allowed === null || !is_finite($allowed)) && $groupCode === 'F' && array_key_exists('G', $groupMap)) {
        $allowed = (float) $groupMap['G'];
    }

    if ($allowed === null || !is_finite($allowed)) {
        $allowed = $rule['max_discount_price'] !== null
            ? (float) $rule['max_discount_price']
            : 0.0;
    }

    return ['allowed' => $allowed, 'found' => true];
}

function suggestIncentive(float $projectedRevenue): float
{
    if ($projectedRevenue >= 2000000) {
        return 15000.0;
    }

    if ($projectedRevenue >= 1000000) {
        return 10000.0;
    }

    if ($projectedRevenue >= 500000) {
        return 5000.0;
    }

    return 0.0;
}

function runEngineForPeriod(PDO $db, int $periodYear, int $periodMonth): array
{
    $range = buildDateRange($periodYear, $periodMonth);

    $txStmt = $db->prepare(
        'SELECT * FROM transactions
         WHERE visit_date IS NOT NULL
           AND visit_date >= :start
           AND visit_date <= :end'
    );
    $txStmt->execute([':start' => $range['start'], ':end' => $range['end']]);
    $transactions = $txStmt->fetchAll();

    $doctorRows = $db->query('SELECT * FROM doctor_master')->fetchAll();
    $doctorMap = [];
    foreach ($doctorRows as $doctorRow) {
        $doctorMap[(string) $doctorRow['normalized_name']] = $doctorRow;
    }

    $ruleRows = $db->query('SELECT * FROM discount_rules')->fetchAll();
    $exactRuleMap = [];
    foreach ($ruleRows as $ruleRow) {
        if (!array_key_exists((string) $ruleRow['normalized_item'], $exactRuleMap)) {
            $exactRuleMap[(string) $ruleRow['normalized_item']] = $ruleRow;
        }
    }

    $incentiveRowsStmt = $db->prepare(
        'SELECT * FROM transaction_incentives WHERE period_year = :period_year AND period_month = :period_month'
    );
    $incentiveRowsStmt->execute([
        ':period_year' => $periodYear,
        ':period_month' => $periodMonth,
    ]);
    $incentiveMap = [];
    foreach ($incentiveRowsStmt->fetchAll() as $incentiveRow) {
        $matchKey = trim((string) ($incentiveRow['match_key'] ?? ''));
        if ($matchKey !== '' && !array_key_exists($matchKey, $incentiveMap)) {
            $incentiveMap[$matchKey] = $incentiveRow;
        }
    }

    $runAt = nowIso();

    $db->beginTransaction();

    try {
        $insertRun = $db->prepare(
            'INSERT INTO engine_runs (period_year, period_month, total_records, total_flags, summary_json, run_at)
             VALUES (:period_year, :period_month, 0, 0, NULL, :run_at)'
        );
        $insertRun->execute([
            ':period_year' => $periodYear,
            ':period_month' => $periodMonth,
            ':run_at' => $runAt
        ]);
        $runId = (int) $db->lastInsertId();

        $insertResult = $db->prepare(
            'INSERT INTO engine_results
             (run_id, transaction_id, doctor_name, doctor_group, pro_name, modality, status,
              item_list, allowed_discount, actual_discount, payable_discount, variance,
              group_rule_violation, approval_required, remark, net_amount)
             VALUES (:run_id, :transaction_id, :doctor_name, :doctor_group, :pro_name, :modality,
                     :status, :item_list, :allowed_discount, :actual_discount, :payable_discount,
                     :variance, :group_rule_violation, :approval_required, :remark, :net_amount)'
        );

        $totalFlags = 0;
        $overDiscountCount = 0;
        $missingDoctorCount = 0;
        $missingGroupCount = 0;
        $missingItemCount = 0;
        $totalPayable = 0.0;

        foreach ($transactions as $row) {
            $normalizedDoctor = normalizeText($row['referring_doctor'] ?? null);
            $doctor = $doctorMap[$normalizedDoctor] ?? null;
            $matchKey = buildTransactionMatchKey($row);
            $incentiveRow = $matchKey !== '' ? ($incentiveMap[$matchKey] ?? null) : null;
            $doctorGroup = $doctor['incentive_group'] ?? ($incentiveRow['doctor_group'] ?? null);
            $doctorGroupCode = extractGroupCode((string) $doctorGroup);
            $calculationGroupCode = $doctorGroupCode;
            if ($doctorGroupCode === 'B') {
                $calculationGroupCode = 'D';
            } elseif ($doctorGroupCode === 'C') {
                $calculationGroupCode = 'F';
            }
            $items = splitItems((string) ($row['billable_items'] ?: $row['visit_description']));

            $allowedDiscount = 0.0;
            $hasDoctor = $doctor !== null;
            $hasDoctorGroup = $doctorGroupCode !== null;
            $hasItems = count($items) > 0;
            $missingRuleForAnyItem = false;
            $eligibleForAllowedDiscount = $hasDoctor && $hasDoctorGroup && $hasItems;

            if (!$hasItems) {
                $missingRuleForAnyItem = true;
            }

            if ($eligibleForAllowedDiscount) {
                foreach ($items as $item) {
                    $calc = calculateAllowedDiscountForItem($item, (string) ($calculationGroupCode ?? $doctorGroup), $exactRuleMap, $ruleRows);
                    $allowedDiscount += (float) $calc['allowed'];

                    if (!$calc['found']) {
                        $missingRuleForAnyItem = true;
                    }
                }
            }

            $actualDiscount = (float) ($row['total_discount'] ?? 0);
            $allowMasterOverride = !in_array($doctorGroupCode, ['B', 'C'], true);
            if (
                $allowMasterOverride
                && $eligibleForAllowedDiscount
                && !$missingRuleForAnyItem
                && $incentiveRow !== null
                && $incentiveRow['master_discount'] !== null
                && $incentiveRow['master_discount'] !== ''
            ) {
                $allowedDiscount = (float) $incentiveRow['master_discount'];
            }

            // Allowed discount must be shown only when doctor, group and item mapping are all available.
            if (!$eligibleForAllowedDiscount || $missingRuleForAnyItem) {
                $allowedDiscount = 0.0;
            }

            $payableDiscount = null;
            if ($incentiveRow !== null && $incentiveRow['payable_discount'] !== null && $incentiveRow['payable_discount'] !== '') {
                $payableDiscount = (float) $incentiveRow['payable_discount'];
            } elseif ($incentiveRow !== null && $incentiveRow['incentive_amount'] !== null && $incentiveRow['incentive_amount'] !== '') {
                $payableDiscount = (float) $incentiveRow['incentive_amount'];
            }

            if ($payableDiscount === null) {
                $payableDiscount = max(0.0, $allowedDiscount - $actualDiscount);
            }

            $approvalGap = ($eligibleForAllowedDiscount && !$missingRuleForAnyItem) ? ($actualDiscount - $allowedDiscount) : 0.0;
            $approvalRequired = ($approvalGap > 0.01) ? 1 : 0;
            if ($incentiveRow !== null && $incentiveRow['variance_amount'] !== null && $incentiveRow['variance_amount'] !== '') {
                $variance = (float) $incentiveRow['variance_amount'];
            } else {
                $variance = $allowedDiscount - ($actualDiscount + $payableDiscount);
            }

            $groupRuleViolation = 0;
            if ($eligibleForAllowedDiscount && !$missingRuleForAnyItem) {
                if ($doctorGroupCode === 'A') {
                    if (abs($actualDiscount) > 0.01 || abs($payableDiscount) > 0.01) {
                        $groupRuleViolation = 1;
                    }
                } elseif ($doctorGroupCode === 'B' || $doctorGroupCode === 'C') {
                    if (abs($actualDiscount - $allowedDiscount) > 0.01 || abs($payableDiscount) > 0.01) {
                        $groupRuleViolation = 1;
                    }
                }
            }
            if ($groupRuleViolation === 1) {
                $approvalRequired = 1;
            }

            $totalPayable += $payableDiscount;

            $remark = 'OK';
            if (!$doctor) {
                $remark = 'Doctor name missing in master sheet';
                $missingDoctorCount += 1;
            } elseif (!$hasDoctorGroup) {
                $remark = 'Doctor group missing in master sheet';
                $missingGroupCount += 1;
            } elseif ($missingRuleForAnyItem) {
                $remark = 'Need to master sheet for item';
                $missingItemCount += 1;
            } elseif ($groupRuleViolation === 1 && $doctorGroupCode === 'A') {
                $remark = 'Group A rule mismatch: discount and incentive must be 0';
            } elseif ($groupRuleViolation === 1 && $doctorGroupCode === 'B') {
                $remark = 'Group B rule mismatch: use Group D discount and zero incentive';
            } elseif ($groupRuleViolation === 1 && $doctorGroupCode === 'C') {
                $remark = 'Group C rule mismatch: use Group F discount and zero incentive';
            } elseif ($approvalRequired === 1) {
                $remark = 'Over-discount requires approval';
                $overDiscountCount += 1;
            } elseif ($variance > 0.01) {
                $remark = 'Lower discount than allowed';
            }

            if ($approvalRequired === 1 || !$doctor || !$hasDoctorGroup || $missingRuleForAnyItem || $groupRuleViolation === 1) {
                $totalFlags += 1;
            }

            $insertResult->execute([
                ':run_id' => $runId,
                ':transaction_id' => (int) $row['id'],
                ':doctor_name' => $row['referring_doctor'] ?? null,
                ':doctor_group' => $doctorGroup,
                ':pro_name' => $row['pro_name'] ?? null,
                ':modality' => $row['modality'] ?? null,
                ':status' => $row['status'] ?? $row['receipt_status'],
                ':item_list' => json_encode($items, JSON_UNESCAPED_UNICODE),
                ':allowed_discount' => round($allowedDiscount, 2),
                ':actual_discount' => round($actualDiscount, 2),
                ':payable_discount' => round($payableDiscount, 2),
                ':variance' => round($variance, 2),
                ':group_rule_violation' => $groupRuleViolation,
                ':approval_required' => $approvalRequired,
                ':remark' => $remark,
                ':net_amount' => round((float) ($row['total_net'] ?? 0), 2)
            ]);
        }

        $summary = [
            'periodYear' => $periodYear,
            'periodMonth' => $periodMonth,
            'totalRecords' => count($transactions),
            'totalFlags' => $totalFlags,
            'overDiscountCount' => $overDiscountCount,
            'missingDoctorCount' => $missingDoctorCount,
            'missingGroupCount' => $missingGroupCount,
            'missingItemCount' => $missingItemCount,
            'totalPayable' => round($totalPayable, 2)
        ];

        $db->prepare(
            'UPDATE engine_runs
             SET total_records = :total_records, total_flags = :total_flags, summary_json = :summary_json
             WHERE id = :id'
        )->execute([
            ':total_records' => $summary['totalRecords'],
            ':total_flags' => $summary['totalFlags'],
            ':summary_json' => json_encode($summary, JSON_UNESCAPED_UNICODE),
            ':id' => $runId
        ]);

        $db->commit();
        return ['runId' => $runId, 'summary' => $summary];
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function getProductivityReport(PDO $db, int $periodYear, int $periodMonth): array
{
    $range = buildDateRange($periodYear, $periodMonth);
    $monthStart = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $periodYear, $periodMonth), new DateTimeZone('UTC'));
    $daysInMonth = $range['daysInMonth'];

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $monthEnd = new DateTimeImmutable($range['end']);
    if ($now > $monthEnd) {
        $elapsedDays = $daysInMonth;
    } else {
        $delta = max(0, $now->getTimestamp() - $monthStart->getTimestamp());
        $elapsedDays = (int) (floor($delta / 86400) + 1);
        if ($elapsedDays < 1) {
            $elapsedDays = 1;
        }
    }

    $latestRunStmt = $db->prepare(
        'SELECT id
         FROM engine_runs
         WHERE period_year = :period_year AND period_month = :period_month
         ORDER BY run_at DESC
         LIMIT 1'
    );
    $latestRunStmt->execute([
        ':period_year' => $periodYear,
        ':period_month' => $periodMonth
    ]);
    $latestRun = $latestRunStmt->fetch();

    $allowedByPro = [];
    if ($latestRun) {
        $allowedRows = $db->prepare(
            "SELECT
              COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED') AS pro_name,
              COALESCE(SUM(COALESCE(allowed_discount, 0)), 0) AS total_allowed_discount
             FROM engine_results
             WHERE run_id = :run_id
             GROUP BY COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED')"
        );
        $allowedRows->execute([':run_id' => (int) $latestRun['id']]);

        foreach ($allowedRows->fetchAll() as $allowedRow) {
            $allowedByPro[(string) $allowedRow['pro_name']] = (float) $allowedRow['total_allowed_discount'];
        }
    }

    $rows = $db->prepare(
        "SELECT
          COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED') AS pro_name,
          COUNT(*) AS total_cases,
          COALESCE(SUM(COALESCE(total_net, 0)), 0) AS total_net
       FROM transactions
       WHERE visit_date IS NOT NULL
         AND visit_date >= :start
         AND visit_date <= :end
       GROUP BY COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED')
       ORDER BY total_net DESC"
    );
    $rows->execute([':start' => $range['start'], ':end' => $range['end']]);

    $result = [];
    foreach ($rows->fetchAll() as $row) {
        $totalNet = (float) $row['total_net'];
        $projectedMonthly = ($totalNet / max(1, $elapsedDays)) * $daysInMonth;

        $result[] = [
            'proName' => (string) $row['pro_name'],
            'totalCases' => (int) $row['total_cases'],
            'totalNet' => round($totalNet, 2),
            'projectedMonthly' => round($projectedMonthly, 2),
            'suggestedIncentive' => round((float) ($allowedByPro[(string) $row['pro_name']] ?? 0.0), 2)
        ];
    }

    return $result;
}

function generatePaymentsFromRun(PDO $db, int $runId): array
{
    $run = $db->prepare('SELECT * FROM engine_runs WHERE id = :id');
    $run->execute([':id' => $runId]);
    $runRow = $run->fetch();
    if (!$runRow) {
        throw new RuntimeException('Run not found');
    }

    $rows = $db->prepare(
        "SELECT
          er.doctor_name,
          COALESCE(NULLIF(TRIM(er.pro_name), ''), 'UNASSIGNED') AS pro_name,
          SUM(COALESCE(er.payable_discount, 0)) AS amount,
          SUM(CASE WHEN er.approval_required = 1 THEN 1 ELSE 0 END) AS approval_flags
       FROM engine_results er
       WHERE er.run_id = :run_id
         AND (LOWER(COALESCE(er.status, '')) = 'paid')
         AND er.payable_discount > 0
       GROUP BY er.doctor_name, COALESCE(NULLIF(TRIM(er.pro_name), ''), 'UNASSIGNED')
       HAVING amount > 0"
    );
    $rows->execute([':run_id' => $runId]);
    $payments = $rows->fetchAll();

    $db->beginTransaction();
    try {
        $insertPayment = $db->prepare(
            'INSERT INTO payments
             (run_id, doctor_name, pro_name, period_year, period_month, amount, adjustment_amount, advance_payment,
              return_incentive_amount, status, approval_status, cash_in_hand_snapshot, pro_cash_in_hand,
              manager_cash_in_hand, cashier_handover_at, pro_handover_at, disbursed_on, notes, created_at, updated_at)
             VALUES (:run_id, :doctor_name, :pro_name, :period_year, :period_month, :amount, :adjustment_amount, :advance_payment,
                     :return_incentive_amount, :status, :approval_status, :cash_in_hand_snapshot, :pro_cash_in_hand,
                     :manager_cash_in_hand, :cashier_handover_at, :pro_handover_at, :disbursed_on, :notes, :created_at, :updated_at)'
        );

        $insertApproval = $db->prepare(
            "INSERT INTO approval_requests
             (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
             VALUES ('approval_of_disbursal', :entity_id, :payload_json, 'pending', :requested_by, NULL, :created_at, :updated_at)"
        );

        $generated = 0;
        foreach ($payments as $row) {
            $wallet = $db->prepare('SELECT cash_in_hand FROM pro_wallets WHERE pro_name = :pro_name');
            $wallet->execute([':pro_name' => $row['pro_name']]);
            $walletRow = $wallet->fetch();
            $cashInHand = $walletRow ? (float) $walletRow['cash_in_hand'] : 0.0;

            $now = nowIso();
            $holdForCash = $cashInHand > 0;
            $paymentStatus = $holdForCash ? 'on_hold' : 'pending';
            $notes = $holdForCash ? 'Cash in hand pending settlement. Fresh disbursal blocked.' : null;

            $insertPayment->execute([
                ':run_id' => $runId,
                ':doctor_name' => $row['doctor_name'],
                ':pro_name' => $row['pro_name'],
                ':period_year' => (int) $runRow['period_year'],
                ':period_month' => (int) $runRow['period_month'],
                ':amount' => round((float) $row['amount'], 2),
                ':adjustment_amount' => 0.0,
                ':advance_payment' => 0.0,
                ':return_incentive_amount' => 0.0,
                ':status' => $paymentStatus,
                ':approval_status' => 'pending',
                ':cash_in_hand_snapshot' => $cashInHand,
                ':pro_cash_in_hand' => $cashInHand,
                ':manager_cash_in_hand' => 0.0,
                ':cashier_handover_at' => null,
                ':pro_handover_at' => null,
                ':disbursed_on' => null,
                ':notes' => $notes,
                ':created_at' => $now,
                ':updated_at' => $now
            ]);

            $paymentId = (int) $db->lastInsertId();
            $insertApproval->execute([
                ':entity_id' => (string) $paymentId,
                ':payload_json' => json_encode([
                    'runId' => $runId,
                    'doctorName' => $row['doctor_name'],
                    'proName' => $row['pro_name'],
                    'amount' => (float) $row['amount'],
                    'approvalFlags' => (int) $row['approval_flags']
                ], JSON_UNESCAPED_UNICODE),
                ':requested_by' => 'system',
                ':created_at' => $now,
                ':updated_at' => $now
            ]);

            $generated += 1;
        }

        $db->commit();
        return ['generated' => $generated];
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function quoteCsv(string $value): string
{
    if ($value === '' || $value === null) {
        return '';
    }

    $value = (string) $value;
    if (preg_match('/[",\n]/', $value)) {
        return '"' . str_replace('"', '""', $value) . '"';
    }

    return $value;
}

function toCsv(array $rows): string
{
    if (count($rows) === 0) {
        return '';
    }

    $keys = array_keys((array) $rows[0]);
    $lines = [];
    $lines[] = implode(',', $keys);

    foreach ($rows as $row) {
        $parts = [];
        foreach ($keys as $key) {
            $parts[] = quoteCsv((string) ($row[$key] ?? ''));
        }
        $lines[] = implode(',', $parts);
    }

    return implode("\n", $lines);
}

function isPeriodLocked(PDO $db, int $periodYear, int $periodMonth): bool
{
    $statement = $db->prepare('SELECT is_locked FROM locked_periods WHERE period_year = :period_year AND period_month = :period_month');
    $statement->execute([':period_year' => $periodYear, ':period_month' => $periodMonth]);
    $row = $statement->fetch();

    return (bool) ($row && (int) $row['is_locked'] === 1);
}

function assertAuth(PDO $db, bool $requireAdmin = false): array
{
    $secret = getenv('RRCP_TOKEN_SECRET') ?: 'rrcp-local-secret';
    $authorization = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? $_SERVER['AUTHORIZATION']
        ?? '';
    if (!str_starts_with((string) $authorization, 'Bearer ')) {
        sendJson(['error' => 'Unauthorized'], 401);
    }

    $token = trim(substr((string) $authorization, 7));
    $payload = parseToken($token, $secret);
    if (!$payload) {
        sendJson(['error' => 'Invalid or expired token'], 401);
    }

    $stmt = $db->prepare(
        'SELECT
           u.id,
           u.email,
           u.role,
           u.status,
           u.doctor_master_id,
           d.doctor_name,
           d.normalized_name AS doctor_normalized_name,
           d.incentive_group AS doctor_incentive_group
         FROM users u
         LEFT JOIN doctor_master d ON d.id = u.doctor_master_id
         WHERE u.id = :id'
    );
    $stmt->execute([':id' => (int) $payload['id']]);
    $user = $stmt->fetch();
    if (!$user || (string) $user['status'] !== 'active') {
        sendJson(['error' => 'Unauthorized'], 401);
    }

    if ($requireAdmin && (string) $user['role'] !== 'admin') {
        sendJson(['error' => 'Admin access required'], 403);
    }

    return $user;
}

function getDoctorScopeForUser(PDO $db, array $user, bool $required = false): ?array
{
    if (($user['role'] ?? '') !== 'doctor') {
        return null;
    }

    $doctorId = intSafe($user['doctor_master_id'] ?? null, null);
    if (!$doctorId) {
        if ($required) {
            sendJson(['error' => 'Doctor account is not linked to a doctor profile'], 403);
        }
        return null;
    }

    $stmt = $db->prepare(
        'SELECT id, doctor_name, normalized_name, incentive_group, verified
         FROM doctor_master
         WHERE id = :id'
    );
    $stmt->execute([':id' => $doctorId]);
    $doctor = $stmt->fetch();

    if (!$doctor || trim((string) ($doctor['normalized_name'] ?? '')) === '') {
        if ($required) {
            sendJson(['error' => 'Linked doctor profile was not found in doctor master'], 403);
        }
        return null;
    }

    return $doctor;
}

function sendJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function sendCsvResponse(string $csv, string $filename, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Access-Control-Allow-Origin: *');
    echo $csv;
    exit;
}
