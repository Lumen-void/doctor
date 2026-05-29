<?php

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

$root = dirname(__DIR__);
$templateDir = $root . '/templates';
if (!is_dir($templateDir)) {
    mkdir($templateDir, 0777, true);
}

$referenceWorkbook = new Spreadsheet();

$serviceSheet = $referenceWorkbook->getActiveSheet();
$serviceSheet->setTitle('SERVICE PRICE LIST');
$serviceSheet->fromArray([
    ['Name', 'Unit Price', 'Unit Currency'],
    ['MRI BRAIN PLAIN', 9500, 'INR'],
    ['CT CHEST HRCT', 7200, 'INR'],
    ['USG ABDOMEN', 3600, 'INR']
], null, 'A1');

$discountSheet = $referenceWorkbook->createSheet();
$discountSheet->setTitle('S. DISCOUNT CALCULATION ');
$discountSheet->fromArray([
    ['Modalties', 'Name', 'MAXIMUM S. DISCOUNT PRICE', 'Group A', 'Group B', 'Group C', 'Exception'],
    ['MRI', 'MRI BRAIN PLAIN', 3000, 2500, 2200, 2000, 'Emergency case approval required'],
    ['CT', 'CT CHEST HRCT', 2500, 2100, 1800, 1600, ''],
    ['USG', 'USG ABDOMEN', 1200, 1000, 900, 800, '']
], null, 'A1');

$doctorSheet = $referenceWorkbook->createSheet();
$doctorSheet->setTitle('S. DISCOUNT DOCTOR GROUP 2');
$doctorSheet->fromArray([
    [
        'LOCATION', 'DR.NAME', 'DR. NAME CODE', 'HOSPITAL NAME', 'DEGREE', 'CONTACT NO',
        'OLD PRO', 'PRESENT PRO', 'PRO DATE CHANGE', 'HOSPITAL ADDRESS', 'AREA', 'LEAD SCORE',
        'LEAD STAGE', 'INCENTIVE GROUP', 'INCENTIVE CYCLE', 'CONVERSION INCENTIVE GROUP', 'TARGET INVESTIGATION',
        'REPORTING DOCTOR', 'CONFIRMATION STATUS', 'CONFIRMATION REMARKS'
    ],
    [
        'Noida', 'Dr Aarav Mehta', 'DR-A01', 'City Care Hospital', 'MD Radiology', '9999990001',
        'PRO-OLD', 'PRO-RIYA', '2025-07-01', 'Sector 62', 'Noida', 'A',
        'Converted', 'A', 'Monthly', 'A', 'MRI BRAIN PLAIN', 'Dr Senior Reviewer', 'confirmed', 'Verified and active'
    ],
    [
        'Delhi', 'Dr Naina Kapoor', 'DR-B01', 'Metro Imaging', 'DNB Radiology', '9999990002',
        'PRO-OLD', 'PRO-ARJUN', '2025-07-03', 'Lajpat Nagar', 'Delhi', 'B',
        'Active', 'B', 'Quarterly', 'B', 'CT CHEST HRCT', 'Dr Audit Lead', 'pending', 'Pending monthly confirmation'
    ]
], null, 'A1');

$referencePath = $templateDir . '/Special_Discount_Master_Template.xlsx';
$referenceWriter = new Xlsx($referenceWorkbook);
$referenceWriter->save($referencePath);
$referenceWorkbook->disconnectWorksheets();
unset($referenceWorkbook);

$softwareWorkbook = new Spreadsheet();
$softwareSheet = $softwareWorkbook->getActiveSheet();
$softwareSheet->setTitle('Requirements');
$softwareSheet->fromArray([
    ['Data Input:'],
    ['1. Upload dashboard transaction file by period'],
    ['2. Validate doctor and billable item mappings'],
    ['Engine & Payments:'],
    ['1. Run engine after reference master upload'],
    ['2. Review flags before generating payments'],
    ['Approvals:'],
    ['1. Admin should approve disbursal and overrides']
], null, 'A1');

$softwarePath = $templateDir . '/Software_Requirement_Template.xlsx';
$softwareWriter = new Xlsx($softwareWorkbook);
$softwareWriter->save($softwarePath);
$softwareWorkbook->disconnectWorksheets();
unset($softwareWorkbook);

echo "Created templates:\n";
echo $referencePath . "\n";
echo $softwarePath . "\n";
