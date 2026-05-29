#!/usr/bin/env php
<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/api/lib.php';

$dbFile = dbPath();
if (!is_file($dbFile)) {
    fwrite(STDERR, "Database file not found: {$dbFile}\n");
    exit(1);
}

$backupDir = dirname($dbFile) . '/backups';
if (!is_dir($backupDir) && !mkdir($backupDir, 0777, true) && !is_dir($backupDir)) {
    fwrite(STDERR, "Could not create backup directory: {$backupDir}\n");
    exit(1);
}

$timestamp = date('Ymd-His');
$backupFile = $backupDir . "/app-before-transaction-dedupe-{$timestamp}.db";

$db = new PDO('sqlite:' . $dbFile, '', '');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->setAttribute(PDO::ATTR_TIMEOUT, 5);
$db->exec('PRAGMA busy_timeout = 5000;');
$db->exec('PRAGMA foreign_keys = OFF;');
$db->exec('PRAGMA wal_checkpoint(TRUNCATE);');
$quotedBackup = str_replace("'", "''", $backupFile);
$db->exec("VACUUM INTO '{$quotedBackup}'");

$signatureColumns = [
    'visit_id',
    'visit_date',
    'patient_id',
    'patient_name',
    'sex',
    'modality',
    'visit_description',
    'referring_doctor',
    'normalized_doctor',
    'pro_name',
    'status',
    'receipt_status',
    'billable_items',
    'total_price',
    'total_discount',
    'total_net',
    'total_payment',
    'payment_method',
    'revenue_booked_in',
    'balance_amount',
    'notes',
];

$signatureExpr = implode(', ', $signatureColumns);
$duplicateCount = (int) ($db
    ->query(
        "SELECT COALESCE(SUM(duplicate_count - 1), 0)
         FROM (
           SELECT COUNT(*) AS duplicate_count
           FROM transactions
           GROUP BY {$signatureExpr}
           HAVING COUNT(*) > 1
         )"
    )
    ->fetchColumn() ?: 0);

if ($duplicateCount === 0) {
    echo "No duplicate transaction rows found.\n";
    echo "Backup created: {$backupFile}\n";
    exit(0);
}

$affectedPeriods = $db->query(
    "SELECT substr(visit_date, 1, 7) AS period_key, COUNT(*) AS row_count
     FROM transactions
     GROUP BY period_key
     ORDER BY period_key"
)->fetchAll();

$duplicatePredicates = [];
foreach ($signatureColumns as $column) {
    $duplicatePredicates[] = "COALESCE(t2.{$column}, '') = COALESCE(t1.{$column}, '')";
}

$deleteSql = "
    DELETE FROM transactions
    WHERE id IN (
      SELECT t1.id
      FROM transactions t1
      WHERE EXISTS (
        SELECT 1
        FROM transactions t2
        WHERE t2.id < t1.id
          AND " . implode("\n          AND ", $duplicatePredicates) . '
      )
    )';

$beforeCount = (int) $db->query('SELECT COUNT(*) FROM transactions')->fetchColumn();

$db->beginTransaction();
try {
    $db->exec($deleteSql);
    $db->commit();
} catch (Throwable $error) {
    $db->rollBack();
    fwrite(STDERR, "Duplicate removal failed: {$error->getMessage()}\n");
    exit(1);
}

$afterCount = (int) $db->query('SELECT COUNT(*) FROM transactions')->fetchColumn();
$removedCount = $beforeCount - $afterCount;

$db->exec('PRAGMA foreign_keys = ON;');

echo "Duplicate transaction cleanup complete.\n";
echo "Backup created: {$backupFile}\n";
echo "Rows before: {$beforeCount}\n";
echo "Rows removed: {$removedCount}\n";
echo "Rows after: {$afterCount}\n";
echo "Affected periods checked:\n";
foreach ($affectedPeriods as $row) {
    $periodKey = $row['period_key'] ?: '(no visit date)';
    echo " - {$periodKey}: {$row['row_count']} rows before cleanup\n";
}
