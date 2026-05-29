<?php

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$uri = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$routeQuery = isset($_GET['route']) ? (string) $_GET['route'] : '';

if ($routeQuery !== '') {
    $path = trim(rawurldecode($routeQuery), '/');
} else {
    // Supports both rewritten /api/* and direct /api/index.php/* requests in nested folders.
    $apiMarker = strpos($uri, '/api/');
    if ($apiMarker === false) {
        $path = '';
    } else {
        $path = substr($uri, $apiMarker + 5);
        $path = trim((string) preg_replace('#^index\.php/?#', '', (string) $path), '/');
        $path = trim((string) $path, '/');
    }
}
$segments = $path === '' ? [] : explode('/', $path);

function getQueryInt(array $query, string $name, ?int $fallback = null): ?int
{
    return intSafe($query[$name] ?? null, $fallback);
}

function uploadTempFile(array $file): string
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        sendJson(['error' => 'Upload failed'], 400);
    }

    $tmpName = $file['tmp_name'] ?? null;
    if (!$tmpName || !is_uploaded_file($tmpName)) {
        sendJson(['error' => 'Invalid uploaded file'], 400);
    }

    $ext = pathinfo((string) ($file['name'] ?? 'upload'), PATHINFO_EXTENSION);
    if ($ext === '') {
        $ext = 'tmp';
    }

    $target = uploadPath() . '/' . uniqid('upload_', true) . '.' . $ext;
    if (!move_uploaded_file($tmpName, $target)) {
        sendJson(['error' => 'Could not store uploaded file'], 500);
    }

    return $target;
}

try {
    $db = getDb();

    if (empty($segments) && $routeQuery === '') {
        sendJson(['message' => 'RRCP API'], 200);
    }

    $segment = $segments[0] ?? null;

    if ($segment === 'health' && $method === 'GET') {
        sendJson(['ok' => true, 'timestamp' => nowIso()]);
    }

    if ($segment === 'auth' && ($segments[1] ?? '') === 'login' && $method === 'POST') {
        $body = requestBody();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if ($email === '' || $password === '') {
            sendJson(['error' => 'Email and password are required'], 400);
        }

        $stmt = $db->prepare(
            'SELECT
               u.*,
               d.doctor_name AS doctor_name
             FROM users u
             LEFT JOIN doctor_master d ON d.id = u.doctor_master_id
             WHERE u.email = :email'
        );
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch();

        if (!$user || $user['status'] !== 'active' || !password_verify($password, (string) $user['password_hash'])) {
            sendJson(['error' => 'Invalid credentials'], 401);
        }

        $db->prepare('UPDATE users SET last_login_at = :last_login_at, updated_at = :updated_at WHERE id = :id')->execute([
            ':last_login_at' => nowIso(),
            ':updated_at' => nowIso(),
            ':id' => (int) $user['id']
        ]);

        $token = createToken($user, getenv('RRCP_TOKEN_SECRET') ?: 'rrcp-local-secret');
        sendJson([
            'token' => $token,
            'user' => [
                'id' => (int) $user['id'],
                'email' => (string) $user['email'],
                'role' => (string) $user['role'],
                'status' => (string) $user['status'],
                'doctorMasterId' => isset($user['doctor_master_id']) ? intSafe($user['doctor_master_id'], null) : null,
                'doctorName' => $user['doctor_name'] ?? null
            ]
        ]);
    }

    if ($segment === 'contact' && $method === 'POST') {
        $body = requestBody();

        $name = trim((string) ($body['name'] ?? ''));
        $email = trim((string) ($body['email'] ?? ''));
        $subject = trim((string) ($body['subject'] ?? ''));
        $message = trim((string) ($body['message'] ?? ''));

        if ($name === '' || $email === '' || $subject === '' || $message === '') {
            sendJson(['error' => 'All fields are required'], 400);
        }

        $stmt = $db->prepare(
            'INSERT INTO contact_messages (name, email, subject, message, status, created_at)
             VALUES (:name, :email, :subject, :message, \'open\', :created_at)'
        );
        $stmt->execute([
            ':name' => $name,
            ':email' => $email,
            ':subject' => $subject,
            ':message' => $message,
            ':created_at' => nowIso()
        ]);

        sendJson(['ok' => true]);
    }

    if ($segment === 'auth' || $segment === 'me' || $segment === 'users' || str_starts_with($segment, 'dashboard')) {
        // auth-only area starts below
    }

    $user = assertAuth($db);

    if ($segment === 'me' && $method === 'GET') {
        sendJson(['user' => $user]);
    }

    if ($segment === 'dashboard' && $method === 'GET') {
        $query = $_GET;
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $periodYear = getQueryInt($query, 'year', (int) $now->format('Y'));
        $periodMonth = getQueryInt($query, 'month', (int) $now->format('m'));

        $range = buildDateRange((int) $periodYear, (int) $periodMonth);
        $effectiveDoctorScope = ($user['role'] ?? '') === 'doctor' ? getDoctorScopeForUser($db, $user, true) : null;
        $doctorFilterSql = $effectiveDoctorScope ? ' AND normalized_doctor = :doctor_normalized' : '';
        $doctorFilterParams = $effectiveDoctorScope ? [':doctor_normalized' => (string) $effectiveDoctorScope['normalized_name']] : [];

        $totals = $db->prepare(
            "SELECT
              COUNT(*) AS total_cases,
              COALESCE(SUM(COALESCE(total_price, 0)), 0) AS gross,
              COALESCE(SUM(COALESCE(total_discount, 0)), 0) AS discount,
              COALESCE(SUM(COALESCE(total_net, 0)), 0) AS net
             FROM transactions
             WHERE visit_date IS NOT NULL
               AND visit_date >= :start
               AND visit_date <= :end
               {$doctorFilterSql}"
        );
        $totals->execute([
            ':start' => $range['start'],
            ':end' => $range['end'],
            ...$doctorFilterParams
        ]);
        $totalsRow = $totals->fetch();

        $topPros = $db->prepare(
            "SELECT
              COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED') AS pro_name,
              COUNT(*) AS cases,
              COALESCE(SUM(COALESCE(total_net, 0)), 0) AS net
             FROM transactions
             WHERE visit_date IS NOT NULL
               AND visit_date >= :start
               AND visit_date <= :end
               {$doctorFilterSql}
             GROUP BY COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED')
             ORDER BY net DESC
             LIMIT 8"
        );
        $topPros->execute([
            ':start' => $range['start'],
            ':end' => $range['end'],
            ...$doctorFilterParams
        ]);

        $latestRun = $db->prepare(
            'SELECT * FROM engine_runs WHERE period_year = :period_year AND period_month = :period_month ORDER BY run_at DESC LIMIT 1'
        );
        $latestRun->execute([':period_year' => (int) $periodYear, ':period_month' => (int) $periodMonth]);
        $latest = $latestRun->fetch();

        $pendingApprovals = ($effectiveDoctorScope === null)
            ? (int) $db->query("SELECT COUNT(*) AS count FROM approval_requests WHERE status = 'pending'")->fetch()['count']
            : 0;

        if ($effectiveDoctorScope === null) {
            $pendingPayments = $db->prepare(
                'SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS pending_approval_amount
                 FROM payments
                 WHERE period_year = :period_year
                   AND period_month = :period_month
                   AND approval_status = \'pending\''
            );
            $pendingPayments->execute([':period_year' => (int) $periodYear, ':period_month' => (int) $periodMonth]);
            $pendingPaymentsRow = $pendingPayments->fetch();
        } else {
            $pendingPayments = $db->prepare(
                'SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS pending_approval_amount
                 FROM payments
                 WHERE period_year = :period_year
                   AND period_month = :period_month
                   AND approval_status = \'pending\'
                   AND UPPER(TRIM(doctor_name)) = UPPER(TRIM(:doctor_name))'
            );
            $pendingPayments->execute([
                ':period_year' => (int) $periodYear,
                ':period_month' => (int) $periodMonth,
                ':doctor_name' => (string) $effectiveDoctorScope['doctor_name']
            ]);
            $pendingPaymentsRow = $pendingPayments->fetch();
        }

        $referenceSummary = [
            'services' => (int) $db->query('SELECT COUNT(*) AS count FROM service_prices')->fetch()['count'],
            'discountRules' => (int) $db->query('SELECT COUNT(*) AS count FROM discount_rules')->fetch()['count'],
            'doctors' => (int) $db->query('SELECT COUNT(*) AS count FROM doctor_master')->fetch()['count']
        ];

        sendJson([
            'periodYear' => (int) $periodYear,
            'periodMonth' => (int) $periodMonth,
            'totals' => $totalsRow,
            'topPros' => $topPros->fetchAll(),
            'latestRun' => $latest,
            'pendingApprovals' => $pendingApprovals,
            'pendingPayments' => $pendingPaymentsRow,
            'referenceSummary' => $referenceSummary,
            'isLocked' => isPeriodLocked($db, (int) $periodYear, (int) $periodMonth)
        ]);
    }

    if ($segment === 'users' && $method === 'GET') {
        $admin = assertAuth($db, true);
        unset($admin);
        $users = $db->query(
            'SELECT
               u.id,
               u.email,
               u.role,
               u.status,
               u.doctor_master_id,
               d.doctor_name,
               u.created_at,
               u.updated_at,
               u.last_login_at
             FROM users u
             LEFT JOIN doctor_master d ON d.id = u.doctor_master_id
             ORDER BY u.id ASC'
        )->fetchAll();
        sendJson(['users' => $users]);
    }

    if ($segment === 'users' && $method === 'POST') {
        assertAuth($db, true);
        $body = requestBody();

        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');
        $role = trim((string) ($body['role'] ?? ''));
        $doctorMasterId = intSafe($body['doctorMasterId'] ?? null, null);

        if ($email === '' || $password === '' || $role === '') {
            sendJson(['error' => 'Email, password and role are required'], 400);
        }

        $allowedRoles = ['admin', 'mapper', 'accountant', 'doctor'];
        if (!in_array($role, $allowedRoles, true)) {
            sendJson(['error' => 'Invalid role'], 400);
        }

        if ($role === 'doctor') {
            if (!$doctorMasterId) {
                sendJson(['error' => 'doctorMasterId is required for doctor users'], 400);
            }

            $doctorExists = $db->prepare('SELECT id FROM doctor_master WHERE id = :id');
            $doctorExists->execute([':id' => $doctorMasterId]);
            if (!$doctorExists->fetch()) {
                sendJson(['error' => 'Doctor not found in master data'], 404);
            }

            $doctorAssigned = $db->prepare('SELECT id FROM users WHERE doctor_master_id = :doctor_master_id');
            $doctorAssigned->execute([':doctor_master_id' => $doctorMasterId]);
            if ($doctorAssigned->fetch()) {
                sendJson(['error' => 'A user is already linked to this doctor'], 409);
            }
        } else {
            $doctorMasterId = null;
        }

        $exists = $db->prepare('SELECT id FROM users WHERE email = :email');
        $exists->execute([':email' => $email]);
        if ($exists->fetch()) {
            sendJson(['error' => 'User already exists'], 409);
        }

        $ts = nowIso();
        $insert = $db->prepare(
            'INSERT INTO users (email, password_hash, role, doctor_master_id, status, created_at, updated_at)
             VALUES (:email, :password_hash, :role, :doctor_master_id, \'active\', :created_at, :updated_at)'
        );
        $insert->execute([
            ':email' => $email,
            ':password_hash' => password_hash($password, PASSWORD_BCRYPT),
            ':role' => $role,
            ':doctor_master_id' => $doctorMasterId,
            ':created_at' => $ts,
            ':updated_at' => $ts
        ]);

        sendJson(['id' => (int) $db->lastInsertId()]);
    }

    if ($segment === 'users' && ($method === 'PATCH' || $method === 'DELETE')) {
        assertAuth($db, true);
        $id = intSafe($segments[1] ?? null, null);
        if (!$id) {
            sendJson(['error' => 'User id is required'], 400);
        }

        if ($method === 'DELETE') {
            $db->prepare('DELETE FROM users WHERE id = :id')->execute([':id' => $id]);
            sendJson(['ok' => true]);
        }

        $body = requestBody();
        $current = $db->prepare('SELECT * FROM users WHERE id = :id');
        $current->execute([':id' => $id]);
        $currentRow = $current->fetch();
        if (!$currentRow) {
            sendJson(['error' => 'User not found'], 404);
        }

        $role = trim((string) ($body['role'] ?? $currentRow['role']));
        $status = $body['status'] ?? $currentRow['status'];
        $doctorMasterId = intSafe($body['doctorMasterId'] ?? $currentRow['doctor_master_id'], null);
        $passwordHash = $currentRow['password_hash'];
        if (isset($body['password']) && $body['password'] !== '') {
            $passwordHash = password_hash((string) $body['password'], PASSWORD_BCRYPT);
        }

        $allowedRoles = ['admin', 'mapper', 'accountant', 'doctor'];
        if (!in_array($role, $allowedRoles, true)) {
            sendJson(['error' => 'Invalid role'], 400);
        }

        if ($role === 'doctor') {
            if (!$doctorMasterId) {
                sendJson(['error' => 'doctorMasterId is required for doctor users'], 400);
            }

            $doctorExists = $db->prepare('SELECT id FROM doctor_master WHERE id = :id');
            $doctorExists->execute([':id' => $doctorMasterId]);
            if (!$doctorExists->fetch()) {
                sendJson(['error' => 'Doctor not found in master data'], 404);
            }

            $doctorAssigned = $db->prepare('SELECT id FROM users WHERE doctor_master_id = :doctor_master_id AND id <> :id');
            $doctorAssigned->execute([':doctor_master_id' => $doctorMasterId, ':id' => $id]);
            if ($doctorAssigned->fetch()) {
                sendJson(['error' => 'A user is already linked to this doctor'], 409);
            }
        } else {
            $doctorMasterId = null;
        }

        $db->prepare(
            'UPDATE users
             SET role = :role, doctor_master_id = :doctor_master_id, status = :status,
                 password_hash = :password_hash, updated_at = :updated_at
             WHERE id = :id'
        )->execute([
            ':role' => $role,
            ':doctor_master_id' => $doctorMasterId,
            ':status' => $status,
            ':password_hash' => $passwordHash,
            ':updated_at' => nowIso(),
            ':id' => $id
        ]);

        sendJson(['ok' => true]);
    }

    if ($segment === 'reference') {
        if ($segments[1] === 'summary' && $method === 'GET') {
            $summary = [
                'services' => (int) $db->query('SELECT COUNT(*) AS count FROM service_prices')->fetch()['count'],
                'discountRules' => (int) $db->query('SELECT COUNT(*) AS count FROM discount_rules')->fetch()['count'],
                'doctors' => (int) $db->query('SELECT COUNT(*) AS count FROM doctor_master')->fetch()['count'],
                'requirements' => (int) $db->query('SELECT COUNT(*) AS count FROM software_requirements')->fetch()['count'],
                'latestUploads' => $db->query('SELECT * FROM reference_uploads ORDER BY uploaded_at DESC LIMIT 6')->fetchAll()
            ];
            sendJson($summary);
        }

        if ($segments[1] === 'doctors' && $method === 'GET') {
            $query = $_GET;
            $page = max(1, getQueryInt($query, 'page', 1) ?? 1);
            $pageSize = min(5000, max(1, getQueryInt($query, 'pageSize', 20) ?? 20));
            $offset = ($page - 1) * $pageSize;
            $search = trim((string) ($query['search'] ?? ''));

            if ($search !== '') {
                $where = 'WHERE doctor_name LIKE :search
                          OR doctor_code LIKE :search
                          OR present_pro LIKE :search
                          OR old_pro LIKE :search
                          OR incentive_group LIKE :search
                          OR incentive_cycle LIKE :search
                          OR reporting_doctor LIKE :search
                          OR confirmation_status LIKE :search
                          OR confirmation_remarks LIKE :search
                          OR location LIKE :search
                          OR hospital_name LIKE :search
                          OR degree LIKE :search
                          OR contact_no LIKE :search';
                $countStmt = $db->prepare("SELECT COUNT(*) AS count FROM doctor_master {$where}");
                $countStmt->execute([':search' => "%{$search}%"]);
                $total = (int) $countStmt->fetch()['count'];

                $rowsStmt = $db->prepare(
                    "SELECT id, location, doctor_name, doctor_code, hospital_name, degree, contact_no, present_pro,
                            old_pro, incentive_group, incentive_cycle, reporting_doctor,
                            confirmation_status, confirmation_remarks, verified
                     FROM doctor_master
                     {$where}
                     ORDER BY doctor_name ASC
                     LIMIT :limit OFFSET :offset"
                );
                $rowsStmt->bindValue(':search', "%{$search}%");
                $rowsStmt->bindValue(':limit', $pageSize, PDO::PARAM_INT);
                $rowsStmt->bindValue(':offset', $offset, PDO::PARAM_INT);
                $rowsStmt->execute();
                $rows = $rowsStmt->fetchAll();
                sendJson(['rows' => $rows, 'page' => $page, 'pageSize' => $pageSize, 'total' => $total]);
            }

            $total = (int) $db->query('SELECT COUNT(*) AS count FROM doctor_master')->fetch()['count'];
            $rows = $db->prepare(
                'SELECT id, location, doctor_name, doctor_code, hospital_name, degree, contact_no, present_pro,
                        old_pro, incentive_group, incentive_cycle, reporting_doctor,
                        confirmation_status, confirmation_remarks, verified
                 FROM doctor_master ORDER BY doctor_name ASC LIMIT :limit OFFSET :offset'
            );
            $rows->bindValue(':limit', $pageSize, PDO::PARAM_INT);
            $rows->bindValue(':offset', $offset, PDO::PARAM_INT);
            $rows->execute();

            sendJson(['rows' => $rows->fetchAll(), 'page' => $page, 'pageSize' => $pageSize, 'total' => $total]);
        }

        if ($segments[1] === 'requirements' && $method === 'GET') {
            $requirements = $db->query('SELECT id, category, requirement_text FROM software_requirements ORDER BY id ASC')->fetchAll();
            sendJson(['rows' => $requirements]);
        }

        if ($segments[1] === 'upload' && $method === 'POST') {
            if (!isset($_FILES['file'])) {
                sendJson(['error' => 'File is required'], 400);
            }

            $path = uploadTempFile($_FILES['file']);
            try {
                $parsed = parseReferenceWorkbook($path);
                $existingUserDoctorLinks = $db->query(
                    'SELECT
                       u.id,
                       d.doctor_code,
                       d.normalized_name
                     FROM users u
                     LEFT JOIN doctor_master d ON d.id = u.doctor_master_id
                     WHERE u.doctor_master_id IS NOT NULL'
                )->fetchAll();

                $db->beginTransaction();
                try {
                    $db->prepare('DELETE FROM service_prices')->execute();
                    $db->prepare('DELETE FROM discount_rules')->execute();
                    $db->prepare('DELETE FROM doctor_master')->execute();

                    $insertService = $db->prepare(
                        'INSERT INTO service_prices (name, normalized_name, unit_price, currency, created_at)
                         VALUES (:name, :normalized_name, :unit_price, :currency, :created_at)'
                    );
                    foreach ($parsed['services'] as $service) {
                        $insertService->execute([
                            ':name' => $service['name'],
                            ':normalized_name' => $service['normalizedName'],
                            ':unit_price' => $service['unitPrice'],
                            ':currency' => $service['currency'],
                            ':created_at' => nowIso()
                        ]);
                    }

                    $insertRule = $db->prepare(
                        'INSERT INTO discount_rules (item_name, normalized_item, modality, max_discount_price, group_json, exception_text, created_at)
                         VALUES (:item_name, :normalized_item, :modality, :max_discount_price, :group_json, :exception_text, :created_at)'
                    );
                    foreach ($parsed['discountRules'] as $rule) {
                        $insertRule->execute([
                            ':item_name' => $rule['itemName'],
                            ':normalized_item' => $rule['normalizedItem'],
                            ':modality' => $rule['modality'],
                            ':max_discount_price' => $rule['maxDiscountPrice'],
                            ':group_json' => json_encode($rule['groupValues'], JSON_UNESCAPED_UNICODE),
                            ':exception_text' => $rule['exceptionText'],
                            ':created_at' => nowIso()
                        ]);
                    }

                    $insertDoctor = $db->prepare(
                        'INSERT INTO doctor_master
                         (location, doctor_name, normalized_name, doctor_code, hospital_name, degree, contact_no,
                          old_pro, present_pro, pro_change_date, hospital_address, area, lead_score, lead_stage,
                          incentive_group, incentive_cycle, conversion_incentive_group, target_investigation,
                          reporting_doctor, confirmation_status, confirmation_remarks, verified, created_at)
                         VALUES (:location, :doctor_name, :normalized_name, :doctor_code, :hospital_name, :degree, :contact_no,
                                 :old_pro, :present_pro, :pro_change_date, :hospital_address, :area, :lead_score, :lead_stage,
                                 :incentive_group, :incentive_cycle, :conversion_incentive_group, :target_investigation,
                                 :reporting_doctor, :confirmation_status, :confirmation_remarks, :verified, :created_at)'
                    );

                    $insertWallet = $db->prepare(
                        'INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
                         VALUES (:pro_name, 0, :updated_at)
                         ON CONFLICT(pro_name) DO NOTHING'
                    );
                    $updateUserDoctorLink = $db->prepare(
                        'UPDATE users
                         SET doctor_master_id = :doctor_master_id, updated_at = :updated_at
                         WHERE id = :id'
                    );
                    $doctorIdMapByCode = [];
                    $doctorIdMapByName = [];

                    foreach ($parsed['doctors'] as $doctor) {
                        $insertDoctor->execute([
                            ':location' => $doctor['location'],
                            ':doctor_name' => $doctor['doctorName'],
                            ':normalized_name' => $doctor['normalizedName'],
                            ':doctor_code' => $doctor['doctorCode'],
                            ':hospital_name' => $doctor['hospitalName'],
                            ':degree' => $doctor['degree'],
                            ':contact_no' => $doctor['contactNo'],
                            ':old_pro' => $doctor['oldPro'],
                            ':present_pro' => $doctor['presentPro'],
                            ':pro_change_date' => $doctor['proDateChange'],
                            ':hospital_address' => $doctor['hospitalAddress'],
                            ':area' => $doctor['area'],
                            ':lead_score' => $doctor['leadScore'],
                            ':lead_stage' => $doctor['leadStage'],
                            ':incentive_group' => $doctor['incentiveGroup'],
                            ':incentive_cycle' => $doctor['incentiveCycle'],
                            ':conversion_incentive_group' => $doctor['conversionIncentiveGroup'],
                            ':target_investigation' => $doctor['targetInvestigation'],
                            ':reporting_doctor' => $doctor['reportingDoctor'],
                            ':confirmation_status' => $doctor['confirmationStatus'],
                            ':confirmation_remarks' => $doctor['confirmationRemarks'],
                            ':verified' => $doctor['verified'] ? 1 : 0,
                            ':created_at' => nowIso()
                        ]);
                        $newDoctorId = (int) $db->lastInsertId();
                        $doctorCodeKey = strtoupper(trim((string) ($doctor['doctorCode'] ?? '')));
                        if ($doctorCodeKey !== '') {
                            $doctorIdMapByCode[$doctorCodeKey] = $newDoctorId;
                        }
                        $doctorNameKey = trim((string) ($doctor['normalizedName'] ?? ''));
                        if ($doctorNameKey !== '') {
                            $doctorIdMapByName[$doctorNameKey] = $newDoctorId;
                        }

                        if (!empty($doctor['presentPro'])) {
                            $insertWallet->execute([':pro_name' => trim((string) $doctor['presentPro']), ':updated_at' => nowIso()]);
                        }
                    }

                    foreach ($existingUserDoctorLinks as $link) {
                        $matchDoctorId = null;
                        $doctorCodeKey = strtoupper(trim((string) ($link['doctor_code'] ?? '')));
                        $doctorNameKey = trim((string) ($link['normalized_name'] ?? ''));

                        if ($doctorCodeKey !== '' && array_key_exists($doctorCodeKey, $doctorIdMapByCode)) {
                            $matchDoctorId = (int) $doctorIdMapByCode[$doctorCodeKey];
                        } elseif ($doctorNameKey !== '' && array_key_exists($doctorNameKey, $doctorIdMapByName)) {
                            $matchDoctorId = (int) $doctorIdMapByName[$doctorNameKey];
                        }

                        if ($matchDoctorId !== null) {
                            $updateUserDoctorLink->execute([
                                ':doctor_master_id' => $matchDoctorId,
                                ':updated_at' => nowIso(),
                                ':id' => (int) $link['id']
                            ]);
                        }
                    }

                    $db->prepare(
                        'INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
                         VALUES (\'reference_master\', :file_name, :row_count, :meta_json, :uploaded_at)'
                    )->execute([
                        ':file_name' => $parsed['fileName'],
                        ':row_count' => count($parsed['services']) + count($parsed['discountRules']) + count($parsed['doctors']),
                        ':meta_json' => json_encode([
                            'services' => count($parsed['services']),
                            'discountRules' => count($parsed['discountRules']),
                            'doctors' => count($parsed['doctors'])
                        ], JSON_UNESCAPED_UNICODE),
                        ':uploaded_at' => nowIso()
                    ]);

                    $db->commit();

                    sendJson([
                        'ok' => true,
                        'fileName' => $parsed['fileName'],
                        'inserted' => [
                            'services' => count($parsed['services']),
                            'discountRules' => count($parsed['discountRules']),
                            'doctors' => count($parsed['doctors'])
                        ]
                    ]);
                } catch (Throwable $error) {
                    if ($db->inTransaction()) {
                        $db->rollBack();
                    }
                    throw $error;
                }
            } finally {
                @unlink($path);
            }
        }

        if ($segments[1] === 'software' && $segments[2] === 'upload' && $method === 'POST') {
            if (!isset($_FILES['file'])) {
                sendJson(['error' => 'File is required'], 400);
            }

            $path = uploadTempFile($_FILES['file']);
            try {
                $parsed = parseSoftwareRequirementsWorkbook($path);
                $insertReq = $db->prepare('INSERT INTO software_requirements (category, requirement_text, created_at) VALUES (:category, :requirement_text, :created_at)');
                $db->beginTransaction();

                try {
                    $db->prepare('DELETE FROM software_requirements')->execute();
                    foreach ($parsed['requirements'] as $requirement) {
                        $insertReq->execute([
                            ':category' => $requirement['category'],
                            ':requirement_text' => $requirement['requirementText'],
                            ':created_at' => nowIso()
                        ]);
                    }

                    $db->prepare(
                        'INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
                         VALUES (\'software_requirements\', :file_name, :row_count, :meta_json, :uploaded_at)'
                    )->execute([
                        ':file_name' => $parsed['fileName'],
                        ':row_count' => count($parsed['requirements']),
                        ':meta_json' => json_encode(['requirements' => count($parsed['requirements'])], JSON_UNESCAPED_UNICODE),
                        ':uploaded_at' => nowIso()
                    ]);

                    $db->commit();
                    sendJson(['ok' => true, 'fileName' => $parsed['fileName'], 'inserted' => count($parsed['requirements'])]);
                } catch (Throwable $error) {
                    if ($db->inTransaction()) {
                        $db->rollBack();
                    }
                    throw $error;
                }
            } finally {
                @unlink($path);
            }
        }

        if (
            $segments[1] === 'doctors'
            && ($segments[3] ?? '') === 'verify'
            && $method === 'PATCH'
        ) {
            assertAuth($db, true);
            $id = intSafe($segments[2] ?? null, null);
            $body = requestBody();
            $verified = (bool) ($body['verified'] ?? false);

            $db->prepare('UPDATE doctor_master SET verified = :verified WHERE id = :id')->execute([
                ':verified' => $verified ? 1 : 0,
                ':id' => $id
            ]);

            sendJson(['ok' => true]);
        }

        if ($segments[1] === 'doctors' && $segments[2] === 'change-pro' && $method === 'POST') {
            $body = requestBody();
            $doctorId = intSafe($body['doctorId'] ?? null, null);
            $nextPro = trim((string) ($body['nextPro'] ?? ''));
            $reason = $body['reason'] ?? null;

            if (!$doctorId || $nextPro === '') {
                sendJson(['error' => 'doctorId and nextPro are required'], 400);
            }

            $db->prepare(
                'INSERT INTO approval_requests (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
                 VALUES (\'change_of_pro\', :entity_id, :payload_json, \'pending\', :requested_by, NULL, :created_at, :updated_at)'
            )->execute([
                ':entity_id' => (string) $doctorId,
                ':payload_json' => json_encode([
                    'doctorId' => $doctorId,
                    'nextPro' => $nextPro,
                    'reason' => $reason
                ], JSON_UNESCAPED_UNICODE),
                ':requested_by' => $user['email'],
                ':created_at' => nowIso(),
                ':updated_at' => nowIso()
            ]);

            sendJson(['ok' => true, 'requestId' => (int) $db->lastInsertId()]);
        }

        if ($segments[1] === 'doctors' && $segments[2] === 'request-update' && $method === 'POST') {
            $body = requestBody();
            $doctorId = intSafe($body['doctorId'] ?? null, null);
            $reason = trim((string) ($body['reason'] ?? ''));
            $changes = is_array($body['changes'] ?? null) ? $body['changes'] : [];

            if (!$doctorId || $reason === '') {
                sendJson(['error' => 'doctorId and reason are required'], 400);
            }

            $doctor = $db->prepare('SELECT * FROM doctor_master WHERE id = :id');
            $doctor->execute([':id' => $doctorId]);
            $doctorRow = $doctor->fetch();
            if (!$doctorRow) {
                sendJson(['error' => 'Doctor not found'], 404);
            }

            $allowedFields = [
                'doctorName',
                'doctorCode',
                'location',
                'hospitalName',
                'degree',
                'contactNo',
                'presentPro',
                'incentiveGroup',
                'incentiveCycle',
                'reportingDoctor',
                'confirmationStatus',
                'confirmationRemarks',
                'conversionIncentiveGroup',
                'targetInvestigation',
                'verified'
            ];

            $sanitizedChanges = [];
            foreach ($allowedFields as $field) {
                if (!array_key_exists($field, $changes)) {
                    continue;
                }

                if ($field === 'verified') {
                    $sanitizedChanges[$field] = !empty($changes[$field]);
                    continue;
                }

                $value = trim((string) $changes[$field]);
                if ($value === '') {
                    continue;
                }

                if ($field === 'confirmationStatus') {
                    $value = strtolower(str_replace([' ', '-'], '_', $value));
                    if (!in_array($value, ['pending', 'confirmed', 'not_confirmed'], true)) {
                        continue;
                    }
                }

                if ($field === 'incentiveGroup') {
                    $value = strtoupper($value);
                }

                $sanitizedChanges[$field] = $value;
            }

            if (count($sanitizedChanges) === 0) {
                sendJson(['error' => 'At least one valid doctor change is required'], 400);
            }

            $db->prepare(
                'INSERT INTO approval_requests (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
                 VALUES (\'change_of_doctor_info\', :entity_id, :payload_json, \'pending\', :requested_by, NULL, :created_at, :updated_at)'
            )->execute([
                ':entity_id' => (string) $doctorId,
                ':payload_json' => json_encode([
                    'doctorId' => $doctorId,
                    'doctorName' => $doctorRow['doctor_name'],
                    'reason' => $reason,
                    'changes' => $sanitizedChanges
                ], JSON_UNESCAPED_UNICODE),
                ':requested_by' => $user['email'],
                ':created_at' => nowIso(),
                ':updated_at' => nowIso()
            ]);

            sendJson(['ok' => true, 'requestId' => (int) $db->lastInsertId()]);
        }

        if ($segments[1] === 'doctors' && $segments[2] === 'request-add' && $method === 'POST') {
            $body = requestBody();
            $reason = trim((string) ($body['reason'] ?? ''));
            $doctor = is_array($body['doctor'] ?? null) ? $body['doctor'] : [];

            $doctorName = trim((string) ($doctor['doctorName'] ?? ''));
            if ($doctorName === '' || $reason === '') {
                sendJson(['error' => 'doctor name and reason are required'], 400);
            }

            $confirmationStatus = strtolower(str_replace([' ', '-'], '_', trim((string) ($doctor['confirmationStatus'] ?? 'pending'))));
            if (!in_array($confirmationStatus, ['pending', 'confirmed', 'not_confirmed'], true)) {
                $confirmationStatus = 'pending';
            }

            $payloadDoctor = [
                'location' => trim((string) ($doctor['location'] ?? '')),
                'doctorName' => $doctorName,
                'doctorCode' => trim((string) ($doctor['doctorCode'] ?? '')),
                'hospitalName' => trim((string) ($doctor['hospitalName'] ?? '')),
                'degree' => trim((string) ($doctor['degree'] ?? '')),
                'contactNo' => trim((string) ($doctor['contactNo'] ?? '')),
                'presentPro' => trim((string) ($doctor['presentPro'] ?? '')),
                'incentiveGroup' => strtoupper(trim((string) ($doctor['incentiveGroup'] ?? ''))),
                'incentiveCycle' => trim((string) ($doctor['incentiveCycle'] ?? '')),
                'reportingDoctor' => trim((string) ($doctor['reportingDoctor'] ?? '')),
                'confirmationStatus' => $confirmationStatus,
                'confirmationRemarks' => trim((string) ($doctor['confirmationRemarks'] ?? '')),
                'conversionIncentiveGroup' => trim((string) ($doctor['conversionIncentiveGroup'] ?? '')),
                'targetInvestigation' => trim((string) ($doctor['targetInvestigation'] ?? '')),
                'verified' => !empty($doctor['verified'])
            ];

            $db->prepare(
                'INSERT INTO approval_requests (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
                 VALUES (\'addition_of_doctor\', NULL, :payload_json, \'pending\', :requested_by, NULL, :created_at, :updated_at)'
            )->execute([
                ':payload_json' => json_encode([
                    'doctor' => $payloadDoctor,
                    'reason' => $reason
                ], JSON_UNESCAPED_UNICODE),
                ':requested_by' => $user['email'],
                ':created_at' => nowIso(),
                ':updated_at' => nowIso()
            ]);

            sendJson(['ok' => true, 'requestId' => (int) $db->lastInsertId()]);
        }
    }

    if ($segment === 'data' && $method === 'POST' && ($segments[1] ?? '') === 'upload') {
        if (!isset($_FILES['file'])) {
            sendJson(['error' => 'File is required'], 400);
        }

        $query = $_POST;
        $year = intSafe($query['year'] ?? null, null);
        $month = intSafe($query['month'] ?? null, null);

        if ($year && $month && isPeriodLocked($db, (int) $year, (int) $month)) {
            sendJson(['error' => 'Selected period is locked'], 409);
        }

        $path = uploadTempFile($_FILES['file']);
        try {
            $parsed = parseTransactionsWorkbook($path);
            $periodSummary = summarizeTransactionPeriods($parsed['transactions']);
            $effectiveDoctorScope = ($user['role'] ?? '') === 'doctor' ? getDoctorScopeForUser($db, $user, true) : null;

            if ($effectiveDoctorScope !== null) {
                $mismatchDoctors = [];
                foreach ($parsed['transactions'] as $row) {
                    $normalizedDoctor = trim((string) ($row['normalizedDoctor'] ?? ''));
                    if ($normalizedDoctor === '' || $normalizedDoctor !== (string) $effectiveDoctorScope['normalized_name']) {
                        $displayDoctor = trim((string) ($row['referringDoctor'] ?? ''));
                        if ($displayDoctor === '') {
                            $displayDoctor = '(blank doctor)';
                        }
                        $mismatchDoctors[$displayDoctor] = true;
                        if (count($mismatchDoctors) >= 6) {
                            break;
                        }
                    }
                }

                if (!empty($mismatchDoctors)) {
                    sendJson([
                        'error' => 'Doctor upload can include only your own doctor records. Mismatched doctors: ' . implode(', ', array_keys($mismatchDoctors))
                    ], 403);
                }
            }

            if (!empty($parsed['isIncentiveOnlyWorkbook'])) {
                $effectiveYear = $year ?: (int) ($periodSummary['primaryYear'] ?? 0);
                $effectiveMonth = $month ?: (int) ($periodSummary['primaryMonth'] ?? 0);

                if ($effectiveYear <= 0 || $effectiveMonth < 1 || $effectiveMonth > 12) {
                    sendJson(['error' => 'Select the target month before uploading the incentive workbook'], 400);
                }

                $imported = importIncentiveWorkbookRows(
                    $db,
                    $parsed['fileName'],
                    $parsed['transactions'],
                    (int) $effectiveYear,
                    (int) $effectiveMonth
                );

                $db->prepare(
                    'INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
                     VALUES (\'incentive_workbook\', :file_name, :row_count, :meta_json, :uploaded_at)'
                )->execute([
                    ':file_name' => $parsed['fileName'],
                    ':row_count' => $imported['savedCount'],
                    ':meta_json' => json_encode([
                        'periodYear' => $effectiveYear,
                        'periodMonth' => $effectiveMonth,
                        'matchedRows' => $imported['matchedCount'],
                        'exactPayableRows' => $imported['exactPayableCount'],
                        'skippedRows' => $imported['skippedCount'],
                    ], JSON_UNESCAPED_UNICODE),
                    ':uploaded_at' => nowIso()
                ]);

                sendJson([
                    'ok' => true,
                    'mode' => 'incentive_workbook',
                    'fileName' => $parsed['fileName'],
                    'saved' => $imported['savedCount'],
                    'matched' => $imported['matchedCount'],
                    'exactPayable' => $imported['exactPayableCount'],
                    'skipped' => $imported['skippedCount'],
                    'detectedPeriodYear' => $effectiveYear,
                    'detectedPeriodMonth' => $effectiveMonth,
                ]);
            }

            $insert = $db->prepare(
                'INSERT INTO transactions
                 (source_file, source_type, visit_id, visit_date, patient_id, patient_name, sex, modality,
                  visit_description, referring_doctor, normalized_doctor, pro_name, status, receipt_status,
                  billable_items, total_price, total_discount, total_net, total_payment, payment_method, revenue_booked_in, balance_amount,
                  notes, raw_json, created_at)
                 VALUES (:source_file, :source_type, :visit_id, :visit_date, :patient_id, :patient_name, :sex, :modality,
                         :visit_description, :referring_doctor, :normalized_doctor, :pro_name, :status, :receipt_status,
                         :billable_items, :total_price, :total_discount, :total_net, :total_payment, :payment_method, :revenue_booked_in, :balance_amount,
                         :notes, :raw_json, :created_at)'
            );

            $insertWallet = $db->prepare(
                'INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
                 VALUES (:pro_name, 0, :updated_at)
                 ON CONFLICT(pro_name) DO NOTHING'
            );

            $effectiveYear = $year ?: (int) ($periodSummary['primaryYear'] ?? 0);
            $effectiveMonth = $month ?: (int) ($periodSummary['primaryMonth'] ?? 0);
            $incentiveImport = null;

            $db->beginTransaction();
            try {
                foreach ($parsed['transactions'] as $row) {
                    $insert->execute([
                        ':source_file' => $row['sourceFile'],
                        ':source_type' => $row['sourceType'],
                        ':visit_id' => $row['visitId'],
                        ':visit_date' => $row['visitDate'],
                        ':patient_id' => $row['patientId'],
                        ':patient_name' => $row['patientName'],
                        ':sex' => $row['sex'],
                        ':modality' => $row['modality'],
                        ':visit_description' => $row['visitDescription'],
                        ':referring_doctor' => $row['referringDoctor'],
                        ':normalized_doctor' => $row['normalizedDoctor'],
                        ':pro_name' => $row['proName'],
                        ':status' => $row['status'],
                        ':receipt_status' => $row['receiptStatus'],
                        ':billable_items' => $row['billableItems'],
                        ':total_price' => $row['totalPrice'],
                        ':total_discount' => $row['totalDiscount'],
                        ':total_net' => $row['totalNet'],
                        ':total_payment' => $row['totalPayment'],
                        ':payment_method' => $row['paymentMethod'],
                        ':revenue_booked_in' => $row['revenueBookedIn'],
                        ':balance_amount' => $row['balanceAmount'],
                        ':notes' => $row['notes'],
                        ':raw_json' => $row['rawJson'],
                        ':created_at' => nowIso()
                    ]);

                    if (!empty($row['proName'])) {
                        $insertWallet->execute([':pro_name' => trim((string) $row['proName']), ':updated_at' => nowIso()]);
                    }
                }

                if (!empty($parsed['containsIncentiveRows']) && $effectiveYear > 0 && $effectiveMonth >= 1 && $effectiveMonth <= 12) {
                    $incentiveImport = importIncentiveWorkbookRows(
                        $db,
                        $parsed['fileName'],
                        $parsed['transactions'],
                        (int) $effectiveYear,
                        (int) $effectiveMonth
                    );

                    $db->prepare(
                        'INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
                         VALUES (\'incentive_workbook\', :file_name, :row_count, :meta_json, :uploaded_at)'
                    )->execute([
                        ':file_name' => $parsed['fileName'],
                        ':row_count' => $incentiveImport['savedCount'],
                        ':meta_json' => json_encode([
                            'periodYear' => $effectiveYear,
                            'periodMonth' => $effectiveMonth,
                            'matchedRows' => $incentiveImport['matchedCount'],
                            'exactPayableRows' => $incentiveImport['exactPayableCount'],
                            'skippedRows' => $incentiveImport['skippedCount'],
                            'combinedUpload' => true,
                        ], JSON_UNESCAPED_UNICODE),
                        ':uploaded_at' => nowIso()
                    ]);
                }

                $db->prepare(
                    'INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
                     VALUES (\'transaction_data\', :file_name, :row_count, :meta_json, :uploaded_at)'
                )->execute([
                    ':file_name' => $parsed['fileName'],
                    ':row_count' => count($parsed['transactions']),
                    ':meta_json' => json_encode([
                        'sourceType' => $parsed['transactions'][0]['sourceType'] ?? 'unknown',
                        'periods' => $periodSummary['periods'],
                    ], JSON_UNESCAPED_UNICODE),
                    ':uploaded_at' => nowIso()
                ]);

                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $error;
            }

            sendJson([
                'ok' => true,
                'mode' => $incentiveImport !== null ? 'combined_upload' : 'transaction_data',
                'inserted' => count($parsed['transactions']),
                'fileName' => $parsed['fileName'],
                'detectedPeriodYear' => $periodSummary['primaryYear'],
                'detectedPeriodMonth' => $periodSummary['primaryMonth'],
                'detectedPeriods' => $periodSummary['periods'],
                'incentiveSaved' => $incentiveImport['savedCount'] ?? 0,
                'incentiveMatched' => $incentiveImport['matchedCount'] ?? 0,
                'incentiveExactPayable' => $incentiveImport['exactPayableCount'] ?? 0,
            ]);
        } finally {
            @unlink($path);
        }
    }

    if ($segment === 'data' && $method === 'GET' && ($segments[1] ?? '') === 'records') {
        $query = $_GET;
        $page = max(1, getQueryInt($query, 'page', 1) ?? 1);
        $pageSize = min(250, max(1, getQueryInt($query, 'pageSize', 25) ?? 25));
        $offset = ($page - 1) * $pageSize;
        $year = getQueryInt($query, 'year', null);
        $month = getQueryInt($query, 'month', null);
        $search = trim((string) ($query['search'] ?? ''));
        $effectiveDoctorScope = ($user['role'] ?? '') === 'doctor' ? getDoctorScopeForUser($db, $user, true) : null;

        $where = [];
        $params = [];

        if ($year && $month) {
            $range = buildDateRange($year, $month);
            $where[] = 'visit_date IS NOT NULL AND visit_date >= :start AND visit_date <= :end';
            $params[':start'] = $range['start'];
            $params[':end'] = $range['end'];
        }

        if ($search !== '') {
            $where[] = '(
                patient_id LIKE :search
                OR patient_name LIKE :search
                OR referring_doctor LIKE :search
                OR billable_items LIKE :search
                OR pro_name LIKE :search
                OR payment_method LIKE :search
                OR revenue_booked_in LIKE :search
                OR status LIKE :search
                OR receipt_status LIKE :search
                OR visit_date LIKE :search
                OR CAST(COALESCE(total_price, 0) AS TEXT) LIKE :search
                OR CAST(COALESCE(total_discount, 0) AS TEXT) LIKE :search
                OR CAST(COALESCE(total_net, 0) AS TEXT) LIKE :search
                OR CAST(COALESCE(total_payment, 0) AS TEXT) LIKE :search
            )';
            $params[':search'] = "%{$search}%";
        }

        if ($effectiveDoctorScope !== null) {
            $where[] = 'normalized_doctor = :doctor_normalized';
            $params[':doctor_normalized'] = (string) $effectiveDoctorScope['normalized_name'];
        }

        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $countSql = "SELECT COUNT(*) AS count FROM transactions {$whereSql}";
        $countStmt = $db->prepare($countSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetch()['count'];

        $latestPeriod = null;
        $latestParams = [];
        $latestWhere = ['visit_date IS NOT NULL'];
        if ($effectiveDoctorScope !== null) {
            $latestWhere[] = 'normalized_doctor = :doctor_normalized';
            $latestParams[':doctor_normalized'] = (string) $effectiveDoctorScope['normalized_name'];
        }

        $latestStmt = $db->prepare(
            'SELECT
                CAST(strftime(\'%Y\', visit_date) AS INTEGER) AS period_year,
                CAST(strftime(\'%m\', visit_date) AS INTEGER) AS period_month,
                COUNT(*) AS row_count
             FROM transactions
             WHERE ' . implode(' AND ', $latestWhere) . '
             GROUP BY strftime(\'%Y-%m\', visit_date)
             ORDER BY period_year DESC, period_month DESC
             LIMIT 1'
        );
        $latestStmt->execute($latestParams);
        $latestRow = $latestStmt->fetch();
        if ($latestRow) {
            $latestPeriod = [
                'year' => (int) $latestRow['period_year'],
                'month' => (int) $latestRow['period_month'],
                'count' => (int) $latestRow['row_count'],
            ];
        }

        $rowsStmt = $db->prepare(
            "SELECT
              id, visit_date, patient_id, patient_name, referring_doctor, pro_name,
              billable_items, total_price, total_discount, total_net, total_payment,
              payment_method, revenue_booked_in, status, receipt_status
             FROM transactions
             {$whereSql}
             ORDER BY COALESCE(visit_date, created_at) DESC
             LIMIT :limit OFFSET :offset"
        );
        foreach ($params as $paramKey => $paramValue) {
            $rowsStmt->bindValue($paramKey, $paramValue);
        }
        $rowsStmt->bindValue(':limit', $pageSize, PDO::PARAM_INT);
        $rowsStmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $rowsStmt->execute();

        sendJson([
            'rows' => $rowsStmt->fetchAll(),
            'page' => $page,
            'pageSize' => $pageSize,
            'total' => $total,
            'latestPeriodWithData' => $latestPeriod,
        ]);
    }

    if ($segment === 'data' && $method === 'GET' && ($segments[1] ?? '') === 'export') {
        $query = $_GET;
        $year = getQueryInt($query, 'year', null);
        $month = getQueryInt($query, 'month', null);
        $effectiveDoctorScope = ($user['role'] ?? '') === 'doctor' ? getDoctorScopeForUser($db, $user, true) : null;

        $where = [];
        $params = [];
        if ($year && $month) {
            $range = buildDateRange($year, $month);
            $where[] = 'visit_date IS NOT NULL AND visit_date >= :start AND visit_date <= :end';
            $params[':start'] = $range['start'];
            $params[':end'] = $range['end'];
        }

        if ($effectiveDoctorScope !== null) {
            $where[] = 'normalized_doctor = :doctor_normalized';
            $params[':doctor_normalized'] = (string) $effectiveDoctorScope['normalized_name'];
        }

        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $rowsStmt = $db->prepare(
            "SELECT
               visit_date AS 'Visit Date',
               patient_id AS 'Patient ID',
               patient_name AS 'Patient Name',
               referring_doctor AS 'Doctor',
               pro_name AS 'PRO',
               billable_items AS 'Item',
               total_price AS 'Price',
               total_discount AS 'Discount',
               total_net AS 'Net',
               total_payment AS 'Total Payment Received',
               payment_method AS 'Payment Method',
               revenue_booked_in AS 'Revenue Booked In',
               status AS 'Visit Status',
               receipt_status AS 'Receipt Status',
               notes AS 'Notes'
             FROM transactions
             {$whereSql}
             ORDER BY COALESCE(visit_date, created_at) DESC"
        );
        $rowsStmt->execute($params);
        $rows = $rowsStmt->fetchAll();

        sendCsvResponse(toCsv($rows), 'data-export-' . time() . '.csv');
    }

    if ($segment === 'engine' && ($user['role'] ?? '') === 'doctor') {
        sendJson(['error' => 'Doctor users do not have access to engine endpoints'], 403);
    }

    if ($segment === 'engine' && $method === 'POST' && ($segments[1] ?? '') === 'run') {
        $body = requestBody();
        $year = getQueryInt($body, 'year', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y'));
        $month = getQueryInt($body, 'month', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('m'));

        if (isPeriodLocked($db, (int) $year, (int) $month)) {
            sendJson(['error' => 'Selected period is locked'], 409);
        }

        $result = runEngineForPeriod($db, (int) $year, (int) $month);
        sendJson($result);
    }

    if ($segment === 'engine' && $method === 'GET' && ($segments[1] ?? '') === 'runs') {
        $query = $_GET;
        $limit = min(100, max(1, getQueryInt($query, 'limit', 12) ?? 12));

        $runs = $db->prepare('SELECT * FROM engine_runs ORDER BY run_at DESC LIMIT :limit');
        $runs->bindValue(':limit', $limit, PDO::PARAM_INT);
        $runs->execute();

        sendJson(['runs' => $runs->fetchAll()]);
    }

    if ($segment === 'engine' && $method === 'GET' && ($segments[1] ?? '') === 'results') {
        $query = $_GET;
        $runId = getQueryInt($query, 'runId', null);
        if (!$runId) {
            sendJson(['error' => 'runId is required'], 400);
        }

        $page = max(1, getQueryInt($query, 'page', 1) ?? 1);
        $pageSize = min(500, max(1, getQueryInt($query, 'pageSize', 50) ?? 50));
        $offset = ($page - 1) * $pageSize;
        $flaggedOnly = (($query['flaggedOnly'] ?? 'false') === 'true');

        $where = $flaggedOnly ? 'WHERE run_id = :run_id AND approval_required = 1' : 'WHERE run_id = :run_id';

        $count = $db->prepare("SELECT COUNT(*) AS count FROM engine_results {$where}");
        $count->execute([':run_id' => (int) $runId]);
        $total = (int) $count->fetch()['count'];

        $rowsStmt = $db->prepare(
            "SELECT
               id, transaction_id, doctor_name, doctor_group, pro_name, modality, item_list, status,
               allowed_discount, actual_discount, payable_discount,
               (COALESCE(allowed_discount, 0) - (COALESCE(actual_discount, 0) + COALESCE(payable_discount, 0))) AS variance,
               group_rule_violation, approval_required, remark, net_amount
             FROM engine_results
             {$where}
             ORDER BY approval_required DESC, ABS(COALESCE(allowed_discount, 0) - (COALESCE(actual_discount, 0) + COALESCE(payable_discount, 0))) DESC
             LIMIT :limit OFFSET :offset"
        );
        $rowsStmt->bindValue(':run_id', (int) $runId, PDO::PARAM_INT);
        $rowsStmt->bindValue(':limit', $pageSize, PDO::PARAM_INT);
        $rowsStmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $rowsStmt->execute();

        sendJson([
            'rows' => $rowsStmt->fetchAll(),
            'page' => $page,
            'pageSize' => $pageSize,
            'total' => $total
        ]);
    }

    if ($segment === 'engine' && $method === 'GET' && ($segments[1] ?? '') === 'productivity') {
        $query = $_GET;
        $year = getQueryInt($query, 'year', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y'));
        $month = getQueryInt($query, 'month', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('m'));

        sendJson(['rows' => getProductivityReport($db, (int) $year, (int) $month)]);
    }

    if ($segment === 'engine' && $method === 'POST' && ($segments[1] ?? '') === 'override-incentive') {
        $body = requestBody();
        $runId = intSafe($body['runId'] ?? null, null);
        $paymentId = intSafe($body['paymentId'] ?? null, null);
        $oldAmountRaw = $body['oldAmount'] ?? null;
        $newAmountRaw = $body['newAmount'] ?? null;
        $oldAmount = $oldAmountRaw === null || $oldAmountRaw === '' ? null : (float) $oldAmountRaw;
        $newAmount = $newAmountRaw === null || $newAmountRaw === '' ? null : (float) $newAmountRaw;
        $reason = trim((string) ($body['reason'] ?? ''));

        if (!$paymentId || $oldAmount === null || $newAmount === null || $reason === '') {
            sendJson(['error' => 'paymentId, oldAmount, newAmount, and reason are required'], 400);
        }

        $now = nowIso();
        $db->prepare(
            'INSERT INTO approval_requests
             (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
             VALUES (\'override_of_incentive_amount\', :entity_id, :payload_json, \'pending\', :requested_by, NULL, :created_at, :updated_at)'
        )->execute([
            ':entity_id' => (string) $paymentId,
            ':payload_json' => json_encode([
                'runId' => $runId,
                'paymentId' => $paymentId,
                'oldAmount' => $oldAmount,
                'newAmount' => $newAmount,
                'reason' => $reason
            ], JSON_UNESCAPED_UNICODE),
            ':requested_by' => $user['email'],
            ':created_at' => $now,
            ':updated_at' => $now
        ]);

        sendJson(['ok' => true, 'requestId' => (int) $db->lastInsertId()]);
    }

    if ($segment === 'payments' && $method === 'GET') {
        $query = $_GET;
        $year = getQueryInt($query, 'year', null);
        $month = getQueryInt($query, 'month', null);
        $status = trim((string) ($query['status'] ?? ''));
        $effectiveDoctorScope = ($user['role'] ?? '') === 'doctor' ? getDoctorScopeForUser($db, $user, true) : null;

        $where = [];
        $params = [];

        if ($year) {
            $where[] = 'period_year = :period_year';
            $params[':period_year'] = (int) $year;
        }

        if ($month) {
            $where[] = 'period_month = :period_month';
            $params[':period_month'] = (int) $month;
        }

        if ($status !== '') {
            $where[] = 'status = :status';
            $params[':status'] = $status;
        }

        if ($effectiveDoctorScope !== null) {
            $where[] = 'UPPER(TRIM(doctor_name)) = UPPER(TRIM(:doctor_name))';
            $params[':doctor_name'] = (string) $effectiveDoctorScope['doctor_name'];
        }

        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $rowsStmt = $db->prepare(
            "SELECT
              id, run_id, doctor_name, pro_name, period_year, period_month, amount,
              adjustment_amount, advance_payment, return_incentive_amount,
              status, approval_status, cash_in_hand_snapshot, pro_cash_in_hand, manager_cash_in_hand,
              cashier_handover_at, pro_handover_at, disbursed_on, notes,
              created_at, updated_at
             FROM payments
             {$whereSql}
             ORDER BY created_at DESC"
        );
        $rowsStmt->execute($params);

        $summaryStmt = $db->prepare(
            "SELECT
               COUNT(*) AS total,
               COALESCE(SUM(amount), 0) AS total_amount,
               COALESCE(SUM(COALESCE(amount, 0) + COALESCE(adjustment_amount, 0) - COALESCE(advance_payment, 0) - COALESCE(return_incentive_amount, 0)), 0) AS final_amount,
               COALESCE(SUM(CASE WHEN approval_status = 'pending' THEN amount ELSE 0 END), 0) AS pending_approval_amount,
               COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_amount,
               COALESCE(SUM(COALESCE(adjustment_amount, 0)), 0) AS total_adjustments,
               COALESCE(SUM(COALESCE(advance_payment, 0)), 0) AS total_advance,
               COALESCE(SUM(COALESCE(return_incentive_amount, 0)), 0) AS total_return_incentive
             FROM payments
             {$whereSql}"
        );
        $summaryStmt->execute($params);

        sendJson(['rows' => $rowsStmt->fetchAll(), 'summary' => $summaryStmt->fetch()]);
    }

    if ($segment === 'payments' && $method === 'POST' && ($segments[1] ?? '') === 'generate') {
        if (($user['role'] ?? '') === 'doctor') {
            sendJson(['error' => 'Doctor users cannot generate payments'], 403);
        }

        $body = requestBody();
        $runId = intSafe($body['runId'] ?? null, null);
        if (!$runId) {
            sendJson(['error' => 'runId is required'], 400);
        }

        $result = generatePaymentsFromRun($db, (int) $runId);
        sendJson($result);
    }

    if ($segment === 'payments' && $method === 'PATCH') {
        if (($user['role'] ?? '') === 'doctor') {
            sendJson(['error' => 'Doctor users cannot update payments'], 403);
        }

        $id = intSafe($segments[1] ?? null, null);
        if (!$id) {
            sendJson(['error' => 'payment id is required'], 400);
        }

        $body = requestBody();
        $payment = $db->prepare('SELECT * FROM payments WHERE id = :id');
        $payment->execute([':id' => $id]);
        $paymentRow = $payment->fetch();
        if (!$paymentRow) {
            sendJson(['error' => 'Payment not found'], 404);
        }

        $nextStatus = (string) ($body['status'] ?? (string) $paymentRow['status']);
        $nextApproval = (string) ($body['approvalStatus'] ?? (string) $paymentRow['approval_status']);
        $notes = $body['notes'] ?? $paymentRow['notes'];
        $proCashInHand = floatval($body['proCashInHand'] ?? $body['cashInHand'] ?? (float) ($paymentRow['pro_cash_in_hand'] ?? $paymentRow['cash_in_hand_snapshot']));
        $managerCashInHand = floatval($body['managerCashInHand'] ?? (float) ($paymentRow['manager_cash_in_hand'] ?? 0));
        $adjustmentAmount = floatval($body['adjustmentAmount'] ?? (float) ($paymentRow['adjustment_amount'] ?? 0));
        $advancePayment = floatval($body['advancePayment'] ?? (float) ($paymentRow['advance_payment'] ?? 0));
        $returnIncentiveAmount = floatval($body['returnIncentiveAmount'] ?? (float) ($paymentRow['return_incentive_amount'] ?? 0));
        $cashierHandoverAt = isset($body['cashierHandoverAt'])
            ? (trim((string) $body['cashierHandoverAt']) !== '' ? trim((string) $body['cashierHandoverAt']) : null)
            : ($paymentRow['cashier_handover_at'] ?? null);
        $proHandoverAt = isset($body['proHandoverAt'])
            ? (trim((string) $body['proHandoverAt']) !== '' ? trim((string) $body['proHandoverAt']) : null)
            : ($paymentRow['pro_handover_at'] ?? null);

        if (!empty((string) $paymentRow['pro_name'])) {
            $db->prepare(
                'INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
                 VALUES (:pro_name, :cash_in_hand, :updated_at)
                 ON CONFLICT(pro_name) DO UPDATE SET cash_in_hand = excluded.cash_in_hand, updated_at = excluded.updated_at'
            )->execute([
                ':pro_name' => $paymentRow['pro_name'],
                ':cash_in_hand' => (float) $proCashInHand,
                ':updated_at' => nowIso()
            ]);
        }

        $hasOutstandingCash = ($proCashInHand > 0 || $managerCashInHand > 0);
        $resolvedStatus = $hasOutstandingCash ? 'on_hold' : $nextStatus;
        $disbursedOn = $resolvedStatus === 'paid' ? nowIso() : null;

        $db->prepare(
            'UPDATE payments
             SET status = :status, approval_status = :approval_status, notes = :notes,
                 adjustment_amount = :adjustment_amount,
                 advance_payment = :advance_payment,
                 return_incentive_amount = :return_incentive_amount,
                 cash_in_hand_snapshot = :cash_in_hand_snapshot,
                 pro_cash_in_hand = :pro_cash_in_hand,
                 manager_cash_in_hand = :manager_cash_in_hand,
                 cashier_handover_at = :cashier_handover_at,
                 pro_handover_at = :pro_handover_at,
                 disbursed_on = :disbursed_on,
                 updated_at = :updated_at
             WHERE id = :id'
        )->execute([
            ':status' => $resolvedStatus,
            ':approval_status' => $nextApproval,
            ':notes' => $notes,
            ':adjustment_amount' => $adjustmentAmount,
            ':advance_payment' => $advancePayment,
            ':return_incentive_amount' => $returnIncentiveAmount,
            ':cash_in_hand_snapshot' => (float) $proCashInHand,
            ':pro_cash_in_hand' => (float) $proCashInHand,
            ':manager_cash_in_hand' => (float) $managerCashInHand,
            ':cashier_handover_at' => $cashierHandoverAt,
            ':pro_handover_at' => $proHandoverAt,
            ':disbursed_on' => $disbursedOn,
            ':updated_at' => nowIso(),
            ':id' => $id
        ]);

        sendJson(['ok' => true]);
    }

    if ($segment === 'reports' && $method === 'GET' && ($segments[1] ?? '') === 'individual') {
        $query = $_GET;
        $effectiveDoctorScope = ($user['role'] ?? '') === 'doctor' ? getDoctorScopeForUser($db, $user, true) : null;
        $doctor = $effectiveDoctorScope
            ? trim((string) $effectiveDoctorScope['doctor_name'])
            : trim((string) ($query['doctor'] ?? ''));
        $year = getQueryInt($query, 'year', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y'));
        $month = getQueryInt($query, 'month', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('m'));

        if ($doctor === '') {
            sendJson(['error' => 'doctor is required'], 400);
        }

        $latestRunStmt = $db->prepare(
            'SELECT id FROM engine_runs WHERE period_year = :period_year AND period_month = :period_month ORDER BY run_at DESC LIMIT 1'
        );
        $latestRunStmt->execute([':period_year' => (int) $year, ':period_month' => (int) $month]);
        $latestRun = $latestRunStmt->fetch();
        if (!$latestRun) {
            sendJson(['error' => 'No engine run found for period'], 404);
        }

        $rowsStmt = $db->prepare(
            "SELECT
              doctor_name, doctor_group, pro_name, modality,
              actual_discount, allowed_discount, payable_discount,
              variance, approval_required, remark, status, net_amount
             FROM engine_results
             WHERE run_id = :run_id AND UPPER(TRIM(doctor_name)) = UPPER(TRIM(:doctor_name))
             ORDER BY ABS(variance) DESC"
        );
        $rowsStmt->execute([':run_id' => (int) $latestRun['id'], ':doctor_name' => $doctor]);

        sendCsvResponse(toCsv($rowsStmt->fetchAll()), 'individual-report-' . time() . '.csv');
    }

    if ($segment === 'reports' && $method === 'GET' && ($segments[1] ?? '') === 'multiple') {
        if (($user['role'] ?? '') === 'doctor') {
            sendJson(['error' => 'Doctor users cannot download grouped reports'], 403);
        }

        $query = $_GET;
        $year = getQueryInt($query, 'year', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y'));
        $month = getQueryInt($query, 'month', (int) (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('m'));
        $groupBy = strtolower(trim((string) ($query['groupBy'] ?? 'pro')));

        $latestRunStmt = $db->prepare(
            'SELECT id FROM engine_runs WHERE period_year = :period_year AND period_month = :period_month ORDER BY run_at DESC LIMIT 1'
        );
        $latestRunStmt->execute([':period_year' => (int) $year, ':period_month' => (int) $month]);
        $latestRun = $latestRunStmt->fetch();
        if (!$latestRun) {
            sendJson(['error' => 'No engine run found for period'], 404);
        }

        $groupExpr = "COALESCE(NULLIF(TRIM(pro_name), ''), 'UNASSIGNED')";
        if ($groupBy === 'doctor') {
            $groupExpr = "COALESCE(NULLIF(TRIM(doctor_name), ''), 'UNASSIGNED')";
        }
        if ($groupBy === 'group') {
            $groupExpr = "COALESCE(NULLIF(TRIM(doctor_group), ''), 'UNASSIGNED')";
        }

        $rowsStmt = $db->prepare("SELECT
              {$groupExpr} AS grouping,
              COUNT(*) AS total_records,
              COALESCE(SUM(actual_discount), 0) AS actual_discount,
              COALESCE(SUM(allowed_discount), 0) AS allowed_discount,
              COALESCE(SUM(payable_discount), 0) AS payable_discount,
              COALESCE(SUM(net_amount), 0) AS net_amount,
              COALESCE(SUM(CASE WHEN approval_required = 1 THEN 1 ELSE 0 END), 0) AS flagged
            FROM engine_results
            WHERE run_id = :run_id
            GROUP BY {$groupExpr}
            ORDER BY net_amount DESC");
        $rowsStmt->bindValue(':run_id', (int) $latestRun['id'], PDO::PARAM_INT);
        $rowsStmt->execute();

        sendCsvResponse(toCsv($rowsStmt->fetchAll()), 'multiple-report-' . time() . '.csv');
    }

    if ($segment === 'approvals' && $method === 'GET') {
        assertAuth($db, true);
        $query = $_GET;
        $status = trim((string) ($query['status'] ?? ''));

        $rows = $status
            ? $db->prepare('SELECT * FROM approval_requests WHERE status = :status ORDER BY created_at DESC')
            : $db->prepare('SELECT * FROM approval_requests ORDER BY created_at DESC');

        if ($status) {
            $rows->execute([':status' => $status]);
        } else {
            $rows->execute();
        }

        sendJson(['rows' => $rows->fetchAll()]);
    }

    if ($segment === 'approvals' && $method === 'POST') {
        $body = requestBody();
        $type = trim((string) ($body['type'] ?? ''));
        $entityId = $body['entityId'] ?? null;
        $payload = $body['payload'] ?? [];

        if ($type === '') {
            sendJson(['error' => 'type is required'], 400);
        }

        $db->prepare(
            'INSERT INTO approval_requests
             (type, entity_id, payload_json, status, requested_by, approved_by, created_at, updated_at)
             VALUES (:type, :entity_id, :payload_json, \'pending\', :requested_by, NULL, :created_at, :updated_at)'
        )->execute([
            ':type' => $type,
            ':entity_id' => $entityId !== null ? (string) $entityId : null,
            ':payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE),
            ':requested_by' => $user['email'],
            ':created_at' => nowIso(),
            ':updated_at' => nowIso()
        ]);

        sendJson(['id' => (int) $db->lastInsertId()]);
    }

    if ($segment === 'approvals' && $method === 'PATCH') {
        assertAuth($db, true);
        $id = intSafe($segments[1] ?? null, null);
        if (!$id) {
            sendJson(['error' => 'approval id is required'], 400);
        }

        $body = requestBody();
        $status = strtolower(trim((string) ($body['status'] ?? '')));
        if (!in_array($status, ['approved', 'rejected'], true)) {
            sendJson(['error' => 'status must be approved or rejected'], 400);
        }

        $request = $db->prepare('SELECT * FROM approval_requests WHERE id = :id');
        $request->execute([':id' => $id]);
        $requestRow = $request->fetch();
        if (!$requestRow) {
            sendJson(['error' => 'Approval request not found'], 404);
        }

        $db->beginTransaction();
        try {
            $db->prepare('UPDATE approval_requests SET status = :status, approved_by = :approved_by, updated_at = :updated_at WHERE id = :id')->execute([
                ':status' => $status,
                ':approved_by' => $user['email'],
                ':updated_at' => nowIso(),
                ':id' => $id
            ]);

            if ((string) $requestRow['type'] === 'approval_of_disbursal' && $requestRow['entity_id']) {
                if ($status === 'approved') {
                    $db->prepare("UPDATE payments SET approval_status = 'approved', updated_at = :updated_at WHERE id = :id")
                        ->execute([':updated_at' => nowIso(), ':id' => (int) $requestRow['entity_id']]);
                } else {
                    $db->prepare(
                        "UPDATE payments
                         SET approval_status = 'rejected', status = 'on_hold', notes = COALESCE(notes, '') || ' | Disbursal rejected', updated_at = :updated_at
                         WHERE id = :id"
                    )->execute([':updated_at' => nowIso(), ':id' => (int) $requestRow['entity_id']]);
                }
            }

            if ((string) $requestRow['type'] === 'change_of_pro' && $requestRow['entity_id'] && $status === 'approved') {
                $payload = json_decode((string) $requestRow['payload_json'], true) ?: [];
                if (!empty($payload['nextPro'])) {
                    $db->prepare('UPDATE doctor_master SET old_pro = present_pro, present_pro = :next_pro WHERE id = :id')->execute([
                        ':next_pro' => $payload['nextPro'],
                        ':id' => (int) $requestRow['entity_id']
                    ]);
                }
            }

            if ((string) $requestRow['type'] === 'override_of_incentive_amount' && $requestRow['entity_id'] && $status === 'approved') {
                $payload = json_decode((string) $requestRow['payload_json'], true) ?: [];
                if (isset($payload['newAmount'])) {
                    $db->prepare('UPDATE payments SET amount = :amount, updated_at = :updated_at WHERE id = :id')
                        ->execute([':amount' => (float) $payload['newAmount'], ':updated_at' => nowIso(), ':id' => (int) $requestRow['entity_id']]);
                }
            }

            if ((string) $requestRow['type'] === 'change_of_doctor_info' && $requestRow['entity_id'] && $status === 'approved') {
                $payload = json_decode((string) $requestRow['payload_json'], true) ?: [];
                $changes = is_array($payload['changes'] ?? null) ? $payload['changes'] : [];

                if (count($changes) > 0) {
                    $currentDoctorStmt = $db->prepare('SELECT * FROM doctor_master WHERE id = :id');
                    $currentDoctorStmt->execute([':id' => (int) $requestRow['entity_id']]);
                    $currentDoctor = $currentDoctorStmt->fetch();
                    if (!$currentDoctor) {
                        throw new RuntimeException('Doctor not found while applying doctor change request');
                    }

                    $fieldMap = [
                        'doctorName' => 'doctor_name',
                        'doctorCode' => 'doctor_code',
                        'location' => 'location',
                        'hospitalName' => 'hospital_name',
                        'degree' => 'degree',
                        'contactNo' => 'contact_no',
                        'presentPro' => 'present_pro',
                        'incentiveGroup' => 'incentive_group',
                        'incentiveCycle' => 'incentive_cycle',
                        'reportingDoctor' => 'reporting_doctor',
                        'confirmationStatus' => 'confirmation_status',
                        'confirmationRemarks' => 'confirmation_remarks',
                        'conversionIncentiveGroup' => 'conversion_incentive_group',
                        'targetInvestigation' => 'target_investigation',
                        'verified' => 'verified'
                    ];

                    $setParts = [];
                    $params = [':id' => (int) $requestRow['entity_id']];

                    foreach ($fieldMap as $payloadKey => $column) {
                        if (!array_key_exists($payloadKey, $changes)) {
                            continue;
                        }

                        if ($payloadKey === 'doctorName') {
                            $params[':doctor_name'] = trim((string) $changes[$payloadKey]);
                            $params[':normalized_name'] = normalizeText((string) $changes[$payloadKey]);
                            $setParts[] = 'doctor_name = :doctor_name';
                            $setParts[] = 'normalized_name = :normalized_name';
                            continue;
                        }

                        if ($payloadKey === 'presentPro') {
                            $params[':old_pro'] = $currentDoctor['present_pro'];
                            $params[':present_pro'] = trim((string) $changes[$payloadKey]);
                            $setParts[] = 'old_pro = :old_pro';
                            $setParts[] = 'present_pro = :present_pro';
                            continue;
                        }

                        $paramName = ':' . $column;
                        $params[$paramName] = ($payloadKey === 'verified')
                            ? (!empty($changes[$payloadKey]) ? 1 : 0)
                            : trim((string) $changes[$payloadKey]);
                        $setParts[] = "{$column} = {$paramName}";
                    }

                    if (count($setParts) > 0) {
                        $db->prepare(
                            'UPDATE doctor_master
                             SET ' . implode(', ', array_unique($setParts)) . '
                             WHERE id = :id'
                        )->execute($params);
                    }
                }
            }

            if ((string) $requestRow['type'] === 'addition_of_doctor' && $status === 'approved') {
                $payload = json_decode((string) $requestRow['payload_json'], true) ?: [];
                $doctor = is_array($payload['doctor'] ?? null) ? $payload['doctor'] : [];
                $doctorName = trim((string) ($doctor['doctorName'] ?? ''));
                if ($doctorName === '') {
                    throw new RuntimeException('Doctor name missing in addition request');
                }

                $doctorCode = trim((string) ($doctor['doctorCode'] ?? ''));
                $normalizedName = normalizeText($doctorName);
                $existsStmt = $doctorCode !== ''
                    ? $db->prepare('SELECT id FROM doctor_master WHERE doctor_code = :doctor_code OR normalized_name = :normalized_name LIMIT 1')
                    : $db->prepare('SELECT id FROM doctor_master WHERE normalized_name = :normalized_name LIMIT 1');

                $existsParams = [':normalized_name' => $normalizedName];
                if ($doctorCode !== '') {
                    $existsParams[':doctor_code'] = $doctorCode;
                }
                $existsStmt->execute($existsParams);
                if ($existsStmt->fetch()) {
                    throw new RuntimeException('Doctor already exists in master data');
                }

                $db->prepare(
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
                )->execute([
                    ':location' => trim((string) ($doctor['location'] ?? '')),
                    ':doctor_name' => $doctorName,
                    ':normalized_name' => $normalizedName,
                    ':doctor_code' => $doctorCode !== '' ? $doctorCode : null,
                    ':hospital_name' => trim((string) ($doctor['hospitalName'] ?? '')),
                    ':degree' => trim((string) ($doctor['degree'] ?? '')),
                    ':contact_no' => trim((string) ($doctor['contactNo'] ?? '')),
                    ':present_pro' => trim((string) ($doctor['presentPro'] ?? '')),
                    ':incentive_group' => strtoupper(trim((string) ($doctor['incentiveGroup'] ?? ''))),
                    ':incentive_cycle' => trim((string) ($doctor['incentiveCycle'] ?? '')),
                    ':conversion_incentive_group' => trim((string) ($doctor['conversionIncentiveGroup'] ?? '')),
                    ':target_investigation' => trim((string) ($doctor['targetInvestigation'] ?? '')),
                    ':reporting_doctor' => trim((string) ($doctor['reportingDoctor'] ?? '')),
                    ':confirmation_status' => trim((string) ($doctor['confirmationStatus'] ?? 'pending')) ?: 'pending',
                    ':confirmation_remarks' => trim((string) ($doctor['confirmationRemarks'] ?? '')),
                    ':verified' => !empty($doctor['verified']) ? 1 : 0,
                    ':created_at' => nowIso()
                ]);

                $newDoctorId = (int) $db->lastInsertId();
                $db->prepare('UPDATE approval_requests SET entity_id = :entity_id WHERE id = :id')->execute([
                    ':entity_id' => (string) $newDoctorId,
                    ':id' => (int) $requestRow['id']
                ]);
            }

            $db->commit();
            sendJson(['ok' => true]);
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
    }

    if ($segment === 'period-locks' && $method === 'GET') {
        $rows = $db->query('SELECT period_year, period_month, is_locked, lock_reason, locked_by, locked_at FROM locked_periods ORDER BY period_year DESC, period_month DESC')->fetchAll();
        sendJson(['rows' => $rows]);
    }

    if ($segment === 'period-locks' && $method === 'POST') {
        assertAuth($db, true);

        $body = requestBody();
        $periodYear = getQueryInt($body, 'year', null);
        $periodMonth = getQueryInt($body, 'month', null);
        $locked = !empty($body['locked']);
        $reason = isset($body['reason']) && (string) $body['reason'] !== '' ? trim((string) $body['reason']) : null;

        if (!$periodYear || !$periodMonth || $periodMonth < 1 || $periodMonth > 12) {
            sendJson(['error' => 'Valid year and month are required'], 400);
        }

        $db->prepare(
            'INSERT INTO locked_periods
             (period_year, period_month, is_locked, lock_reason, locked_by, locked_at)
             VALUES (:period_year, :period_month, :is_locked, :lock_reason, :locked_by, :locked_at)
             ON CONFLICT(period_year, period_month)
             DO UPDATE SET is_locked = excluded.is_locked,
                           lock_reason = excluded.lock_reason,
                           locked_by = excluded.locked_by,
                           locked_at = excluded.locked_at'
        )->execute([
            ':period_year' => (int) $periodYear,
            ':period_month' => (int) $periodMonth,
            ':is_locked' => $locked ? 1 : 0,
            ':lock_reason' => $reason,
            ':locked_by' => $user['email'],
            ':locked_at' => $locked ? nowIso() : null
        ]);

        sendJson(['ok' => true]);
    }

    if ($segment === 'contact' && $method === 'GET') {
        assertAuth($db, true);
        $rows = $db->query('SELECT id, name, email, subject, message, status, created_at FROM contact_messages ORDER BY created_at DESC')->fetchAll();
        sendJson(['rows' => $rows]);
    }

    sendJson(['error' => 'Not found'], 404);
} catch (Throwable $error) {
    sendJson(['error' => $error->getMessage()], 500);
}
