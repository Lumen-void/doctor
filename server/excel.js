const path = require('path');
const XLSX = require('xlsx');

function normalizeText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: true, raw: true, dense: true });
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
}

function findHeaderRow(rows, requiredKeywords) {
  const required = requiredKeywords.map(normalizeText);
  const scanLimit = Math.min(rows.length, 60);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i] || [];
    const normalizedRow = row.map(normalizeText);
    const hasAll = required.every((keyword) =>
      normalizedRow.some((cell) => cell.includes(keyword))
    );
    if (hasAll) return i;
  }
  return -1;
}

function buildHeaderIndex(headers) {
  const map = new Map();
  headers.forEach((value, index) => {
    const normalized = normalizeText(value);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, index);
    }
  });
  return map;
}

function indexFor(headerIndex, candidates) {
  const normalizedCandidates = candidates.map(normalizeText);
  for (const candidate of normalizedCandidates) {
    if (headerIndex.has(candidate)) return headerIndex.get(candidate);
  }
  for (const [key, idx] of headerIndex.entries()) {
    if (normalizedCandidates.some((candidate) => key.includes(candidate))) {
      return idx;
    }
  }
  return -1;
}

function parseReferenceWorkbook(filePath) {
  const workbook = readWorkbook(filePath);

  const serviceRows = sheetRows(workbook, 'SERVICE PRICE LIST');
  const discountRows = sheetRows(workbook, 'S. DISCOUNT CALCULATION ');
  const doctorRows = sheetRows(workbook, 'S. DISCOUNT DOCTOR GROUP 2');

  const services = parseServicePrices(serviceRows);
  const discountRules = parseDiscountRules(discountRows);
  const doctors = parseDoctorMaster(doctorRows);

  return {
    fileName: path.basename(filePath),
    services,
    discountRules,
    doctors
  };
}

function parseServicePrices(rows) {
  const headerRow = findHeaderRow(rows, ['Name', 'Unit Price']);
  if (headerRow === -1) return [];
  const headers = rows[headerRow];
  const index = buildHeaderIndex(headers);
  const nameIndex = indexFor(index, ['Name']);
  const priceIndex = indexFor(index, ['Unit Price']);
  const currencyIndex = indexFor(index, ['Unit Currency']);

  const out = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r];
    const name = String(row[nameIndex] || '').trim();
    if (!name) continue;
    out.push({
      name,
      normalizedName: normalizeText(name),
      unitPrice: parseNumber(row[priceIndex]),
      currency: row[currencyIndex] ? String(row[currencyIndex]).trim() : null
    });
  }
  return out;
}

function parseDiscountRules(rows) {
  const headerRow = findHeaderRow(rows, ['Modalties', 'Name', 'MAXIMUM S. DISCOUNT PRICE']);
  if (headerRow === -1) return [];

  const headers = rows[headerRow] || [];
  const index = buildHeaderIndex(headers);
  const modalityIndex = indexFor(index, ['Modalties']);
  const nameIndex = indexFor(index, ['Name']);
  const maxDiscountIndex = indexFor(index, ['MAXIMUM S. DISCOUNT PRICE']);
  const exceptionIndex = indexFor(index, ['Exception']);

  const groupColumns = [];
  headers.forEach((header, idx) => {
    const h = normalizeText(header);
    if (!h.includes('GROUP')) return;

    let group = null;
    const match = h.match(/GROUP\s*([A-Z]+)/);
    if (match && match[1]) group = match[1];
    if (!group && h.includes('NEL')) group = 'NEL';
    if (!group && h.endsWith('G')) group = 'G';

    if (group) {
      groupColumns.push({ idx, code: group });
    }
  });

  const dedup = new Map();
  for (const col of groupColumns) {
    if (!dedup.has(col.code)) {
      dedup.set(col.code, col.idx);
    }
  }

  const out = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const itemName = String(row[nameIndex] || '').trim();
    if (!itemName) continue;

    const groupValues = {};
    for (const [groupCode, idx] of dedup.entries()) {
      const value = parseNumber(row[idx]);
      if (value !== null) groupValues[groupCode] = value;
    }

    if (Object.keys(groupValues).length === 0 && parseNumber(row[maxDiscountIndex]) === null) {
      continue;
    }

    out.push({
      itemName,
      normalizedItem: normalizeText(itemName),
      modality: row[modalityIndex] ? String(row[modalityIndex]).trim() : null,
      maxDiscountPrice: parseNumber(row[maxDiscountIndex]),
      groupValues,
      exceptionText: row[exceptionIndex] ? String(row[exceptionIndex]).trim() : null
    });
  }

  return out;
}

function parseDoctorMaster(rows) {
  const headerRow = findHeaderRow(rows, ['DR.NAME', 'INCENTIVE GROUP']);
  if (headerRow === -1) return [];

  const headers = rows[headerRow] || [];
  const index = buildHeaderIndex(headers);

  const fieldIndexes = {
    location: indexFor(index, ['LOCATION']),
    doctorName: indexFor(index, ['DR.NAME']),
    doctorCode: indexFor(index, ['DR. NAME CODE', 'DR NAME CODE']),
    hospitalName: indexFor(index, ['HOSPITAL NAME']),
    degree: indexFor(index, ['DEGREE']),
    contactNo: indexFor(index, ['CONTACT NO']),
    oldPro: indexFor(index, ['OLD PRO']),
    presentPro: indexFor(index, ['PRESENT PRO']),
    proDateChange: indexFor(index, ['PRO DATE CHANGE']),
    hospitalAddress: indexFor(index, ['HOSPITAL ADDRESS']),
    area: indexFor(index, ['AREA']),
    leadScore: indexFor(index, ['LEAD SCORE']),
    leadStage: indexFor(index, ['LEAD STAGE']),
    incentiveGroup: indexFor(index, ['INCENTIVE GROUP']),
    conversionIncentiveGroup: indexFor(index, ['CONVERSION INCENTIVE GROUP']),
    targetInvestigation: indexFor(index, ['TARGET INVESTIGATION'])
  };

  const out = [];
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const doctorName = String(row[fieldIndexes.doctorName] || '').trim();
    if (!doctorName) continue;

    const incentiveGroupRaw = row[fieldIndexes.incentiveGroup];
    const incentiveGroup = incentiveGroupRaw ? String(incentiveGroupRaw).trim().toUpperCase() : null;

    out.push({
      location: row[fieldIndexes.location] ? String(row[fieldIndexes.location]).trim() : null,
      doctorName,
      normalizedName: normalizeText(doctorName),
      doctorCode: row[fieldIndexes.doctorCode] ? String(row[fieldIndexes.doctorCode]).trim() : null,
      hospitalName: row[fieldIndexes.hospitalName] ? String(row[fieldIndexes.hospitalName]).trim() : null,
      degree: row[fieldIndexes.degree] ? String(row[fieldIndexes.degree]).trim() : null,
      contactNo: row[fieldIndexes.contactNo] ? String(row[fieldIndexes.contactNo]).trim() : null,
      oldPro: row[fieldIndexes.oldPro] ? String(row[fieldIndexes.oldPro]).trim() : null,
      presentPro: row[fieldIndexes.presentPro] ? String(row[fieldIndexes.presentPro]).trim() : null,
      proDateChange: parseDate(row[fieldIndexes.proDateChange]),
      hospitalAddress: row[fieldIndexes.hospitalAddress] ? String(row[fieldIndexes.hospitalAddress]).trim() : null,
      area: row[fieldIndexes.area] ? String(row[fieldIndexes.area]).trim() : null,
      leadScore: row[fieldIndexes.leadScore] ? String(row[fieldIndexes.leadScore]).trim() : null,
      leadStage: row[fieldIndexes.leadStage] ? String(row[fieldIndexes.leadStage]).trim() : null,
      incentiveGroup,
      conversionIncentiveGroup: row[fieldIndexes.conversionIncentiveGroup]
        ? String(row[fieldIndexes.conversionIncentiveGroup]).trim()
        : null,
      targetInvestigation: row[fieldIndexes.targetInvestigation]
        ? String(row[fieldIndexes.targetInvestigation]).trim()
        : null,
      verified: false
    });
  }

  return out;
}

function parseSoftwareRequirementsWorkbook(filePath) {
  const workbook = readWorkbook(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = sheetRows(workbook, sheetName);
  const out = [];

  let category = 'General';
  for (const row of rows) {
    const value = (row || []).find((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!value) continue;

    const text = String(value).trim();
    if (text.endsWith(':')) {
      category = text.replace(/:$/, '').trim();
      continue;
    }

    const cleaned = text.replace(/^\d+\.?\s*/, '').trim();
    if (!cleaned) continue;

    out.push({ category, requirementText: cleaned });
  }

  return {
    fileName: path.basename(filePath),
    requirements: out
  };
}

function parseTransactionsWorkbook(filePath) {
  const workbook = readWorkbook(filePath);
  const allRows = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook, sheetName);
    if (!rows.length) continue;

    const headerRow = findHeaderRow(rows, ['Patient ID', 'Referring Doctor']);
    if (headerRow === -1) continue;

    const headers = rows[headerRow] || [];
    const headerIndex = buildHeaderIndex(headers);

    const fields = {
      visitId: indexFor(headerIndex, ['Visit ID', 'srno', 'Srno', 'SRNO']),
      visitDate: indexFor(headerIndex, ['Visit Date Time', 'Date', 'Last Receipt Date Time']),
      patientId: indexFor(headerIndex, ['Patient ID']),
      patientName: indexFor(headerIndex, ['Patient Name']),
      sex: indexFor(headerIndex, ['Sex']),
      modality: indexFor(headerIndex, ['Modalities', 'Procedure']),
      visitDescription: indexFor(headerIndex, ['Visit Description']),
      referringDoctor: indexFor(headerIndex, ['Referring Doctor']),
      proName: indexFor(headerIndex, ['PRO Name']),
      status: indexFor(headerIndex, ['Visit Status', 'Status']),
      receiptStatus: indexFor(headerIndex, ['Receipt Status', 'Status']),
      billableItems: indexFor(headerIndex, ['Billable Items', 'Items', 'Procedure', 'Visit Description']),
      totalPrice: indexFor(headerIndex, ['Total Price', 'Price']),
      totalDiscount: indexFor(headerIndex, ['Total Discount Amount', 'Dis']),
      totalNet: indexFor(headerIndex, ['Total Net Price', 'Net']),
      totalPayment: indexFor(headerIndex, ['Total Payment Received', 'Rece']),
      balanceAmount: indexFor(headerIndex, ['Balance Amount']),
      notes: indexFor(headerIndex, ['Notes', 'S. Dis Remark'])
    };

    const sourceType = fields.totalPrice !== -1 && fields.billableItems !== -1 ? 'dashboard' : 'incentive_line';

    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const patientId = fields.patientId !== -1 ? row[fields.patientId] : null;
      const patientName = fields.patientName !== -1 ? row[fields.patientName] : null;
      const referringDoctor = fields.referringDoctor !== -1 ? row[fields.referringDoctor] : null;

      if (![patientId, patientName, referringDoctor].some((x) => x !== null && x !== undefined && String(x).trim() !== '')) {
        continue;
      }

      const itemValue = fields.billableItems !== -1 ? row[fields.billableItems] : null;
      const rowData = {
        sourceFile: path.basename(filePath),
        sourceType,
        visitId: fields.visitId !== -1 && row[fields.visitId] !== null ? String(row[fields.visitId]).trim() : null,
        visitDate: fields.visitDate !== -1 ? parseDate(row[fields.visitDate]) : null,
        patientId: patientId !== null && patientId !== undefined ? String(patientId).trim() : null,
        patientName: patientName !== null && patientName !== undefined ? String(patientName).trim() : null,
        sex: fields.sex !== -1 && row[fields.sex] ? String(row[fields.sex]).trim() : null,
        modality: fields.modality !== -1 && row[fields.modality] ? String(row[fields.modality]).trim() : null,
        visitDescription:
          fields.visitDescription !== -1 && row[fields.visitDescription]
            ? String(row[fields.visitDescription]).trim()
            : null,
        referringDoctor: referringDoctor !== null && referringDoctor !== undefined ? String(referringDoctor).trim() : null,
        normalizedDoctor: normalizeText(referringDoctor),
        proName: fields.proName !== -1 && row[fields.proName] ? String(row[fields.proName]).trim() : null,
        status: fields.status !== -1 && row[fields.status] ? String(row[fields.status]).trim() : null,
        receiptStatus: fields.receiptStatus !== -1 && row[fields.receiptStatus] ? String(row[fields.receiptStatus]).trim() : null,
        billableItems: itemValue !== null && itemValue !== undefined ? String(itemValue).trim() : null,
        totalPrice: fields.totalPrice !== -1 ? parseNumber(row[fields.totalPrice]) : null,
        totalDiscount: fields.totalDiscount !== -1 ? parseNumber(row[fields.totalDiscount]) : null,
        totalNet: fields.totalNet !== -1 ? parseNumber(row[fields.totalNet]) : null,
        totalPayment: fields.totalPayment !== -1 ? parseNumber(row[fields.totalPayment]) : null,
        balanceAmount: fields.balanceAmount !== -1 ? parseNumber(row[fields.balanceAmount]) : null,
        notes: fields.notes !== -1 && row[fields.notes] ? String(row[fields.notes]).trim() : null,
        rawJson: JSON.stringify(
          Object.fromEntries(headers.map((header, idx) => [String(header || `col_${idx + 1}`), row[idx] ?? null]))
        )
      };

      if (!rowData.billableItems && rowData.visitDescription) {
        rowData.billableItems = rowData.visitDescription;
      }

      allRows.push(rowData);
    }
  }

  return {
    fileName: path.basename(filePath),
    transactions: allRows
  };
}

module.exports = {
  normalizeText,
  parseNumber,
  parseDate,
  parseReferenceWorkbook,
  parseSoftwareRequirementsWorkbook,
  parseTransactionsWorkbook
};
