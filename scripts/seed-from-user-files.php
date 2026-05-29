<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/api/lib.php';

$db = getDb();

$inputFiles = [
    'referenceMaster' => getenv('REFERENCE_MASTER') ?: '/Users/deepanshujain/Downloads/Special Discount Master.xlsx',
    'softwareRequirements' => getenv('SOFTWARE_REQUIREMENTS') ?: '/Users/deepanshujain/Downloads/Software requirement.xlsx',
    'dashboard' => getenv('DASHBOARD_FILE') ?: '/Users/deepanshujain/Downloads/Dashboard2025-07-16 17_55_45.xlsx',
    'incentive' => getenv('INCENTIVE_FILE') ?: '/Users/deepanshujain/Downloads/Incentive_check_ 1-8th July 2025.xlsx'
];

function fileExistsSafe(string $path): bool
{
    return is_file($path);
}

function seedReferenceMaster(PDO $db, string $filePath): void
{
    if (!fileExistsSafe($filePath)) {
        echo "Skip reference master (missing): {$filePath}" . PHP_EOL;
        return;
    }

    $parsed = parseReferenceWorkbook($filePath);

    $insertService = $db->prepare(
        'INSERT INTO service_prices (name, normalized_name, unit_price, currency, created_at)
         VALUES (:name, :normalized_name, :unit_price, :currency, :created_at)'
    );
    $insertRule = $db->prepare(
        'INSERT INTO discount_rules (item_name, normalized_item, modality, max_discount_price, group_json, exception_text, created_at)
         VALUES (:item_name, :normalized_item, :modality, :max_discount_price, :group_json, :exception_text, :created_at)'
    );
    $insertDoctor = $db->prepare(
        'INSERT INTO doctor_master
         (location, doctor_name, normalized_name, doctor_code, hospital_name, degree, contact_no,
          old_pro, present_pro, pro_change_date, hospital_address, area, lead_score, lead_stage,
          incentive_group, conversion_incentive_group, target_investigation, verified, created_at)
         VALUES (:location, :doctor_name, :normalized_name, :doctor_code, :hospital_name, :degree, :contact_no,
                 :old_pro, :present_pro, :pro_change_date, :hospital_address, :area, :lead_score, :lead_stage,
                 :incentive_group, :conversion_incentive_group, :target_investigation, :verified, :created_at)'
    );

    $db->beginTransaction();
    try {
        $db->prepare('DELETE FROM service_prices')->execute();
        $db->prepare('DELETE FROM discount_rules')->execute();
        $db->prepare('DELETE FROM doctor_master')->execute();

        foreach ($parsed['services'] as $service) {
            $insertService->execute([
                ':name' => $service['name'],
                ':normalized_name' => $service['normalizedName'],
                ':unit_price' => $service['unitPrice'],
                ':currency' => $service['currency'],
                ':created_at' => nowIso()
            ]);
        }

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
                ':conversion_incentive_group' => $doctor['conversionIncentiveGroup'],
                ':target_investigation' => $doctor['targetInvestigation'],
                ':verified' => $doctor['verified'] ? 1 : 0,
                ':created_at' => nowIso()
            ]);

            if (!empty($doctor['presentPro'])) {
                $db->prepare(
                    'INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
                     VALUES (:pro_name, 0, :updated_at)
                     ON CONFLICT(pro_name) DO NOTHING'
                )->execute([
                    ':pro_name' => trim((string) $doctor['presentPro']),
                    ':updated_at' => nowIso()
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
        echo 'Reference master seeded: services=' . count($parsed['services']) . ', rules=' . count($parsed['discountRules']) . ', doctors=' . count($parsed['doctors']) . PHP_EOL;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function seedSoftwareRequirements(PDO $db, string $filePath): void
{
    if (!fileExistsSafe($filePath)) {
        echo "Skip software requirements (missing): {$filePath}" . PHP_EOL;
        return;
    }

    $parsed = parseSoftwareRequirementsWorkbook($filePath);
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
        echo 'Software requirements seeded: ' . count($parsed['requirements']) . PHP_EOL;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function seedTransactions(PDO $db, array $files): void
{
    $insert = $db->prepare(
        'INSERT INTO transactions
         (source_file, source_type, visit_id, visit_date, patient_id, patient_name, sex, modality,
          visit_description, referring_doctor, normalized_doctor, pro_name, status, receipt_status,
          billable_items, total_price, total_discount, total_net, total_payment, balance_amount,
          notes, raw_json, created_at)
         VALUES (:source_file, :source_type, :visit_id, :visit_date, :patient_id, :patient_name, :sex, :modality,
                 :visit_description, :referring_doctor, :normalized_doctor, :pro_name, :status, :receipt_status,
                 :billable_items, :total_price, :total_discount, :total_net, :total_payment, :balance_amount,
                 :notes, :raw_json, :created_at)'
    );

    $totalInserted = 0;

    $db->beginTransaction();
    try {
        $db->prepare('DELETE FROM transactions')->execute();

        foreach ($files as $filePath) {
            if (!fileExistsSafe($filePath)) {
                echo 'Skip transactions (missing): ' . $filePath . PHP_EOL;
                continue;
            }

            $parsed = parseTransactionsWorkbook($filePath);
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
                    ':balance_amount' => $row['balanceAmount'],
                    ':notes' => $row['notes'],
                    ':raw_json' => $row['rawJson'],
                    ':created_at' => nowIso()
                ]);

                if (!empty($row['proName'])) {
                    $db->prepare(
                        'INSERT INTO pro_wallets (pro_name, cash_in_hand, updated_at)
                         VALUES (:pro_name, 0, :updated_at)
                         ON CONFLICT(pro_name) DO NOTHING'
                    )->execute([':pro_name' => trim((string) $row['proName']), ':updated_at' => nowIso()]);
                }

                $totalInserted += 1;
            }

            $db->prepare(
                'INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
                 VALUES (\'transaction_data\', :file_name, :row_count, :meta_json, :uploaded_at)'
            )->execute([
                ':file_name' => $parsed['fileName'],
                ':row_count' => count($parsed['transactions']),
                ':meta_json' => json_encode(['sourceType' => 'seed'], JSON_UNESCAPED_UNICODE),
                ':uploaded_at' => nowIso()
            ]);

            echo 'Transactions seeded from ' . basename($filePath) . ': ' . count($parsed['transactions']) . PHP_EOL;
        }

        $db->commit();
        echo 'Total transactions seeded: ' . $totalInserted . PHP_EOL;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

seedReferenceMaster($db, $inputFiles['referenceMaster']);
seedSoftwareRequirements($db, $inputFiles['softwareRequirements']);
seedTransactions($db, [$inputFiles['dashboard'], $inputFiles['incentive']]);

echo 'Seed completed' . PHP_EOL;
