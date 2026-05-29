const fs = require('fs');
const path = require('path');
const { db, nowIso } = require('../server/db');
const {
  parseReferenceWorkbook,
  parseSoftwareRequirementsWorkbook,
  parseTransactionsWorkbook
} = require('../server/excel');

const inputFiles = {
  referenceMaster:
    process.env.REFERENCE_MASTER ||
    '/Users/deepanshujain/Downloads/Special Discount Master.xlsx',
  softwareRequirements:
    process.env.SOFTWARE_REQUIREMENTS ||
    '/Users/deepanshujain/Downloads/Software requirement.xlsx',
  transactions: [
    process.env.DASHBOARD_FILE || '/Users/deepanshujain/Downloads/Dashboard2025-07-16 17_55_45.xlsx',
    process.env.INCENTIVE_FILE || '/Users/deepanshujain/Downloads/Incentive_check_ 1-8th July 2025.xlsx'
  ]
};

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (_error) {
    return false;
  }
}

function seedReferenceMaster(filePath) {
  if (!exists(filePath)) {
    // eslint-disable-next-line no-console
    console.log(`Skip reference master (missing): ${filePath}`);
    return;
  }

  const parsed = parseReferenceWorkbook(filePath);

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
      path.basename(filePath),
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

  // eslint-disable-next-line no-console
  console.log(
    `Reference master seeded: services=${parsed.services.length}, rules=${parsed.discountRules.length}, doctors=${parsed.doctors.length}`
  );
}

function seedSoftwareRequirements(filePath) {
  if (!exists(filePath)) {
    // eslint-disable-next-line no-console
    console.log(`Skip software requirements (missing): ${filePath}`);
    return;
  }

  const parsed = parseSoftwareRequirementsWorkbook(filePath);
  const insertReq = db.prepare(
    `INSERT INTO software_requirements (category, requirement_text, created_at)
     VALUES (?, ?, ?)`
  );

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM software_requirements').run();

    for (const row of parsed.requirements) {
      insertReq.run(row.category, row.requirementText, nowIso());
    }

    db.prepare(
      `INSERT INTO reference_uploads (type, file_name, row_count, meta_json, uploaded_at)
       VALUES ('software_requirements', ?, ?, ?, ?)`
    ).run(
      path.basename(filePath),
      parsed.requirements.length,
      JSON.stringify({ requirements: parsed.requirements.length }),
      nowIso()
    );
  });

  tx();
  // eslint-disable-next-line no-console
  console.log(`Software requirements seeded: ${parsed.requirements.length}`);
}

function seedTransactions(files) {
  const insert = db.prepare(
    `INSERT INTO transactions
      (source_file, source_type, visit_id, visit_date, patient_id, patient_name, sex, modality,
       visit_description, referring_doctor, normalized_doctor, pro_name, status, receipt_status,
       billable_items, total_price, total_discount, total_net, total_payment, balance_amount,
       notes, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let inserted = 0;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM transactions').run();

    for (const filePath of files) {
      if (!exists(filePath)) {
        // eslint-disable-next-line no-console
        console.log(`Skip transactions (missing): ${filePath}`);
        continue;
      }

      const parsed = parseTransactionsWorkbook(filePath);
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
        inserted += 1;

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
      ).run(path.basename(filePath), parsed.transactions.length, JSON.stringify({ source: 'seed' }), nowIso());

      // eslint-disable-next-line no-console
      console.log(`Transactions seeded from ${path.basename(filePath)}: ${parsed.transactions.length}`);
    }
  });

  tx();

  // eslint-disable-next-line no-console
  console.log(`Total transactions seeded: ${inserted}`);
}

seedReferenceMaster(inputFiles.referenceMaster);
seedSoftwareRequirements(inputFiles.softwareRequirements);
seedTransactions(inputFiles.transactions);

// eslint-disable-next-line no-console
console.log('Seed completed');
