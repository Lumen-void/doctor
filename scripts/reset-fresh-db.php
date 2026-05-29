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
$backupFile = $backupDir . "/app-before-fresh-reset-{$timestamp}.db";

$db = new PDO('sqlite:' . $dbFile, '', '');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->setAttribute(PDO::ATTR_TIMEOUT, 5);
$db->exec('PRAGMA busy_timeout = 5000;');
$db->exec('PRAGMA foreign_keys = OFF;');

$quotedBackup = str_replace("'", "''", $backupFile);
$db->exec('PRAGMA wal_checkpoint(TRUNCATE);');
$db->exec("VACUUM INTO '{$quotedBackup}'");

$tablesToClear = [
    'approval_requests',
    'payments',
    'engine_results',
    'engine_runs',
    'transactions',
    'reference_uploads',
    'service_prices',
    'discount_rules',
    'doctor_master',
    'software_requirements',
    'pro_wallets',
    'locked_periods',
    'contact_messages',
    'users',
];

$db->beginTransaction();
try {
    foreach ($tablesToClear as $table) {
        $db->exec("DELETE FROM {$table}");
    }
    $db->exec('DELETE FROM sqlite_sequence');

    $now = nowIso();
    $insertAdmin = $db->prepare(
        'INSERT INTO users (email, password_hash, role, doctor_master_id, status, created_at, updated_at, last_login_at)
         VALUES (:email, :password_hash, :role, NULL, :status, :created_at, :updated_at, NULL)'
    );
    $insertAdmin->execute([
        ':email' => 'admin@rrcp.local',
        ':password_hash' => password_hash('Admin@123', PASSWORD_BCRYPT),
        ':role' => 'admin',
        ':status' => 'active',
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);

    $db->commit();
} catch (Throwable $error) {
    $db->rollBack();
    fwrite(STDERR, "Reset failed: {$error->getMessage()}\n");
    exit(1);
}

$db->exec('PRAGMA foreign_keys = ON;');

$markerPath = dbInitMarkerPath();
@file_put_contents($markerPath, DB_INIT_VERSION);

$summary = [];
foreach ($tablesToClear as $table) {
    $summary[$table] = (int) $db->query("SELECT COUNT(*) AS count FROM {$table}")->fetchColumn();
}

echo "Fresh reset complete.\n";
echo "Backup created: {$backupFile}\n";
echo "Bootstrap login kept: admin@rrcp.local / Admin@123\n";
echo "Row counts after reset:\n";
foreach ($summary as $table => $count) {
    echo " - {$table}: {$count}\n";
}
