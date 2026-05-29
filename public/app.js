const appEl = document.getElementById('app');

function detectAppBase() {
  const path = window.location.pathname || '/';
  if (path === '/') return '';
  if (path.includes('/public/')) return path.split('/public/')[0] || '';
  if (path.endsWith('/public')) return path.slice(0, -7);
  if (path.endsWith('/index.php')) return path.slice(0, -10);
  return path.replace(/\/+$/, '');
}

const APP_BASE = detectAppBase();

function withAppBase(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE}${normalized}`;
}

function resolveApiCandidates(path) {
  const rooted = withAppBase(path);
  const marker = '/api/';
  const idx = rooted.indexOf(marker);
  if (idx === -1) {
    return [rooted];
  }

  const prefix = rooted.slice(0, idx);
  const rest = rooted.slice(idx + marker.length);
  const qIdx = rest.indexOf('?');
  const route = qIdx === -1 ? rest : rest.slice(0, qIdx);
  const query = qIdx === -1 ? '' : rest.slice(qIdx + 1);
  const safeRoute = encodeURIComponent(route.replace(/^\/+|\/+$/g, ''));
  const fallback = `${prefix}/api/index.php?route=${safeRoute}${query ? `&${query}` : ''}`;

  return [rooted, fallback];
}

const now = new Date();
const state = {
  token: localStorage.getItem('rrcp_token') || null,
  user: JSON.parse(localStorage.getItem('rrcp_user') || 'null'),
  page: 'overview',
  sidebarOpen: false,
  periodYear: now.getFullYear(),
  periodMonth: now.getMonth() + 1,
  selectedRunId: null,
  flaggedOnly: false,
  doctorSearch: '',
  dataSearch: '',
  dataPage: 1,
  dataPageSize: 50,
  tableSearch: {
    users: '',
    requirements: '',
    engineResults: '',
    productivity: '',
    payments: '',
    approvals: '',
    contact: '',
    locks: ''
  },
  engineResultFilters: {
    doctor: '',
    group: '',
    pro: '',
    item: '',
    variance: 'all',
    remark: ''
  },
  approvalStatusFilter: 'pending'
};

const menuItems = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'setup-center', label: 'Setup Center', icon: 'table' },
  { id: 'monthly-intake', label: 'Monthly Intake', icon: 'upload' },
  { id: 'calculation-review', label: 'Calculation Review', icon: 'engine' },
  { id: 'payout-center', label: 'Payout Center', icon: 'wallet' },
  { id: 'reports', label: 'Reports', icon: 'reports' },
  { id: 'support', label: 'Support', icon: 'mail' }
];

const LEGACY_PAGE_MAP = {
  dashboard: 'overview',
  'user-maintenance': 'setup-center',
  'reference-tables': 'setup-center',
  'data-input': 'monthly-intake',
  'rrcp-engine': 'calculation-review',
  'payment-management': 'payout-center',
  approvals: 'payout-center',
  'contact-us': 'support'
};

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(name, size = 18, title = '') {
  const iconTitle = escapeHtml(title || name);
  const attrs = `class="ui-icon ui-icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  if (name === 'dashboard') {
    return `<svg ${attrs}><title>${iconTitle}</title><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>`;
  }

  if (name === 'users') {
    return `<svg ${attrs}><title>${iconTitle}</title><circle cx="12" cy="8" r="4" /><path d="M4 20v-1a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v1" /><path d="M17 11a3 3 0 0 1 3 3v3" /><path d="M7 11a3 3 0 0 0-3 3v3" /></svg>`;
  }

  if (name === 'upload') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M12 17h.01" /></svg>`;
  }

  if (name === 'table') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M3 4h18v3H3z" /><path d="M3 10h18" /><path d="M3 16h18" /><path d="M9 4v16" /><path d="M15 4v16" /></svg>`;
  }

  if (name === 'engine') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M4 7h16" /><path d="M4 17h16" /><circle cx="12" cy="12" r="3" /><path d="M12 3v3" /><path d="M12 18v3" /><path d="m18 12 3 3" /><path d="m3 12 3 3" /><path d="m18 12-3 3" /><path d="m6 15 3-3-3-3" /></svg>`;
  }

  if (name === 'wallet') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M21 12V7H6.5C4.57 7 3 8.57 3 10.5v3C3 15.43 4.57 17 6.5 17H21v-5" /><path d="M21 12h-9" /><path d="M16 10h.01" /><path d="M16 14h.01" /></svg>`;
  }

  if (name === 'reports') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M3 3h18v18H3z" /><path d="m3 9 18-6" /><path d="M9 21V9" /><path d="M15 21V9" /></svg>`;
  }

  if (name === 'approval') {
    return `<svg ${attrs}><title>${iconTitle}</title><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></svg>`;
  }

  if (name === 'lock') {
    return `<svg ${attrs}><title>${iconTitle}</title><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>`;
  }

  if (name === 'mail') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M4 4h16v16H4z" /><path d="M4 6.5 12 12 20 6.5" /></svg>`;
  }


  if (name === 'trend') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M3 17l4-4 4 4 5-5 5 5" /><circle cx="5" cy="13" r="1.4" /><circle cx="9" cy="17" r="1.4" /><circle cx="14" cy="12" r="1.4" /><circle cx="19" cy="17" r="1.4" /></svg>`;
  }

  if (name === 'chart') {
    return `<svg ${attrs}><title>${iconTitle}</title><path d="M4 19h16" /><path d="M4 5v14" /><path d="m7 15 4-4 4 2 5-6" /></svg>`;
  }

  return `<span class="ui-icon-fallback" aria-hidden="true" aria-label="${iconTitle}">◯</span>`;
}

function formatCurrency(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(n);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-IN').format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function formatDateTimeParts(value) {
  if (!value) {
    return { date: '-', time: '' };
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return { date: '-', time: '' };
  }

  return {
    date: d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }),
    time: d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit'
    })
  };
}

function formatCurrencyOrDash(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return formatCurrency(value);
}

function formatEngineItemModality(row) {
  const modality = String(row?.modality || '').trim();
  const rawItemList = row?.item_list;
  let itemText = '';

  if (Array.isArray(rawItemList)) {
    itemText = rawItemList
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(', ');
  } else if (typeof rawItemList === 'string') {
    const trimmed = rawItemList.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        itemText = Array.isArray(parsed)
          ? parsed.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
          : trimmed;
      } catch (_error) {
        itemText = trimmed;
      }
    }
  }

  if (itemText && modality && itemText.toLowerCase() !== modality.toLowerCase()) {
    return `${itemText} / ${modality}`;
  }

  return itemText || modality || '-';
}

function formatDateTimeInputValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDelayBetween(startValue, endValue) {
  if (!startValue || !endValue) {
    return '-';
  }

  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '-';
  }

  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

function computePaymentFinalAmount(row) {
  const base = Number(row.amount || 0);
  const adjustment = Number(row.adjustment_amount || 0);
  const advance = Number(row.advance_payment || 0);
  const returned = Number(row.return_incentive_amount || 0);
  return base + adjustment - advance - returned;
}

function doctorOptionLabel(doctor) {
  const name = String(doctor?.doctor_name || doctor?.doctorName || '').trim();
  const code = String(doctor?.doctor_code || doctor?.doctorCode || '').trim();
  if (!name) return code || 'Doctor';
  return code ? `${name} (${code})` : name;
}

function confirmationTone(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'confirmed') return 'good';
  if (normalized === 'not_confirmed') return 'bad';
  return 'warn';
}

function confirmationBadge(status) {
  const normalized = String(status || 'pending')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return badge(toReadableLabel(normalized || 'pending'), confirmationTone(normalized));
}

function getTableSearch(key) {
  return String(state.tableSearch?.[key] || '');
}

function setTableSearch(key, value) {
  state.tableSearch = {
    ...(state.tableSearch || {}),
    [key]: String(value || '').trim()
  };
}

function searchTextFromValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map((item) => searchTextFromValue(item)).join(' ');
  }

  if (typeof value === 'object') {
    return Object.values(value)
      .map((item) => searchTextFromValue(item))
      .join(' ');
  }

  return String(value);
}

function filterRowsBySearch(rows, searchTerm, extraResolver = null) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const needle = String(searchTerm || '').trim().toLowerCase();
  if (!needle) {
    return rows;
  }

  return rows.filter((row) => {
    const baseText = searchTextFromValue(row);
    const extraText = typeof extraResolver === 'function' ? searchTextFromValue(extraResolver(row)) : '';
    return `${baseText} ${extraText}`.toLowerCase().includes(needle);
  });
}

function varianceBucket(value) {
  const n = Number(value || 0);
  if (n > 0.01) return 'positive';
  if (n < -0.01) return 'negative';
  return 'zero';
}

function filterEngineRows(rows, filters) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const doctorNeedle = String(filters?.doctor || '').trim().toLowerCase();
  const groupNeedle = String(filters?.group || '').trim().toLowerCase();
  const proNeedle = String(filters?.pro || '').trim().toLowerCase();
  const itemNeedle = String(filters?.item || '').trim().toLowerCase();
  const remarkNeedle = String(filters?.remark || '').trim().toLowerCase();
  const varianceNeedle = String(filters?.variance || 'all').trim().toLowerCase();

  return rows.filter((row) => {
    if (doctorNeedle && !String(row.doctor_name || '').toLowerCase().includes(doctorNeedle)) {
      return false;
    }

    if (groupNeedle && String(row.doctor_group || '').trim().toLowerCase() !== groupNeedle) {
      return false;
    }

    if (proNeedle && String(row.pro_name || '').trim().toLowerCase() !== proNeedle) {
      return false;
    }

    if (itemNeedle && !String(formatEngineItemModality(row) || '').toLowerCase().includes(itemNeedle)) {
      return false;
    }

    if (remarkNeedle && !String(row.remark || '').toLowerCase().includes(remarkNeedle)) {
      return false;
    }

    if (varianceNeedle !== 'all' && varianceBucket(row.variance) !== varianceNeedle) {
      return false;
    }

    return true;
  });
}

function toReadableLabel(value) {
  const cleaned = String(value ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatPayloadValue(label, value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    const lower = label.toLowerCase();
    if (/(amount|discount|net|price|payable|cash)/.test(lower)) {
      return formatCurrency(value);
    }
    return Number.isInteger(value) ? formatNumber(value) : String(value);
  }

  return String(value);
}

function flattenPayloadEntries(value, label = '') {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ label: label || 'Value', value: '-' }];
    }
    return value.flatMap((item, index) =>
      flattenPayloadEntries(item, label ? `${label} item ${index + 1}` : `Item ${index + 1}`)
    );
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
      const nextLabel = label ? `${label} ${toReadableLabel(key)}` : toReadableLabel(key);
      return flattenPayloadEntries(nestedValue, nextLabel);
    });
  }

  return [{ label: label || 'Value', value: formatPayloadValue(label, value) }];
}

function renderReadablePayload(payloadJson) {
  if (!payloadJson) {
    return '<span class="helper">No details shared</span>';
  }

  let parsed;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (_error) {
    const cleaned = String(payloadJson)
      .replace(/[{}[\]",]/g, ' ')
      .replace(/:/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `<span class="helper">${escapeHtml(cleaned || 'Details available')}</span>`;
  }

  const rows = flattenPayloadEntries(parsed).slice(0, 8);
  if (!rows.length) {
    return '<span class="helper">No details shared</span>';
  }

  return `
    <ul class="payload-list">
      ${rows
        .map((row) => `<li><span class="payload-key">${escapeHtml(row.label)}</span><span>${escapeHtml(row.value)}</span></li>`)
        .join('')}
    </ul>
  `;
}

function pageTitle(label, iconName) {
  return `<h2 class="with-title-icon">${icon(iconName, 18, label)}${escapeHtml(label)}</h2>`;
}

function renderPageHero(title, iconName, description, controlsHtml = '') {
  return `
    <section class="page-hero">
      <div class="page-hero-copy">
        <p class="page-eyebrow">Referral Revenue Workflow</p>
        ${pageTitle(title, iconName)}
        <p class="page-description">${escapeHtml(description)}</p>
      </div>
      ${
        controlsHtml
          ? `<div class="page-hero-actions"><div class="toolbar toolbar-elevated">${controlsHtml}</div></div>`
          : ''
      }
    </section>
  `;
}

function getMenuItemById(pageId) {
  return menuItems.find((item) => item.id === pageId) || null;
}

function currentPeriodLabel() {
  const monthLabel = monthNames[state.periodMonth - 1] || 'Current Month';
  return `${monthLabel} ${state.periodYear}`;
}

function renderField(label, inputMarkup, hint = '') {
  return `
    <label class="form-field">
      <span class="field-label">${escapeHtml(label)}</span>
      ${inputMarkup}
      ${hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : ''}
    </label>
  `;
}

function renderSidebarStatusCard(currentMenuLabel) {
  return `
    <section class="sidebar-status-card">
      <p class="sidebar-status-kicker">Workspace Status</p>
      <div class="sidebar-status-grid">
        <div>
          <span class="sidebar-status-label">Current page</span>
          <strong>${escapeHtml(currentMenuLabel)}</strong>
        </div>
        <div>
          <span class="sidebar-status-label">Role</span>
          <strong>${escapeHtml(toReadableLabel(state.user?.role || 'User'))}</strong>
        </div>
        <div>
          <span class="sidebar-status-label">Period</span>
          <strong>${escapeHtml(currentPeriodLabel())}</strong>
        </div>
        ${
          state.user?.doctorName
            ? `<div>
                <span class="sidebar-status-label">Doctor</span>
                <strong>${escapeHtml(state.user.doctorName)}</strong>
              </div>`
            : ''
        }
      </div>
    </section>
  `;
}

function renderDashboardGuide() {
  const role = String(state.user?.role || '').toLowerCase();
  const doctorName = state.user?.doctorName ? escapeHtml(state.user.doctorName) : 'your linked doctor profile';

  if (role === 'admin') {
    return `
      <h3 class="with-title-icon" style="margin-top:0;">${icon('lock', 18, 'Quick Start')}Quick Start (Admin)</h3>
      <ol style="margin:0;padding-left:18px;display:grid;gap:6px;">
        <li>Complete masters and team setup in <strong>Setup Center</strong>.</li>
        <li>Upload monthly files in <strong>Monthly Intake</strong>.</li>
        <li>Run and review outputs in <strong>Calculation Review</strong>.</li>
        <li>Manage payouts, approvals, and lock control in <strong>Payout Center</strong>.</li>
      </ol>
    `;
  }

  if (role === 'mapper') {
    return `
      <h3 class="with-title-icon" style="margin-top:0;">${icon('upload', 18, 'Quick Start')}Quick Start (Data Mapper)</h3>
      <ol style="margin:0;padding-left:18px;display:grid;gap:6px;">
        <li>Keep masters current in <strong>Setup Center</strong>.</li>
        <li>Upload monthly transaction files in <strong>Monthly Intake</strong>.</li>
        <li>Validate parsed rows, doctor names, and billable items.</li>
        <li>Use <strong>Reports</strong> to cross-check imported output.</li>
      </ol>
    `;
  }

  if (role === 'accountant') {
    return `
      <h3 class="with-title-icon" style="margin-top:0;">${icon('wallet', 18, 'Quick Start')}Quick Start (Accountant)</h3>
      <ol style="margin:0;padding-left:18px;display:grid;gap:6px;">
        <li>Review engine flags in <strong>Calculation Review</strong>.</li>
        <li>Track payment status and approvals in <strong>Payout Center</strong>.</li>
        <li>Use reports for period reconciliation and payout evidence.</li>
      </ol>
    `;
  }

  if (role === 'doctor') {
    return `
      <h3 class="with-title-icon" style="margin-top:0;">${icon('users', 18, 'Quick Start')}Quick Start (Doctor)</h3>
      <p class="helper" style="margin-top:0;">Account linked to ${doctorName}.</p>
      <ol style="margin:0;padding-left:18px;display:grid;gap:6px;">
        <li>Upload only your own records in <strong>Monthly Intake</strong>.</li>
        <li>Review your entries and monthly totals.</li>
        <li>Track your payout status in <strong>Payout Center</strong>.</li>
        <li>Download your individual report in <strong>Reports</strong>.</li>
      </ol>
    `;
  }

  return `
    <h3 class="with-title-icon" style="margin-top:0;">${icon('chart', 18, 'Quick Start')}Quick Start</h3>
    <p class="helper" style="margin:0;">Use the left menu based on your role. Overview shows the current month status and next actions.</p>
  `;
}

function renderPageGuide(title, iconName, steps, note = '') {
  const stepRows = Array.isArray(steps)
    ? steps
        .filter((step) => typeof step === 'string' && step.trim() !== '')
        .map((step) => `<span class="guide-step-pill">${escapeHtml(step)}</span>`)
        .join('')
    : '';

  return `
    <section class="panel panel-accent guide-panel">
      <div class="guide-strip">
        <div class="guide-strip-head">
          <p class="guide-kicker">Quick Help</p>
          <h3 class="with-title-icon guide-title">${icon(iconName, 18, title)}${escapeHtml(title)}</h3>
          <p class="helper guide-note">${escapeHtml(note || 'Follow these steps to complete the page.')}</p>
        </div>
        ${stepRows ? `<div class="guide-step-pills">${stepRows}</div>` : ''}
      </div>
    </section>
  `;
}

function renderNoRows(colspan, message = 'No records found.') {
  return `<tr><td colspan="${Math.max(1, Number(colspan) || 1)}" class="table-empty">${escapeHtml(message)}</td></tr>`;
}

function canAccessPage(pageId) {
  return getMenuItemsForUser().some((item) => item.id === pageId);
}

function renderDashboardWorkflow(data) {
  const role = String(state.user?.role || '').toLowerCase();
  const isDoctorRole = role === 'doctor';

  const referenceReady =
    Number(data?.referenceSummary?.services || 0) > 0 &&
    Number(data?.referenceSummary?.discountRules || 0) > 0 &&
    Number(data?.referenceSummary?.doctors || 0) > 0;

  const rowsUploaded = Number(data?.totals?.total_cases || 0) > 0;
  const engineDone = !!data?.latestRun;
  const pendingPaymentCount = Number(data?.pendingPayments?.count || 0);
  const paymentReady = pendingPaymentCount === 0;

  const steps = isDoctorRole
    ? [
        {
          label: 'Doctor profile linked',
          detail: state.user?.doctorName
            ? `Linked to ${state.user.doctorName}.`
            : 'Ask admin to link your account to a doctor profile.',
          done: !!state.user?.doctorName,
          action: 'support'
        },
        {
          label: 'Upload your monthly data',
          detail: 'Add current month transactions from Monthly Intake.',
          done: rowsUploaded,
          action: 'monthly-intake'
        },
        {
          label: 'Check your payout status',
          detail: 'Review payment status after engine run and approvals.',
          done: engineDone,
          action: 'payout-center'
        },
        {
          label: 'Download your report',
          detail: 'Export your individual monthly report.',
          done: false,
          action: 'reports'
        }
      ]
    : [
        {
          label: 'Setup and master readiness',
          detail: 'Load service prices, discount rules, doctor mapping, and team access.',
          done: referenceReady,
          action: 'setup-center'
        },
        {
          label: 'Monthly transaction upload',
          detail: 'Import dashboard/incentive rows for selected period.',
          done: rowsUploaded,
          action: 'monthly-intake'
        },
        {
          label: 'Run monthly calculation',
          detail: 'Create a run and review flagged rows before payout.',
          done: engineDone,
          action: 'calculation-review'
        },
        {
          label: 'Payouts and approvals',
          detail: 'Process pending payment approvals and finalize payouts.',
          done: paymentReady,
          action: 'payout-center'
        }
      ];

  const visibleSteps = steps.filter((step) => canAccessPage(step.action));
  const completedCount = visibleSteps.filter((step) => step.done).length;
  const totalCount = visibleSteps.length || 1;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  const stepRows = visibleSteps
    .map(
      (step, idx) => `
        <li class="workflow-step">
          <div>
            <strong>Step ${idx + 1}: ${escapeHtml(step.label)}</strong>
            <p class="helper workflow-detail">${escapeHtml(step.detail)}</p>
          </div>
          <div class="workflow-meta">
            ${step.done ? badge('Done', 'good') : badge('Pending', 'warn')}
            <button class="btn btn-outline" data-workflow-go="${step.action}" type="button">Open</button>
          </div>
        </li>
      `
    )
    .join('');

  return `
    <section class="panel panel-accent workflow-panel">
      <div class="workflow-head">
        <div>
          <h3 class="with-title-icon" style="margin-top:0;">${icon('approval', 18, 'Workflow Tracker')}Monthly Workflow Tracker</h3>
          <p class="helper">Follow this order every month for accurate outputs and faster approvals.</p>
        </div>
        <div class="workflow-progress-card">
          <span class="workflow-progress-label">${escapeHtml(currentPeriodLabel())}</span>
          <strong>${formatNumber(completedCount)}/${formatNumber(totalCount)} steps complete</strong>
          <div class="workflow-progress-bar"><span style="width:${Math.min(100, Math.max(0, progressPct))}%;"></span></div>
        </div>
      </div>
      <ol class="workflow-list">${stepRows || '<li class="workflow-step"><span class="helper">No steps available for this role.</span></li>'}</ol>
    </section>
  `;
}

function showPageError(container, error) {
  if (!container || !container.isConnected || !state.token) {
    return;
  }
  container.innerHTML = `<div class="panel">${escapeHtml(error?.message || 'Request failed')}</div>`;
}

function notify(message, isError = false) {
  const prev = document.querySelector('#toast');
  if (prev) prev.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '16px';
  toast.style.right = '16px';
  toast.style.zIndex = '999';
  toast.style.maxWidth = '420px';
  toast.style.padding = '12px 14px';
  toast.style.borderRadius = '10px';
  toast.style.color = '#fff';
  toast.style.fontWeight = '700';
  toast.style.background = isError ? '#c73939' : '#1f334f';
  toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2800);
}

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    localStorage.setItem('rrcp_token', token);
    localStorage.setItem('rrcp_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('rrcp_token');
    localStorage.removeItem('rrcp_user');
  }
}

async function api(path, options = {}) {
  const opts = { ...options };
  opts.headers = { ...(options.headers || {}) };

  if (!(opts.body instanceof FormData) && opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }

  if (state.token) {
    opts.headers.Authorization = `Bearer ${state.token}`;
  }

  const candidates = resolveApiCandidates(path);
  let response = null;
  let lastError = null;
  let lastStatus = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      const candidateResponse = await fetch(candidate, opts);
      const candidateType = (candidateResponse.headers.get('content-type') || '').toLowerCase();
      if (candidateResponse.ok && (candidateType.includes('application/json') || candidateType.includes('text/csv'))) {
        response = candidateResponse;
        break;
      }

      lastStatus = candidateResponse.status;
      lastError = candidateResponse;
      if (response === null && candidateResponse.ok) {
        response = candidateResponse;
      }
      if (candidateResponse.ok && i < candidates.length - 1) {
        continue;
      }
      if (candidateResponse.status !== 404 && candidateResponse.status < 500) {
        break;
      }
    } catch (error) {
      lastError = error;
      lastStatus = 0;
      continue;
    }
  }

  if (!response) {
    if (lastError instanceof Response) {
      if (lastStatus === 401) {
        setAuth(null, null);
        render();
      }
      throw new Error(`Request failed (${lastStatus})`);
    }

    throw new Error('Request failed');
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) message = errorBody.error;
    } catch (_error) {
      // ignore
    }

    if (response.status === 401) {
      setAuth(null, null);
      render();
    }

    throw new Error(message);
  }

  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch (_error) {
      throw new Error('Request failed (invalid JSON)');
    }
  }

  if (contentType.includes('text/csv')) {
    return new Blob([rawText], { type: 'text/csv;charset=utf-8' });
  }

  if (response.status === 204 || rawText === '') {
    return null;
  }

  // Some servers return JSON payload with incorrect MIME type. Accept that.
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    // no JSON available
  }

  throw new Error(`Request did not return JSON/CSV payload (received ${contentType || 'unknown'})`);
}

function yearOptions() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current - 2; y <= current + 1; y += 1) {
    years.push(`<option value="${y}" ${y === state.periodYear ? 'selected' : ''}>${y}</option>`);
  }
  return years.join('');
}

function monthOptions() {
  return monthNames
    .map((m, idx) => `<option value="${idx + 1}" ${idx + 1 === state.periodMonth ? 'selected' : ''}>${m}</option>`)
    .join('');
}

function badge(label, tone = 'neutral') {
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

function varianceBadge(value, forceBad = false) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    return badge('-', forceBad ? 'bad' : 'neutral');
  }

  const tone = forceBad ? 'bad' : amount < 0 ? 'bad' : 'good';
  return badge(formatCurrency(amount), tone);
}

function renderSparkline(values, options = {}) {
  const data = values
    .map((value) => Number(value || 0))
    .map((value) => (Number.isFinite(value) ? value : 0))
    .filter((value) => !Number.isNaN(value));

  if (data.length < 2) {
    return `<div class="sparkline sparkline-empty">${escapeHtml(options.emptyText || 'No trend data available')}</div>`;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);
  const width = 100;
  const height = 100;
  const label = options.label || 'Trend';
  const color = options.color || 'var(--accent)';
  const format = options.formatter || formatCurrency;

  const points = data
    .map((value, index) => {
      const x = width * (data.length === 1 ? 0 : index / (data.length - 1));
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const minPoint = data.indexOf(min);
  const maxPoint = data.indexOf(max);
  const minX = width * (data.length === 1 ? 0 : minPoint / (data.length - 1));
  const minY = height - ((data[minPoint] - min) / span) * height;
  const maxX = width * (data.length === 1 ? 0 : maxPoint / (data.length - 1));
  const maxY = height - ((data[maxPoint] - min) / span) * height;
  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return `
    <div class="sparkline-wrap">
      <div class="sparkline-head">
        <span class="sparkline-label">${escapeHtml(label)}</span>
      </div>
      <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">
        <polyline class="sparkline-fill" points="${fillPoints}" fill="${color}" fill-opacity="0.12" />
        <polyline
          class="sparkline-line"
          points="${points}"
          stroke="${color}"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="${maxX.toFixed(2)}" cy="${maxY.toFixed(2)}" r="2.2" fill="${color}" />
        <circle cx="${minX.toFixed(2)}" cy="${minY.toFixed(2)}" r="2.2" fill="${color}" />
      </svg>
      <div class="sparkline-meta">
        <span>Min ${format(min)}</span>
        <span>${format(max)}</span>
      </div>
    </div>
  `;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function userCanAdmin() {
  return state.user?.role === 'admin';
}

function userIsDoctor() {
  return state.user?.role === 'doctor';
}

function getMenuItemsForUser() {
  if (userCanAdmin()) {
    return menuItems;
  }

  const role = String(state.user?.role || '').toLowerCase();

  if (role === 'mapper') {
    const ids = ['overview', 'setup-center', 'monthly-intake', 'reports', 'support'];
    return menuItems.filter((item) => ids.includes(item.id));
  }

  if (role === 'accountant') {
    const ids = ['overview', 'calculation-review', 'payout-center', 'reports', 'support'];
    return menuItems.filter((item) => ids.includes(item.id));
  }

  if (role === 'doctor') {
    const ids = ['overview', 'monthly-intake', 'payout-center', 'reports', 'support'];
    return menuItems.filter((item) => ids.includes(item.id));
  }

  return menuItems.filter((item) => item.id !== 'setup-center');
}

function setPage(pageId) {
  const normalizedPageId = LEGACY_PAGE_MAP[pageId] || pageId;
  const availableIds = getMenuItemsForUser().map((item) => item.id);
  if (!availableIds.includes(normalizedPageId)) {
    state.page = availableIds[0] || 'dashboard';
    state.sidebarOpen = false;
    render();
    return;
  }

  state.page = normalizedPageId;
  state.sidebarOpen = false;
  render();
}

function renderLogin() {
  appEl.innerHTML = `
    <div class="page-login">
      <section class="login-hero">
        <div class="logo-mark" aria-hidden="true"></div>
        <div>
          <h1>Referral Revenue Calculation Platform</h1>
          <p>Automate referral discount checks, doctor-group mapping, incentive approvals, and payment disbursal controls.</p>
        </div>
        <div>
          <h3>Built around your monthly workflow</h3>
          <ul>
            <li>Monthly intake and transaction cleaning</li>
            <li>Master setup for discount rules and doctor mapping</li>
            <li>Calculation review and payout processing</li>
            <li>Approval workflow and month lock controls</li>
          </ul>
        </div>
      </section>
      <section class="login-card-wrap">
        <form id="login-form" class="login-card">
          <h2>Log in</h2>
          <div style="display:grid;gap:12px;">
            <label class="field-label" for="login-email">Email</label>
            <input class="input" id="login-email" type="email" name="email" placeholder="Email" value="admin@rrcp.local" required />
            <label class="field-label" for="login-password">Password</label>
            <input class="input" id="login-password" type="password" name="password" placeholder="Password" value="Admin@123" required />
            <button class="btn btn-primary" type="submit">Log In</button>
            <div class="login-presets">
              <p class="helper" style="margin:0;"><strong>Quick Demo Login</strong> (tap one role):</p>
              <div class="login-preset-grid">
                <button class="btn btn-outline btn-preset" type="button" data-login-preset="Admin" data-email="admin@rrcp.local" data-password="Admin@123">Admin</button>
                <button class="btn btn-outline btn-preset" type="button" data-login-preset="Mapper" data-email="mapper@rrcp.local" data-password="Mapper@123">Mapper</button>
                <button class="btn btn-outline btn-preset" type="button" data-login-preset="Accountant" data-email="accountant@rrcp.local" data-password="Accountant@123">Accountant</button>
                <button class="btn btn-outline btn-preset" type="button" data-login-preset="Doctor" data-email="doctor.aarav@rrcp.local" data-password="Doctor@123">Doctor</button>
              </div>
            </div>
            <p id="login-error" class="error" style="display:none"></p>
          </div>
        </form>
      </section>
    </div>
  `;

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');

  document.querySelectorAll('[data-login-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      emailInput.value = button.dataset.email || '';
      passwordInput.value = button.dataset.password || '';
      errorEl.style.display = 'none';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.style.display = 'none';

    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      setAuth(data.token, data.user);
      render();
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  });
}

function renderShell() {
  const visibleMenuItems = getMenuItemsForUser();
  const currentMenuItem = getMenuItemById(state.page) || visibleMenuItems[0] || { label: 'Workspace' };

  appEl.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar">
        <div class="brand-panel">
          <div class="brand-mark">RR</div>
          <div class="brand-copy">
            <strong>Referral Revenue</strong>
            <span>Calculation workspace</span>
          </div>
        </div>
        <div class="menu-meta">Signed in as<br/><strong>${escapeHtml(state.user.email)}</strong></div>
        <p class="menu-section-title">Navigation</p>
        <nav class="menu">
          ${visibleMenuItems
            .map(
              (item) =>
                `<button class="menu-btn ${state.page === item.id ? 'active' : ''}" data-nav="${item.id}">
                  <span class="menu-icon">${icon(item.icon, 18, item.label)}</span>
                  <span>${escapeHtml(item.label)}</span>
                </button>`
            )
            .join('')}
        </nav>
        ${renderSidebarStatusCard(currentMenuItem.label)}
      </aside>
      <div class="overlay ${state.sidebarOpen ? 'show' : ''}" id="overlay"></div>
      <main class="main">
        <header class="topbar">
          <div class="topbar-main">
            <button class="mobile-toggle" id="mobile-toggle">☰</button>
            <div class="topbar-title-wrap">
              <p class="topbar-kicker">RRCP</p>
              <div class="topbar-title">
                <span class="topbar-title-icon">${icon('chart', 17, 'Referral Revenue Calculation Platform')}</span>
                Referral Revenue Calculation Platform
              </div>
              <p class="topbar-subtitle">${escapeHtml(currentMenuItem.label)} workspace</p>
            </div>
          </div>
          <div class="topbar-tools">
            <div class="context-chips">
              <span class="pill pill-strong">${escapeHtml(currentMenuItem.label)}</span>
              <span class="pill">${escapeHtml(toReadableLabel(state.user.role || 'User'))}</span>
              <span class="pill">${escapeHtml(currentPeriodLabel())}</span>
            </div>
            <span class="pill pill-user">${escapeHtml(state.user.email)}</span>
            <button class="btn btn-outline" id="logout-btn">Logout</button>
          </div>
        </header>
        <section class="main-content" id="page-content"></section>
      </main>
    </div>
  `;

  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => setPage(button.dataset.nav));
  });

  document.getElementById('mobile-toggle').addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  });

  document.getElementById('overlay').addEventListener('click', () => {
    state.sidebarOpen = false;
    render();
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    setAuth(null, null);
    render();
  });
}

async function renderDashboardPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="panel">Loading dashboard...</div>';

  try {
    const data = await api(`/api/dashboard?year=${state.periodYear}&month=${state.periodMonth}`);
    const topPros = Array.isArray(data.topPros) ? data.topPros.slice(0, 8) : [];
    const topMax = Math.max(1, ...topPros.map((p) => Number(p.net || 0)));
    const discountRate = Number(data.totals.gross || 0) > 0 ? (Number(data.totals.discount || 0) / Number(data.totals.gross || 1)) * 100 : 0;
    const netRate = Number(data.totals.gross || 0) > 0 ? (Number(data.totals.net || 0) / Number(data.totals.gross || 1)) * 100 : 0;
    const trendNet = topPros.map((p) => Number(p.net || 0));
    const trendCases = topPros.map((p) => Number(p.cases || 0));

    content.innerHTML = `
      ${renderPageHero(
        'Overview',
        'dashboard',
        'Track monthly readiness, billing, discount exposure, and pending operational work for the active month.',
        `
          <select class="select" id="dash-year">${yearOptions()}</select>
          <select class="select" id="dash-month">${monthOptions()}</select>
          <button class="btn btn-secondary" id="dash-refresh">Apply Period</button>
        `
      )}

      ${renderDashboardWorkflow(data)}

      <div class="grid-4" style="margin-bottom:14px;">
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-icon">${icon('chart', 17, 'Total cases')}</span>
            <span class="label">Total Cases</span>
          </div>
          <div class="value">${formatNumber(data.totals.total_cases)}</div>
          <div class="kpi-sub">This period</div>
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-icon">${icon('wallet', 17, 'Gross billing')}</span>
            <span class="label">Gross Billing</span>
          </div>
          <div class="value">${formatCurrency(data.totals.gross)}</div>
          <div class="kpi-sub">Collected value</div>
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-icon">${icon('trend', 17, 'Total discount')}</span>
            <span class="label">Total Discount</span>
          </div>
          <div class="value">${formatCurrency(data.totals.discount)}</div>
          <div class="mini-progress">
            <span style="width:${Math.min(100, Math.max(0, Math.round(discountRate)))}%;"></span>
          </div>
          <div class="kpi-sub">~${formatNumber(discountRate)}% of gross</div>
        </div>
        <div class="kpi">
          <div class="kpi-head">
            <span class="kpi-icon">${icon('approval', 17, 'Net revenue')}</span>
            <span class="label">Net Revenue</span>
          </div>
          <div class="value">${formatCurrency(data.totals.net)}</div>
          <div class="mini-progress">
            <span style="width:${Math.min(100, Math.max(0, Math.round(netRate)))}%;"></span>
          </div>
          <div class="kpi-sub">~${formatNumber(netRate)}% realized</div>
        </div>
      </div>

      <div class="grid-2">
        <section class="panel panel-accent">
          <h3 class="with-title-icon" style="margin-top:0;">${icon('users', 18, 'Top PRO Productivity')}Top PRO Productivity</h3>
          <div class="chart">
            ${topPros
              .map((p) => {
                const pct = Math.round((Number(p.net || 0) / topMax) * 100);
                return `
                  <div class="chart-bar">
                    <div class="chart-meta">
                      <strong>${escapeHtml(p.pro_name)}</strong>
                      <span class="helper">${formatNumber(p.cases)} cases</span>
                    </div>
                    <div class="chart-track"><div class="chart-fill" style="width:${pct}%;"></div></div>
                    <div>${formatCurrency(p.net)}</div>
                  </div>
                `;
              })
              .join('') || '<p class="helper">No PRO productivity data for selected period yet.</p>'}
          </div>
        </section>

        <section class="panel panel-accent">
          <h3 class="with-title-icon" style="margin-top:0;">${icon('lock', 18, 'Control status')}Control Status</h3>
          <div class="dashboard-inline-guide">
            ${renderDashboardGuide()}
          </div>
          <p>${data.isLocked ? badge('Period Locked', 'bad') : badge('Period Open', 'good')}</p>
          <p>Pending approvals: <strong>${formatNumber(data.pendingApprovals)}</strong></p>
          <p>Pending payment approvals: <strong>${formatCurrency(data.pendingPayments.pending_approval_amount)}</strong></p>
          <p>Reference rows: Services ${formatNumber(data.referenceSummary.services)} | Rules ${formatNumber(
      data.referenceSummary.discountRules
    )} | Doctors ${formatNumber(data.referenceSummary.doctors)}</p>
          <hr style="border:none;border-top:1px solid #e3e8f2" />
          <p><strong>Latest engine run:</strong></p>
          ${data.latestRun ? `<p>${escapeHtml(data.latestRun.run_at)} | Flags: ${data.latestRun.total_flags}</p>` : '<p>-</p>'}
          <button class="btn btn-primary" id="go-engine">Open Calculation Review</button>
        </section>
      </div>

      <section class="panel panel-accent">
        <h3 class="with-title-icon" style="margin-top:0;">${icon('chart', 18, 'Performance micro charts')}Performance Micro Charts</h3>
        <div class="micro-chart-grid">
          ${renderSparkline(trendNet, {
            label: 'Top PRO Net (₹)',
            color: 'var(--accent)',
            emptyText: 'Add transactions to view net trend'
          })}
          ${renderSparkline(trendCases, {
            label: 'Top PRO Case Volume',
            color: 'var(--good)',
            formatter: formatNumber,
            emptyText: 'Add transactions to view cases trend'
          })}
        </div>
      </section>
    `;

    document.getElementById('dash-refresh').addEventListener('click', () => {
      state.periodYear = Number(document.getElementById('dash-year').value);
      state.periodMonth = Number(document.getElementById('dash-month').value);
      renderDashboardPage();
    });

    document.querySelectorAll('[data-workflow-go]').forEach((button) => {
      button.addEventListener('click', () => {
        setPage(button.dataset.workflowGo);
      });
    });

    const goEngineBtn = document.getElementById('go-engine');
    if (goEngineBtn) {
      goEngineBtn.addEventListener('click', () => setPage('calculation-review'));
    }
  } catch (error) {
    showPageError(content, error);
  }
}

async function renderUsersPage() {
  const content = document.getElementById('page-content');

  if (!userCanAdmin()) {
    content.innerHTML = '<div class="panel">Only admin can manage users.</div>';
    return;
  }

  content.innerHTML = '<div class="panel">Loading users...</div>';

  try {
    const [data, doctors] = await Promise.all([
      api('/api/users'),
      api('/api/reference/doctors?page=1&pageSize=5000')
    ]);
    const doctorRows = Array.isArray(doctors.rows) ? doctors.rows : [];
    const doctorOptions = doctorRows
      .map(
        (doctor) =>
          `<option value="${doctor.id}">${escapeHtml(doctor.doctor_name)}${doctor.doctor_code ? ` (${escapeHtml(doctor.doctor_code)})` : ''}</option>`
      )
      .join('');

    content.innerHTML = `
      <div class="page-head">${pageTitle('User Maintenance', 'users')}</div>
      ${renderPageGuide(
        'User Maintenance Guide',
        'users',
        [
          'Create users by selecting role and credentials.',
          'For doctor role, link one existing doctor profile from master data.',
          'Disable users instead of deleting when you want audit continuity.'
        ],
        'Only admin users can access this page.'
      )}
      <div class="grid-2" style="margin-bottom:12px;">
        <section class="panel">
          <h3 class="with-title-icon" style="margin-top:0;">${icon('users', 18, 'Add User')}Add User</h3>
          <form id="add-user-form" class="form-grid">
            ${renderField(
              'Email address',
              '<input class="input" name="email" type="email" placeholder="name@company.com" required />',
              'Use the login email the user will sign in with.'
            )}
            <div class="input-row">
              ${renderField(
                'Temporary password',
                '<input class="input" name="password" type="text" placeholder="Create a temporary password" required />',
                'Share this once, then ask the user to change it later if needed.'
              )}
              ${renderField(
                'Role',
                `<select class="select" name="role" id="add-user-role">
                  <option value="mapper">Data Mapper</option>
                  <option value="accountant">Accountant</option>
                  <option value="doctor">Doctor</option>
                  <option value="admin">Admin</option>
                </select>`,
                'Role controls which pages and actions the user can access.'
              )}
            </div>
            <div id="add-user-doctor-wrap" style="display:none;">
              ${renderField(
                'Linked doctor profile',
                `<select class="select" id="add-user-doctor" name="doctorMasterId">
                  <option value="">Select linked doctor</option>
                  ${doctorOptions}
                </select>`,
                'Required only when the role is Doctor.'
              )}
            </div>
            <button class="btn btn-primary" type="submit">Create User</button>
          </form>
        </section>

        <section class="panel">
          <h3 class="with-title-icon" style="margin-top:0;">${icon('approval', 18, 'Approval Rules Snapshot')}Approval Rules Snapshot</h3>
          <p class="helper">Override incentive amount, change doctor group/PRO, add doctor, and disbursal are tracked through approval workflow.</p>
        </section>
      </div>

      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Linked Doctor</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${Array.isArray(data.users) && data.users.length
                ? data.users
                .map(
                  (u) => `
                  <tr>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${escapeHtml(u.role)}</td>
                    <td>${escapeHtml(u.doctor_name || '-')}</td>
                    <td>${u.status === 'active' ? badge('Active', 'good') : badge('Disabled', 'bad')}</td>
                    <td>${u.last_login_at ? escapeHtml(formatDate(u.last_login_at)) : '-'}</td>
                    <td>
                      <div class="table-actions">
                        <button class="btn btn-warning" data-user-action="toggle" data-id="${u.id}" data-next="${
                    u.status === 'active' ? 'disabled' : 'active'
                  }">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
                        <button class="btn btn-danger" data-user-action="delete" data-id="${u.id}">Delete</button>
                      </div>
                    </td>
                  </tr>
                `
                )
                .join('')
                : renderNoRows(6, 'No users found. Create your first user from the form above.')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    const roleSelect = document.getElementById('add-user-role');
    const doctorSelect = document.getElementById('add-user-doctor');
    const doctorWrap = document.getElementById('add-user-doctor-wrap');

    const toggleDoctorInput = () => {
      const doctorMode = roleSelect.value === 'doctor';
      doctorWrap.style.display = doctorMode ? 'block' : 'none';
      doctorSelect.required = doctorMode;
      if (!doctorMode) {
        doctorSelect.value = '';
      }
    };

    roleSelect.addEventListener('change', toggleDoctorInput);
    toggleDoctorInput();

    document.getElementById('add-user-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const role = String(formData.get('role') || '').trim();

      const payload = {
        email: formData.get('email'),
        password: formData.get('password'),
        role
      };

      if (role === 'doctor') {
        payload.doctorMasterId = Number(formData.get('doctorMasterId') || 0);
      }

      try {
        await api('/api/users', {
          method: 'POST',
          body: payload
        });
        notify('User created');
        renderUsersPage();
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.querySelectorAll('[data-user-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.id;
        const action = button.dataset.userAction;

        try {
          if (action === 'toggle') {
            await api(`/api/users/${id}`, {
              method: 'PATCH',
              body: { status: button.dataset.next }
            });
            notify('User updated');
          }

          if (action === 'delete') {
            const ok = window.confirm('Delete this user?');
            if (!ok) return;
            await api(`/api/users/${id}`, { method: 'DELETE' });
            notify('User deleted');
          }

          renderUsersPage();
        } catch (error) {
          notify(error.message, true);
        }
      });
    });
  } catch (error) {
    showPageError(content, error);
  }
}

async function renderDataInputPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="panel">Loading data input...</div>';

  try {
    const dataPage = Math.max(1, Number(state.dataPage || 1));
    const dataPageSize = Math.max(25, Number(state.dataPageSize || 50));
    const records = await api(
      `/api/data/records?page=${dataPage}&pageSize=${dataPageSize}&year=${state.periodYear}&month=${state.periodMonth}&search=${encodeURIComponent(
        state.dataSearch
      )}`
    );
    const latestPeriodWithData = records.latestPeriodWithData || null;
    if (
      Number(records.total || 0) === 0 &&
      !state.dataSearch &&
      latestPeriodWithData &&
      Number(latestPeriodWithData.year) > 0 &&
      Number(latestPeriodWithData.month) >= 1 &&
      (
        Number(latestPeriodWithData.year) !== Number(state.periodYear) ||
        Number(latestPeriodWithData.month) !== Number(state.periodMonth)
      )
    ) {
      const previousPeriodLabel = currentPeriodLabel();
      state.periodYear = Number(latestPeriodWithData.year);
      state.periodMonth = Number(latestPeriodWithData.month);
      notify(`No rows found for ${previousPeriodLabel}. Showing ${currentPeriodLabel()}, the latest period with uploaded data.`);
      await renderActivePage();
      return;
    }

    const totalRows = Number(records.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / dataPageSize));

    if (totalRows > 0 && dataPage > totalPages) {
      state.dataPage = totalPages;
      renderDataInputPage();
      return;
    }

    const visibleStart = totalRows > 0 ? (dataPage - 1) * dataPageSize + 1 : 0;
    const visibleEnd = totalRows > 0 ? Math.min(dataPage * dataPageSize, totalRows) : 0;
    const pageSizeOptions = [25, 50, 100, 200]
      .map((size) => `<option value="${size}" ${dataPageSize === size ? 'selected' : ''}>${size} rows</option>`)
      .join('');

    content.innerHTML = `
      ${renderPageHero(
        'Monthly Intake',
        'upload',
        'Upload monthly files, validate imported rows, and export intake data for review before running the calculation.',
        `
          <select class="select" id="data-year">${yearOptions()}</select>
          <select class="select" id="data-month">${monthOptions()}</select>
          <select class="select" id="data-page-size">${pageSizeOptions}</select>
          <input class="input" id="data-search" placeholder="Search patient ID / doctor / patient / item" value="${escapeHtml(
            state.dataSearch
          )}" />
          <button class="btn btn-secondary" id="data-refresh">Apply Filters</button>
        `
      )}

      ${renderPageGuide(
        'Monthly Intake Guide',
        'upload',
        [
          'Pick the month first, then upload the transaction sheet.',
          'Use search to verify doctor, patient, and billed item before calculation.',
          'Download period CSV when you need to review or share imported rows.'
        ],
        userIsDoctor()
          ? 'Doctor users can upload and review only their own doctor data.'
          : 'Use this page only for intake and validation before moving to calculation.'
      )}

      <section class="panel compact-summary-panel" style="margin-bottom:10px;">
        <div class="compact-summary-grid">
          <div><span class="summary-label">Rows Loaded</span><strong>${formatNumber(totalRows)}</strong></div>
          <div><span class="summary-label">Current Period</span><strong>${escapeHtml(currentPeriodLabel())}</strong></div>
          <div><span class="summary-label">Current Page</span><strong>${formatNumber(dataPage)} / ${formatNumber(totalPages)}</strong></div>
          <div><span class="summary-label">Search</span><strong>${escapeHtml(state.dataSearch || 'All rows')}</strong></div>
        </div>
      </section>

      <div class="compact-section-grid" style="margin-bottom:10px;">
        <section class="panel compact-card">
          <div class="compact-card-head">
            <div class="compact-card-icon">${icon('upload', 18, 'Upload Monthly File')}</div>
            <div class="compact-card-copy">
              <p class="compact-card-kicker">Intake action</p>
              <h3 class="with-title-icon" style="margin:0;">Upload Monthly File</h3>
              <p class="helper compact-card-note">Dashboard uploads add monthly rows. Incentive workbook uploads update exact doctor incentive values for the selected month.</p>
            </div>
          </div>
          <form id="upload-data-form" class="form-grid">
            ${renderField(
              'Transaction file',
              '<input class="input" type="file" name="file" accept=".xlsx,.xls" required />',
              `Upload the file for ${currentPeriodLabel()}. Incentive workbook rows will be matched to this month and used during Calculation Review.`
            )}
            <div class="form-inline-actions">
              <button class="btn btn-primary" type="submit">Upload File</button>
              <span class="helper">Rows will appear in the table below after import.</span>
            </div>
          </form>
        </section>

        <section class="panel compact-card">
          <div class="compact-card-head">
            <div class="compact-card-icon">${icon('table', 18, 'Export Intake Data')}</div>
            <div class="compact-card-copy">
              <p class="compact-card-kicker">Validation action</p>
              <h3 class="with-title-icon" style="margin:0;">Export Intake Data</h3>
              <p class="helper compact-card-note">Download the current filtered period when you want to validate imported rows outside the system.</p>
            </div>
          </div>
          <div class="chip-list">
            <span class="chip-note">Patient search</span>
            <span class="chip-note">Doctor validation</span>
            <span class="chip-note">CSV review</span>
          </div>
          <div class="form-inline-actions">
            <button class="btn btn-secondary" id="data-download">Download Current Period CSV</button>
            <button class="btn btn-outline" id="go-engine">Open Calculation Review</button>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="table-summary-bar">
          <div>
            <p style="margin:0;">Total rows: <strong>${formatNumber(totalRows)}</strong></p>
            <p class="helper" style="margin:4px 0 0;">Showing <strong>${formatNumber(visibleStart)}</strong> to <strong>${formatNumber(
              visibleEnd
            )}</strong> of <strong>${formatNumber(totalRows)}</strong></p>
          </div>
          <div class="pagination-controls">
            <span class="pagination-status">Page ${formatNumber(dataPage)} of ${formatNumber(totalPages)}</span>
            <button class="btn btn-outline" id="data-prev-page" ${dataPage <= 1 ? 'disabled' : ''}>Previous</button>
            <button class="btn btn-outline" id="data-next-page" ${dataPage >= totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="intake-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient ID</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>PRO</th>
                <th>Item</th>
                <th>Price</th>
                <th>Discount</th>
                <th>Net</th>
                <th>Total Payment Received</th>
                <th>Payment Method</th>
                <th>Revenue Booked In</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${Array.isArray(records.rows) && records.rows.length
                ? records.rows
                .map(
                  (row) => {
                    const visitDate = formatDateTimeParts(row.visit_date);
                    return `
                    <tr>
                      <td>
                        <span class="cell-primary">${escapeHtml(visitDate.date)}</span>
                        <span class="cell-meta">${escapeHtml(visitDate.time || '-')}</span>
                      </td>
                      <td><span class="cell-primary">${escapeHtml(row.patient_id || '-')}</span></td>
                      <td class="cell-wrap"><span class="cell-primary">${escapeHtml(row.patient_name || '-')}</span></td>
                      <td class="cell-wrap"><span class="cell-primary">${escapeHtml(row.referring_doctor || '-')}</span></td>
                      <td><span class="cell-primary">${escapeHtml(row.pro_name || 'Unassigned')}</span></td>
                      <td class="cell-wrap"><span class="cell-primary">${escapeHtml(row.billable_items || '-')}</span></td>
                      <td class="is-number">${formatCurrencyOrDash(row.total_price)}</td>
                      <td class="is-number">${formatCurrencyOrDash(row.total_discount)}</td>
                      <td class="is-number">${formatCurrencyOrDash(row.total_net)}</td>
                      <td class="is-number">${formatCurrencyOrDash(row.total_payment)}</td>
                      <td><span class="cell-primary">${escapeHtml(row.payment_method || '-')}</span></td>
                      <td><span class="cell-primary">${escapeHtml(row.revenue_booked_in || '-')}</span></td>
                      <td>${row.receipt_status?.toLowerCase() === 'paid' ? badge('Paid', 'good') : badge(row.receipt_status || 'Unknown', 'warn')}</td>
                    </tr>
                  `;
                  }
                )
                .join('')
                : renderNoRows(13, 'No transaction rows found for this period. Upload data to continue.')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('data-refresh').addEventListener('click', () => {
      state.periodYear = Number(document.getElementById('data-year').value);
      state.periodMonth = Number(document.getElementById('data-month').value);
      state.dataPageSize = Number(document.getElementById('data-page-size').value);
      state.dataSearch = document.getElementById('data-search').value.trim();
      state.dataPage = 1;
      renderDataInputPage();
    });

    document.getElementById('data-page-size').addEventListener('change', (event) => {
      state.dataPageSize = Number(event.target.value);
      state.dataPage = 1;
      renderDataInputPage();
    });

    document.getElementById('data-prev-page').addEventListener('click', () => {
      if (state.dataPage > 1) {
        state.dataPage -= 1;
        renderDataInputPage();
      }
    });

    document.getElementById('data-next-page').addEventListener('click', () => {
      if (state.dataPage < totalPages) {
        state.dataPage += 1;
        renderDataInputPage();
      }
    });

    document.getElementById('upload-data-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      formData.append('year', String(state.periodYear));
      formData.append('month', String(state.periodMonth));

      try {
        const result = await api('/api/data/upload', {
          method: 'POST',
          body: formData
        });
        const detectedYear = Number(result.detectedPeriodYear || 0);
        const detectedMonth = Number(result.detectedPeriodMonth || 0);
        const hasDetectedPeriod = detectedYear > 0 && detectedMonth >= 1 && detectedMonth <= 12;
        const previousPeriodLabel = currentPeriodLabel();

        if (hasDetectedPeriod) {
          state.periodYear = detectedYear;
          state.periodMonth = detectedMonth;
        }

        const nextPeriodLabel = hasDetectedPeriod ? currentPeriodLabel() : previousPeriodLabel;
        const switchedPeriod = hasDetectedPeriod && nextPeriodLabel !== previousPeriodLabel;
        if (result.mode === 'incentive_workbook') {
          notify(
            `Uploaded incentive workbook ${result.fileName}. Saved ${formatNumber(result.saved || 0)} mappings for ${nextPeriodLabel}, matched ${formatNumber(
              result.matched || 0
            )} existing rows, and found ${formatNumber(result.exactPayable || 0)} exact doctor incentive values. Re-run Calculation Review to refresh amounts.`
          );
        } else {
          const incentiveSuffix =
            Number(result.incentiveSaved || 0) > 0
              ? ` Imported ${formatNumber(result.incentiveSaved || 0)} exact incentive mappings and matched ${formatNumber(
                  result.incentiveMatched || 0
                )} rows. Re-run Calculation Review to refresh amounts.`
              : '';
          notify(
            switchedPeriod
              ? `Uploaded ${result.inserted} records from ${result.fileName}. Showing ${nextPeriodLabel} because that is the detected file period.${incentiveSuffix}`
              : `Uploaded ${result.inserted} records from ${result.fileName}${hasDetectedPeriod ? ` for ${nextPeriodLabel}` : ''}.${incentiveSuffix}`
          );
        }
        state.dataPage = 1;
        await renderActivePage();
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.getElementById('data-download').addEventListener('click', async () => {
      try {
        const blob = await api(`/api/data/export?year=${state.periodYear}&month=${state.periodMonth}`);
        saveBlob(blob, `data-export-${state.periodYear}-${String(state.periodMonth).padStart(2, '0')}.csv`);
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.getElementById('go-engine').addEventListener('click', () => {
      setPage('calculation-review');
    });
  } catch (error) {
    showPageError(content, error);
  }
}

async function renderReferenceTablesPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="panel">Loading setup center...</div>';

  try {
    const [summary, doctorsData, requirements, usersData, approvalsData] = await Promise.all([
      api('/api/reference/summary'),
      api('/api/reference/doctors?page=1&pageSize=5000'),
      api('/api/reference/requirements'),
      userCanAdmin() ? api('/api/users') : Promise.resolve({ users: [] }),
      api('/api/approvals?status=pending')
    ]);
    const allDoctors = Array.isArray(doctorsData.rows) ? doctorsData.rows : [];
    const allUsers = Array.isArray(usersData.users) ? usersData.users : [];
    const allRequirements = Array.isArray(requirements.rows) ? requirements.rows : [];
    const filteredDoctors = filterRowsBySearch(allDoctors, state.doctorSearch);
    const filteredUsers = filterRowsBySearch(allUsers, getTableSearch('users'));
    const filteredRequirements = filterRowsBySearch(allRequirements, getTableSearch('requirements'));
    const doctorsById = new Map(allDoctors.map((doctor) => [Number(doctor.id), doctor]));
    const pendingDoctorApprovalById = new Map();
    (Array.isArray(approvalsData.rows) ? approvalsData.rows : []).forEach((approval) => {
      if (String(approval.type || '') !== 'change_of_doctor_info') {
        return;
      }

      const doctorId = Number(approval.entity_id || 0);
      if (!doctorId || pendingDoctorApprovalById.has(doctorId)) {
        return;
      }

      let payload = {};
      try {
        payload = JSON.parse(approval.payload_json || '{}') || {};
      } catch (_error) {
        payload = {};
      }

      pendingDoctorApprovalById.set(doctorId, payload);
    });
    const linkedDoctorIds = new Set(
      allUsers
        .filter((user) => String(user.role || '').toLowerCase() === 'doctor' && Number(user.doctor_master_id || 0) > 0)
        .map((user) => Number(user.doctor_master_id))
    );
    const confirmationOptions = ['pending', 'confirmed', 'not_confirmed']
      .map((status) => `<option value="${status}">${escapeHtml(toReadableLabel(status))}</option>`)
      .join('');
    const knownPros = Array.from(
      new Set(
        allDoctors
          .map((doctor) => String(doctor.present_pro || '').trim())
          .filter((value) => value !== '')
      )
    ).sort((left, right) => left.localeCompare(right));

    const doctorOptions = Array.isArray(allDoctors)
      ? allDoctors
          .map(
            (doctor) => `<option value="${doctor.id}">${escapeHtml(doctorOptionLabel(doctor))}</option>`
          )
          .join('')
      : '';

    content.innerHTML = `
      ${renderPageHero(
        'Setup Center',
        'table',
        'Maintain master data, doctor ownership, business rules, and user access before the monthly cycle starts.'
      )}

      ${renderPageGuide(
        'Setup Center Guide',
        'table',
        [
          'Upload the latest Special Discount Master and requirement sheet first.',
          'Verify doctor ownership and incentive groups before calculation.',
          userCanAdmin() ? 'Create and maintain user accounts from this same page.' : 'Admin users maintain team access from this page.'
        ],
        'Finish setup here before moving to monthly intake and calculation.'
      )}

      <div class="grid-3" style="margin-bottom:14px;">
        <div class="kpi"><div class="label">Service Prices</div><div class="value">${formatNumber(summary.services)}</div></div>
        <div class="kpi"><div class="label">Discount Rules</div><div class="value">${formatNumber(summary.discountRules)}</div></div>
        <div class="kpi"><div class="label">Doctors in Master</div><div class="value">${formatNumber(summary.doctors)}</div></div>
        <div class="kpi"><div class="label">Requirement Notes</div><div class="value">${formatNumber(requirements.rows?.length || 0)}</div></div>
      </div>

      <div class="grid-2" style="margin-bottom:14px;">
        <section class="panel">
          <h3 class="with-title-icon" style="margin-top:0;">${icon('upload', 18, 'Discount and Doctor Master')}Discount and Doctor Master</h3>
          <form id="ref-upload-form" class="form-grid">
            ${renderField(
              'Master file',
              '<input class="input" name="file" type="file" accept=".xlsx,.xls" required />',
              'This file updates service prices, discount rules, and doctor mapping in one step.'
            )}
            <div class="inline-actions">
              <a class="btn btn-outline" href="${withAppBase('/templates/Special_Discount_Master_Template.xlsx')}" download>Download Sample Format</a>
              <button class="btn btn-primary" type="submit">Update Master Data</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <h3 class="with-title-icon" style="margin-top:0;">${icon('upload', 18, 'Business Rule Notes')}Business Rule Notes</h3>
          <form id="sw-upload-form" class="form-grid">
            ${renderField(
              'Requirement sheet',
              '<input class="input" name="file" type="file" accept=".xlsx,.xls" required />',
              'Upload requirement notes whenever business logic changes or new rule checks are added.'
            )}
            <div class="inline-actions">
              <a class="btn btn-outline" href="${withAppBase('/templates/Software_Requirement_Template.xlsx')}" download>Download Sample Format</a>
              <button class="btn btn-secondary" type="submit">Update Rule Notes</button>
            </div>
          </form>
        </section>
      </div>

      ${
        userCanAdmin()
          ? `
            <section class="panel" style="margin-bottom:14px;">
              <div class="page-head" style="margin-bottom:8px;">
                <h3 class="with-title-icon" style="margin:0;">${icon('users', 18, 'Team Access')}Team Access</h3>
              </div>
              <p class="helper">Create login access for admin, mapper, accountant, or doctor users without leaving setup.</p>
              <div class="grid-2" style="margin-top:12px;">
                <section class="panel panel-accent">
                  <h3 class="with-title-icon" style="margin-top:0;">${icon('users', 18, 'Add Team Member')}Add Team Member</h3>
                  <form id="add-user-form" class="form-grid">
                    ${renderField(
                      'Email address',
                      '<input class="input" name="email" type="email" placeholder="name@company.com" required />',
                      'Use the email address the user will log in with.'
                    )}
                    <div class="input-row">
                      ${renderField(
                        'Temporary password',
                        '<input class="input" name="password" type="text" placeholder="Create a temporary password" required />'
                      )}
                      ${renderField(
                        'Role',
                        `<select class="select" name="role" id="add-user-role">
                          <option value="mapper">Data Mapper</option>
                          <option value="accountant">Accountant</option>
                          <option value="doctor">Doctor</option>
                          <option value="admin">Admin</option>
                        </select>`,
                        'Choose the role based on the user workflow.'
                      )}
                    </div>
                    <div id="add-user-doctor-wrap" style="display:none;">
                      ${renderField(
                        'Linked doctor profile',
                        `<select class="select" id="add-user-doctor" name="doctorMasterId">
                          <option value="">Select linked doctor</option>
                          ${doctorOptions}
                        </select>`,
                        'Required only when creating a doctor login.'
                      )}
                    </div>
                    <p class="helper" id="add-user-warning" style="display:none;margin:0;"></p>
                    <button class="btn btn-primary" type="submit">Create User</button>
                  </form>
                </section>

                <section class="panel">
                  <div class="page-head" style="margin-bottom:8px;">
                    <h3 class="with-title-icon" style="margin:0;">${icon('approval', 18, 'Active Users')}Active Users</h3>
                    <div class="toolbar">
                      <input class="input" id="users-search" placeholder="Search email / role / linked doctor / status" value="${escapeHtml(
                        getTableSearch('users')
                      )}" />
                      <button class="btn btn-secondary" id="users-search-btn">Search</button>
                    </div>
                  </div>
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Linked Doctor</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${Array.isArray(filteredUsers) && filteredUsers.length
                          ? filteredUsers
                              .map(
                                (u) => `
                                  <tr>
                                    <td>${escapeHtml(u.email)}</td>
                                    <td>${escapeHtml(u.role)}</td>
                                    <td>${
                                      u.role === 'doctor' && !u.doctor_name
                                        ? badge('Not linked', 'warn')
                                        : escapeHtml(u.doctor_name || '-')
                                    }</td>
                                    <td>${u.status === 'active' ? badge('Active', 'good') : badge('Disabled', 'bad')}</td>
                                    <td>
                                      <div class="table-actions">
                                        <button class="btn btn-warning" data-user-action="toggle" data-id="${u.id}" data-next="${
                                          u.status === 'active' ? 'disabled' : 'active'
                                        }">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
                                        <button class="btn btn-danger" data-user-action="delete" data-id="${u.id}">Delete</button>
                                        ${
                                          u.role === 'doctor'
                                            ? `<select class="select" data-user-link-id="${u.id}">
                                                <option value="">Select doctor</option>
                                                ${allDoctors
                                                  .map(
                                                    (doctor) =>
                                                      `<option value="${doctor.id}" ${
                                                        Number(doctor.id) === Number(u.doctor_master_id) ? 'selected' : ''
                                                      }>${escapeHtml(doctor.doctor_name)}${
                                                        doctor.doctor_code ? ` (${escapeHtml(doctor.doctor_code)})` : ''
                                                      }</option>`
                                                  )
                                                  .join('')}
                                              </select>
                                              <button class="btn btn-outline" data-user-link-save-id="${u.id}">Save Link</button>`
                                            : ''
                                        }
                                      </div>
                                    </td>
                                  </tr>
                                `
                              )
                              .join('')
                          : renderNoRows(5, 'No users found yet. Create your first team member from the form.')}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </section>
          `
          : ''
      }

      <datalist id="setup-pro-list">
        ${knownPros.map((pro) => `<option value="${escapeHtml(pro)}"></option>`).join('')}
      </datalist>

      <section class="panel" style="margin-bottom:14px;">
        <div class="page-head" style="margin-bottom:8px;">
          <h3 class="with-title-icon" style="margin:0;">${icon('approval', 18, 'Approval Request Desk')}Approval Request Desk</h3>
        </div>
        <p class="helper">Use these forms when doctor data or payout logic must change through approval instead of direct edit. Submitted requests appear in the approval queue for admin action.</p>
        <div class="grid-3" style="margin-top:12px;">
          <section class="panel panel-accent request-panel">
            <div class="request-card-head">
              <div class="request-card-icon">${icon('users', 18, 'Change PRO')}</div>
              <div class="request-card-copy">
                <p class="request-card-kicker">Doctor ownership</p>
                <h3 class="with-title-icon" style="margin:0;">Change PRO</h3>
                <p class="helper request-card-note">Use this when doctor ownership moves from one PRO to another and the change must be approved before payout logic updates.</p>
              </div>
            </div>
            <div class="request-chip-row">
              <span class="request-chip">Approval required</span>
              <span class="request-chip">Updates doctor master</span>
            </div>
            <form id="doctor-pro-request-form" class="form-grid">
              ${renderField(
                'Doctor profile',
                `<select class="select" id="doctor-pro-request-id" name="doctorId" required>
                  <option value="">Select doctor</option>
                  ${doctorOptions}
                </select>`,
                'Choose the doctor whose current PRO needs to be changed.'
              )}
              ${renderField(
                'Next PRO',
                '<input class="input" id="doctor-pro-request-next" name="nextPro" type="text" list="setup-pro-list" placeholder="PRO name" required />',
                'You can choose an existing PRO or type a new one.'
              )}
              ${renderField(
                'Reason for change',
                '<textarea class="textarea" id="doctor-pro-request-reason" name="reason" placeholder="Explain why the PRO mapping needs to change" required></textarea>'
              )}
              <button class="btn btn-secondary" type="submit">Submit PRO Change Request</button>
            </form>
          </section>

          <section class="panel panel-accent request-panel">
            <div class="request-card-head">
              <div class="request-card-icon">${icon('table', 18, 'Update Doctor Info')}</div>
              <div class="request-card-copy">
                <p class="request-card-kicker">Doctor master change</p>
                <h3 class="with-title-icon" style="margin:0;">Update Doctor Info</h3>
                <p class="helper request-card-note">Use this when group, cycle, reporting doctor, confirmation, or other master fields must change through a controlled approval flow. The doctor table updates only after the request is approved.</p>
              </div>
            </div>
            <div class="request-chip-row">
              <span class="request-chip">Group / cycle / reporting</span>
              <span class="request-chip">Tracked in approvals</span>
            </div>
            <form id="doctor-update-request-form" class="form-grid">
              ${renderField(
                'Doctor profile',
                `<select class="select" id="doctor-update-id" name="doctorId" required>
                  <option value="">Select doctor</option>
                  ${doctorOptions}
                </select>`,
                'Select a doctor, then edit only the fields that need approval.'
              )}
              <div class="input-row">
                ${renderField('Doctor name', '<input class="input" id="doctor-update-name" name="doctorName" type="text" placeholder="Doctor name" />')}
                ${renderField('Doctor code', '<input class="input" id="doctor-update-code" name="doctorCode" type="text" placeholder="Doctor code" />')}
              </div>
              <div class="input-row">
                ${renderField('Current PRO', '<input class="input" id="doctor-update-pro" name="presentPro" type="text" list="setup-pro-list" placeholder="Current PRO" />')}
                ${renderField('Incentive group', '<input class="input" id="doctor-update-group" name="incentiveGroup" type="text" placeholder="A / B / C" />')}
              </div>
              <div class="input-row">
                ${renderField('Incentive cycle', '<input class="input" id="doctor-update-cycle" name="incentiveCycle" type="text" placeholder="Monthly / Quarterly" />')}
                ${renderField('Reporting doctor', '<input class="input" id="doctor-update-reporting" name="reportingDoctor" type="text" placeholder="Reporting doctor" />')}
              </div>
              <div class="input-row">
                ${renderField('Location', '<input class="input" id="doctor-update-location" name="location" type="text" placeholder="Location" />')}
                ${renderField('Hospital name', '<input class="input" id="doctor-update-hospital" name="hospitalName" type="text" placeholder="Hospital name" />')}
              </div>
              <div class="input-row">
                ${renderField('Degree', '<input class="input" id="doctor-update-degree" name="degree" type="text" placeholder="MD / DNB / DMRD" />')}
                ${renderField('Contact No.', '<input class="input" id="doctor-update-contact" name="contactNo" type="text" placeholder="Doctor contact number" />')}
              </div>
              <div class="input-row">
                ${renderField(
                  'Confirmation status',
                  `<select class="select" id="doctor-update-confirmation" name="confirmationStatus">${confirmationOptions}</select>`
                )}
                ${renderField(
                  'Verified doctor',
                  `<select class="select" id="doctor-update-verified" name="verified">
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                  </select>`
                )}
              </div>
              ${renderField(
                'Confirmation remarks',
                '<textarea class="textarea" id="doctor-update-remarks" name="confirmationRemarks" placeholder="Remarks shared with finance / operations"></textarea>'
              )}
              ${renderField(
                'Reason for request',
                '<textarea class="textarea" id="doctor-update-reason" name="reason" placeholder="State what changed and why approval is needed" required></textarea>'
              )}
              <button class="btn btn-secondary" type="submit">Submit Doctor Update Request</button>
            </form>
          </section>

          <section class="panel panel-accent request-panel">
            <div class="request-card-head">
              <div class="request-card-icon">${icon('upload', 18, 'Add Doctor')}</div>
              <div class="request-card-copy">
                <p class="request-card-kicker">New master entry</p>
                <h3 class="with-title-icon" style="margin:0;">Add Doctor</h3>
                <p class="helper request-card-note">Create a doctor-addition request when a new doctor should be entered into the verified master instead of being inserted directly.</p>
              </div>
            </div>
            <div class="request-chip-row">
              <span class="request-chip">Doctor creation</span>
              <span class="request-chip">Approval before insert</span>
            </div>
            <form id="doctor-add-request-form" class="form-grid">
              <div class="input-row">
                ${renderField('Doctor name', '<input class="input" name="doctorName" type="text" placeholder="Doctor name" required />')}
                ${renderField('Doctor code', '<input class="input" name="doctorCode" type="text" placeholder="Doctor code" />')}
              </div>
              <div class="input-row">
                ${renderField('Present PRO', '<input class="input" name="presentPro" type="text" list="setup-pro-list" placeholder="Present PRO" />')}
                ${renderField('Incentive group', '<input class="input" name="incentiveGroup" type="text" placeholder="A / B / C" />')}
              </div>
              <div class="input-row">
                ${renderField('Incentive cycle', '<input class="input" name="incentiveCycle" type="text" placeholder="Monthly / Quarterly" />')}
                ${renderField('Reporting doctor', '<input class="input" name="reportingDoctor" type="text" placeholder="Reporting doctor" />')}
              </div>
              <div class="input-row">
                ${renderField('Location', '<input class="input" name="location" type="text" placeholder="Location" />')}
                ${renderField('Hospital name', '<input class="input" name="hospitalName" type="text" placeholder="Hospital name" />')}
              </div>
              <div class="input-row">
                ${renderField('Degree', '<input class="input" name="degree" type="text" placeholder="MD / DNB / DMRD" />')}
                ${renderField('Contact number', '<input class="input" name="contactNo" type="text" placeholder="Contact number" />')}
              </div>
              <div class="input-row">
                ${renderField(
                  'Confirmation status',
                  `<select class="select" name="confirmationStatus">${confirmationOptions}</select>`
                )}
                ${renderField(
                  'Verified doctor',
                  `<select class="select" name="verified">
                    <option value="0">No</option>
                    <option value="1">Yes</option>
                  </select>`
                )}
                ${renderField('Confirmation remarks', '<input class="input" name="confirmationRemarks" type="text" placeholder="Confirmation remarks" />')}
              </div>
              ${renderField(
                'Reason for addition',
                '<textarea class="textarea" name="reason" placeholder="Why this doctor needs to be added to the master" required></textarea>'
              )}
              <button class="btn btn-secondary" type="submit">Submit Add Doctor Request</button>
            </form>
          </section>
        </div>
      </section>

      <section class="panel" style="margin-bottom:14px;">
        <div class="page-head" style="margin-bottom:8px;">
          <h3 class="with-title-icon" style="margin:0;">${icon('users', 18, 'Doctor Ownership and Mapping')}Doctor Ownership and Mapping</h3>
          <div class="toolbar">
            <input class="input" id="doctor-search" placeholder="Search any doctor column" value="${escapeHtml(
              state.doctorSearch
            )}" />
            <button class="btn btn-secondary" id="doctor-search-btn">Search</button>
          </div>
        </div>
        <p class="helper">Use this list to confirm doctor name, PRO ownership, incentive cycle, reporting line, confirmation state, and verification before moving into monthly work.</p>
        <div class="table-wrap">
          <table class="doctor-table">
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Code</th>
                <th>Degree</th>
                <th>Contact No.</th>
                <th>PRO</th>
                <th>Group</th>
                <th>Cycle</th>
                <th>Reporting Doctor</th>
                <th>Confirmation</th>
                <th>Verified</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${Array.isArray(filteredDoctors) && filteredDoctors.length
                ? filteredDoctors
                .map(
                  (d) => `
                    <tr>
                      <td>${escapeHtml(d.doctor_name)}</td>
                      <td>${escapeHtml(d.doctor_code || '-')}</td>
                      <td>${escapeHtml(d.degree || '-')}</td>
                      <td>${escapeHtml(d.contact_no || '-')}</td>
                      <td>${escapeHtml(d.present_pro || '-')}</td>
                      <td>${escapeHtml(d.incentive_group || '-')}</td>
                      <td>${escapeHtml(d.incentive_cycle || '-')}</td>
                      <td>${escapeHtml(d.reporting_doctor || '-')}</td>
                      <td>
                        ${confirmationBadge(d.confirmation_status)}
                        ${
                          (() => {
                            const pendingPayload = pendingDoctorApprovalById.get(Number(d.id));
                            const pendingChanges = pendingPayload && typeof pendingPayload === 'object' && pendingPayload.changes && typeof pendingPayload.changes === 'object'
                              ? pendingPayload.changes
                              : null;
                            if (!pendingChanges) {
                              return '';
                            }

                            const pendingBits = [];
                            if (pendingChanges.confirmationStatus) {
                              pendingBits.push(`Pending approval: ${toReadableLabel(pendingChanges.confirmationStatus)}`);
                            }
                            if (pendingChanges.confirmationRemarks) {
                              pendingBits.push(`Requested remark: ${pendingChanges.confirmationRemarks}`);
                            }

                            return pendingBits.length
                              ? `<span class="cell-meta">${escapeHtml(pendingBits.join(' | '))}</span>`
                              : '';
                          })()
                        }
                        ${
                          d.confirmation_remarks
                            ? `<span class="cell-meta">${escapeHtml(d.confirmation_remarks)}</span>`
                            : ''
                        }
                      </td>
                      <td>${d.verified ? badge('Verified', 'good') : badge('Pending', 'warn')}</td>
                      <td>
                        <div class="table-actions">
                          <button class="btn btn-outline" data-doctor-request-id="${d.id}">Use In Request</button>
                          ${
                            userCanAdmin()
                              ? `<button class="btn btn-outline" data-verify-doctor-id="${d.id}" data-next="${d.verified ? 0 : 1}">${
                                  d.verified ? 'Unverify' : 'Verify'
                                }</button>`
                              : ''
                          }
                        </div>
                      </td>
                    </tr>
                  `
                )
                .join('')
                : renderNoRows(11, 'No doctor mapping rows found. Upload reference master first.')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="page-head" style="margin-bottom:8px;">
          <h3 class="with-title-icon" style="margin:0;">${icon('reports', 18, 'Business Rule Checklist')}Business Rule Checklist</h3>
          <div class="toolbar">
            <input class="input" id="requirements-search" placeholder="Search category or requirement text" value="${escapeHtml(
              getTableSearch('requirements')
            )}" />
            <button class="btn btn-secondary" id="requirements-search-btn">Search</button>
          </div>
        </div>
        <p class="helper">These notes are imported from the requirement sheet and act as the plain-language checklist for the business rules you want this tool to follow.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Requirement</th></tr></thead>
            <tbody>
              ${Array.isArray(filteredRequirements) && filteredRequirements.length
                ? filteredRequirements
                .map(
                  (r) => `<tr><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.requirement_text)}</td></tr>`
                )
                .join('')
                : renderNoRows(2, 'No software requirements loaded yet. Upload requirement sheet.')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('ref-upload-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      try {
        const result = await api('/api/reference/upload', { method: 'POST', body: formData });
        notify(`Reference master loaded: ${result.inserted.doctors} doctors, ${result.inserted.discountRules} rules`);
        renderReferenceTablesPage();
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.getElementById('sw-upload-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      try {
        const result = await api('/api/reference/software/upload', { method: 'POST', body: formData });
        notify(`Requirements loaded: ${result.inserted}`);
        renderReferenceTablesPage();
      } catch (error) {
        notify(error.message, true);
      }
    });

    if (userCanAdmin()) {
      const roleSelect = document.getElementById('add-user-role');
      const doctorSelect = document.getElementById('add-user-doctor');
      const doctorWrap = document.getElementById('add-user-doctor-wrap');
      const userWarning = document.getElementById('add-user-warning');
      const emailInput = document.querySelector('#add-user-form [name="email"]');

      const showUserWarning = (message = '') => {
        const text = String(message || '').trim();
        userWarning.textContent = text;
        userWarning.style.display = text ? 'block' : 'none';
      };

      const toggleDoctorInput = () => {
        const doctorMode = roleSelect.value === 'doctor';
        doctorWrap.style.display = doctorMode ? 'block' : 'none';
        doctorSelect.required = doctorMode;
        if (!doctorMode) {
          doctorSelect.value = '';
        }
        showUserWarning('');
      };

      const validateNewUser = () => {
        const email = String(emailInput.value || '').trim().toLowerCase();
        const role = String(roleSelect.value || '').trim();
        const doctorMasterId = Number(doctorSelect.value || 0);

        if (email && allUsers.some((user) => String(user.email || '').toLowerCase() === email)) {
          showUserWarning('This email already exists. Use a different email or update the existing user.');
          return false;
        }

        if (role === 'doctor' && doctorMasterId > 0 && linkedDoctorIds.has(doctorMasterId)) {
          showUserWarning('This doctor already has a login. Use the existing doctor user or repair its link below.');
          return false;
        }

        showUserWarning('');
        return true;
      };

      roleSelect.addEventListener('change', toggleDoctorInput);
      doctorSelect.addEventListener('change', validateNewUser);
      emailInput.addEventListener('input', validateNewUser);
      toggleDoctorInput();

      document.getElementById('add-user-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const role = String(formData.get('role') || '').trim();

        if (!validateNewUser()) {
          return;
        }

        const payload = {
          email: formData.get('email'),
          password: formData.get('password'),
          role
        };

        if (role === 'doctor') {
          payload.doctorMasterId = Number(formData.get('doctorMasterId') || 0);
        }

        try {
          await api('/api/users', {
            method: 'POST',
            body: payload
          });
          notify('User created');
          renderReferenceTablesPage();
        } catch (error) {
          const message = String(error.message || '');
          if (message.includes('User already exists')) {
            showUserWarning('This email already exists. Use a different email or update the existing user.');
          } else if (message.includes('already linked to this doctor')) {
            showUserWarning('This doctor already has a login. Use the existing doctor user or repair its link below.');
          }
          notify(message, true);
        }
      });

      document.getElementById('users-search-btn').addEventListener('click', () => {
        setTableSearch('users', document.getElementById('users-search').value);
        renderReferenceTablesPage();
      });

      document.querySelectorAll('[data-user-link-save-id]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = Number(button.dataset.userLinkSaveId || 0);
          const select = document.querySelector(`[data-user-link-id="${id}"]`);
          const doctorMasterId = Number(select?.value || 0);
          if (!doctorMasterId) {
            notify('Select a doctor profile first', true);
            return;
          }

          try {
            await api(`/api/users/${id}`, {
              method: 'PATCH',
              body: { doctorMasterId }
            });
            notify('Doctor link updated');
            renderReferenceTablesPage();
          } catch (error) {
            notify(error.message, true);
          }
        });
      });

      document.querySelectorAll('[data-user-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.dataset.id;
          const action = button.dataset.userAction;

          try {
            if (action === 'toggle') {
              await api(`/api/users/${id}`, {
                method: 'PATCH',
                body: { status: button.dataset.next }
              });
              notify('User updated');
            }

            if (action === 'delete') {
              const ok = window.confirm('Delete this user?');
              if (!ok) return;
              await api(`/api/users/${id}`, { method: 'DELETE' });
              notify('User deleted');
            }

            renderReferenceTablesPage();
          } catch (error) {
            notify(error.message, true);
          }
        });
      });
    }

    const populateDoctorUpdateForm = (doctorId) => {
      const doctor = doctorsById.get(Number(doctorId || 0));
      const fieldMap = {
        'doctor-update-name': doctor?.doctor_name || '',
        'doctor-update-code': doctor?.doctor_code || '',
        'doctor-update-pro': doctor?.present_pro || '',
        'doctor-update-group': doctor?.incentive_group || '',
        'doctor-update-cycle': doctor?.incentive_cycle || '',
        'doctor-update-reporting': doctor?.reporting_doctor || '',
        'doctor-update-location': doctor?.location || '',
        'doctor-update-hospital': doctor?.hospital_name || '',
        'doctor-update-degree': doctor?.degree || '',
        'doctor-update-contact': doctor?.contact_no || '',
        'doctor-update-confirmation': doctor?.confirmation_status || 'pending',
        'doctor-update-verified': Number(doctor?.verified || 0) === 1 ? '1' : '0',
        'doctor-update-remarks': doctor?.confirmation_remarks || ''
      };

      Object.entries(fieldMap).forEach(([fieldId, value]) => {
        const field = document.getElementById(fieldId);
        if (field) {
          field.value = value;
        }
      });
    };

    const focusDoctorRequestForms = (doctorId) => {
      const selectedId = String(doctorId || '').trim();
      const proSelect = document.getElementById('doctor-pro-request-id');
      const updateSelect = document.getElementById('doctor-update-id');

      if (proSelect) {
        proSelect.value = selectedId;
      }

      if (updateSelect) {
        updateSelect.value = selectedId;
        populateDoctorUpdateForm(selectedId);
      }

      document.getElementById('doctor-update-request-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    document.getElementById('doctor-update-id')?.addEventListener('change', (event) => {
      populateDoctorUpdateForm(event.target.value);
    });

    document.querySelectorAll('[data-doctor-request-id]').forEach((button) => {
      button.addEventListener('click', () => {
        focusDoctorRequestForms(button.dataset.doctorRequestId);
      });
    });

    document.getElementById('doctor-pro-request-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const doctorId = Number(formData.get('doctorId') || 0);
      const nextPro = String(formData.get('nextPro') || '').trim();
      const reason = String(formData.get('reason') || '').trim();

      if (!doctorId || !nextPro || !reason) {
        notify('Select doctor, next PRO, and reason', true);
        return;
      }

      try {
        await api('/api/reference/doctors/change-pro', {
          method: 'POST',
          body: { doctorId, nextPro, reason }
        });
        notify('PRO change request submitted');
        event.currentTarget.reset();
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.getElementById('doctor-update-request-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const doctorId = Number(formData.get('doctorId') || 0);
      const reason = String(formData.get('reason') || '').trim();
      const currentDoctor = doctorsById.get(doctorId);

      if (!doctorId || !currentDoctor) {
        notify('Select a doctor profile first', true);
        return;
      }

      if (!reason) {
        notify('Reason is required for doctor info change', true);
        return;
      }

      const changes = {};
      const compareTextField = (fieldName, currentValue, nextValue, transform = (value) => String(value || '').trim()) => {
        const normalizedNext = transform(nextValue);
        const normalizedCurrent = transform(currentValue);
        if (normalizedNext !== normalizedCurrent) {
          changes[fieldName] = normalizedNext;
        }
      };

      compareTextField('doctorName', currentDoctor.doctor_name, formData.get('doctorName'));
      compareTextField('doctorCode', currentDoctor.doctor_code, formData.get('doctorCode'));
      compareTextField('presentPro', currentDoctor.present_pro, formData.get('presentPro'));
      compareTextField(
        'incentiveGroup',
        currentDoctor.incentive_group,
        formData.get('incentiveGroup'),
        (value) => String(value || '').trim().toUpperCase()
      );
      compareTextField('incentiveCycle', currentDoctor.incentive_cycle, formData.get('incentiveCycle'));
      compareTextField('reportingDoctor', currentDoctor.reporting_doctor, formData.get('reportingDoctor'));
      compareTextField('location', currentDoctor.location, formData.get('location'));
      compareTextField('hospitalName', currentDoctor.hospital_name, formData.get('hospitalName'));
      compareTextField('degree', currentDoctor.degree, formData.get('degree'));
      compareTextField('contactNo', currentDoctor.contact_no, formData.get('contactNo'));
      compareTextField(
        'confirmationStatus',
        currentDoctor.confirmation_status,
        formData.get('confirmationStatus'),
        (value) => String(value || 'pending').trim().toLowerCase().replace(/[\s-]+/g, '_')
      );
      compareTextField('confirmationRemarks', currentDoctor.confirmation_remarks, formData.get('confirmationRemarks'));

      const nextVerified = String(formData.get('verified') || '0') === '1';
      const currentVerified = Number(currentDoctor.verified || 0) === 1;
      if (nextVerified !== currentVerified) {
        changes.verified = nextVerified;
      }

      if (!Object.keys(changes).length) {
        notify('No doctor changes detected in the form', true);
        return;
      }

      try {
        await api('/api/reference/doctors/request-update', {
          method: 'POST',
          body: { doctorId, reason, changes }
        });
        notify('Doctor update request submitted. The doctor master table will change after approval in Payout Center.');
        form.reset();
        document.getElementById('doctor-update-id').value = '';
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.getElementById('doctor-add-request-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const reason = String(formData.get('reason') || '').trim();
      const doctor = {
        doctorName: String(formData.get('doctorName') || '').trim(),
        doctorCode: String(formData.get('doctorCode') || '').trim(),
        presentPro: String(formData.get('presentPro') || '').trim(),
        incentiveGroup: String(formData.get('incentiveGroup') || '').trim().toUpperCase(),
        incentiveCycle: String(formData.get('incentiveCycle') || '').trim(),
        reportingDoctor: String(formData.get('reportingDoctor') || '').trim(),
        location: String(formData.get('location') || '').trim(),
        hospitalName: String(formData.get('hospitalName') || '').trim(),
        degree: String(formData.get('degree') || '').trim(),
        contactNo: String(formData.get('contactNo') || '').trim(),
        confirmationStatus: String(formData.get('confirmationStatus') || 'pending').trim().toLowerCase(),
        confirmationRemarks: String(formData.get('confirmationRemarks') || '').trim(),
        verified: String(formData.get('verified') || '0') === '1'
      };

      if (!doctor.doctorName || !reason) {
        notify('Doctor name and reason are required', true);
        return;
      }

      try {
        await api('/api/reference/doctors/request-add', {
          method: 'POST',
          body: { reason, doctor }
        });
        notify('Doctor addition request submitted');
        event.currentTarget.reset();
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.getElementById('doctor-search-btn').addEventListener('click', () => {
      state.doctorSearch = document.getElementById('doctor-search').value.trim();
      renderReferenceTablesPage();
    });

    document.getElementById('requirements-search-btn').addEventListener('click', () => {
      setTableSearch('requirements', document.getElementById('requirements-search').value);
      renderReferenceTablesPage();
    });

    document.querySelectorAll('[data-verify-doctor-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.verifyDoctorId;
        const next = Number(button.dataset.next);
        try {
          await api(`/api/reference/doctors/${id}/verify`, {
            method: 'PATCH',
            body: { verified: next === 1 }
          });
          notify('Doctor verification updated');
          renderReferenceTablesPage();
        } catch (error) {
          notify(error.message, true);
        }
      });
    });
  } catch (error) {
    showPageError(content, error);
  }
}

async function renderEnginePage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="panel">Loading RRCP engine...</div>';

  try {
    const runsData = await api('/api/engine/runs?limit=20');
    if (!state.selectedRunId && runsData.runs.length) {
      state.selectedRunId = runsData.runs[0].id;
    }

    const [resultsData, productivityData] = await Promise.all([
      state.selectedRunId
        ? api(
            `/api/engine/results?runId=${state.selectedRunId}&page=1&pageSize=500&flaggedOnly=${String(
              state.flaggedOnly
            )}`
          )
        : Promise.resolve({ rows: [], total: 0 }),
      api(`/api/engine/productivity?year=${state.periodYear}&month=${state.periodMonth}`)
    ]);
    const allEngineRows = Array.isArray(resultsData.rows) ? resultsData.rows : [];
    const searchedEngineRows = filterRowsBySearch(allEngineRows, getTableSearch('engineResults'));
    const filteredEngineRows = filterEngineRows(searchedEngineRows, state.engineResultFilters);
    const filteredProductivityRows = filterRowsBySearch(productivityData.rows, getTableSearch('productivity'));
    const groupOptions = Array.from(
      new Set(
        allEngineRows
          .map((row) => String(row.doctor_group || '').trim())
          .filter((value) => value !== '')
      )
    ).sort((left, right) => left.localeCompare(right));
    const proOptions = Array.from(
      new Set(
        allEngineRows
          .map((row) => String(row.pro_name || '').trim())
          .filter((value) => value !== '')
      )
    ).sort((left, right) => left.localeCompare(right));

    const selectedRun = runsData.runs.find((r) => Number(r.id) === Number(state.selectedRunId));
    const summary = selectedRun?.summary_json ? JSON.parse(selectedRun.summary_json) : null;

    content.innerHTML = `
      ${renderPageHero(
        'Calculation Review',
        'engine',
        'Run the monthly discount logic, review exceptions, and prepare payout entries from validated output.',
        `
          <select class="select" id="engine-year">${yearOptions()}</select>
          <select class="select" id="engine-month">${monthOptions()}</select>
          <button class="btn btn-primary" id="run-engine-btn">Run Monthly Calculation</button>
          <button class="btn btn-secondary" id="gen-payments-btn" ${state.selectedRunId ? '' : 'disabled'}>Create Payout Entries</button>
        `
      )}

      ${renderPageGuide(
        'Calculation Review Guide',
        'engine',
        [
          'Select the month and run the calculation to compute allowed vs actual discount.',
          'Review result rows first to resolve variance and approval needs.',
          'Generate payments only after validating run summary and flags.'
        ],
        'Each run is saved and can be reopened later from the run selector.'
      )}

      <section class="panel compact-summary-panel" style="margin-bottom:10px;">
        <div class="compact-summary-grid">
          <div><span class="summary-label">Selected Run</span><strong>${state.selectedRunId || '-'}</strong></div>
          <div><span class="summary-label">Records</span><strong>${summary ? formatNumber(summary.totalRecords) : '-'}</strong></div>
          <div><span class="summary-label">Flags</span><strong>${summary ? formatNumber(summary.totalFlags) : '-'}</strong></div>
          <div><span class="summary-label">Incentive To Doctors</span><strong>${summary ? formatCurrency(summary.totalPayable) : '-'}</strong></div>
        </div>
      </section>

      <div class="compact-section-grid" style="margin-bottom:10px;">
        <section class="panel compact-card">
          <div class="compact-card-head">
            <div class="compact-card-icon">${icon('engine', 18, 'Run Controls')}</div>
            <div class="compact-card-copy">
              <p class="compact-card-kicker">Run controls</p>
              <h3 class="with-title-icon" style="margin:0;">Current Run Filters</h3>
              <p class="helper compact-card-note">Use the saved run selector and search here to focus the review before moving to payouts.</p>
            </div>
          </div>
          <div class="chip-list">
            <span class="chip-note">Saved runs</span>
            <span class="chip-note">Flagged filter</span>
            <span class="chip-note">Variance review</span>
          </div>
          <div class="form-inline-actions">
            <span class="helper">Run selector is available directly above the result table.</span>
            <button class="btn btn-outline" id="go-payout-center" ${state.selectedRunId ? '' : 'disabled'}>Open Payout Center</button>
          </div>
        </section>

        <section class="panel compact-card">
          <div class="compact-card-head">
            <div class="compact-card-icon">${icon('trend', 18, 'PRO Productivity Projection')}</div>
            <div class="compact-card-copy">
              <p class="compact-card-kicker">Projection</p>
              <h3 class="with-title-icon" style="margin:0;">Productivity Snapshot</h3>
              <p class="helper compact-card-note">Suggested incentives are derived from the selected month’s PRO performance and shown in the projection table below.</p>
            </div>
          </div>
          <div class="chip-list">
            <span class="chip-note">${formatNumber(filteredProductivityRows.length)} PRO rows</span>
            <span class="chip-note">${summary ? formatCurrency(summary.totalPayable) : formatCurrency(0)} doctor incentive</span>
          </div>
        </section>
      </div>

      <section class="panel" style="margin-bottom:14px;">
        <div class="toolbar" style="justify-content:space-between;">
          <div class="toolbar">
            <label for="run-select"><strong>Engine Runs</strong></label>
            <select class="select" id="run-select">
              ${runsData.runs
                .map(
                  (run) =>
                    `<option value="${run.id}" ${
                      Number(run.id) === Number(state.selectedRunId) ? 'selected' : ''
                    }>#${run.id} | ${run.period_year}-${String(run.period_month).padStart(2, '0')} | ${run.total_flags} flags</option>`
                )
                .join('')}
            </select>
            <label class="pill"><input type="checkbox" id="flagged-only" ${state.flaggedOnly ? 'checked' : ''} /> Flagged only</label>
            <input class="input" id="engine-results-search" placeholder="Search doctor / group / PRO / discount / incentive / remark" value="${escapeHtml(
              getTableSearch('engineResults')
            )}" />
            <button class="btn btn-secondary" id="engine-results-search-btn">Search</button>
          </div>
          <span class="helper">Rows shown: ${formatNumber(filteredEngineRows.length)} of ${formatNumber(resultsData.total)}</span>
        </div>

        <div class="table-filter-grid">
          <input class="input" id="engine-filter-doctor" placeholder="Filter doctor" value="${escapeHtml(
            state.engineResultFilters.doctor
          )}" />
          <select class="select" id="engine-filter-group">
            <option value="">All groups</option>
            ${groupOptions
              .map(
                (group) =>
                  `<option value="${escapeHtml(group)}" ${
                    String(state.engineResultFilters.group || '').toLowerCase() === group.toLowerCase() ? 'selected' : ''
                  }>${escapeHtml(group)}</option>`
              )
              .join('')}
          </select>
          <select class="select" id="engine-filter-pro">
            <option value="">All PROs</option>
            ${proOptions
              .map(
                (pro) =>
                  `<option value="${escapeHtml(pro)}" ${
                    String(state.engineResultFilters.pro || '').toLowerCase() === pro.toLowerCase() ? 'selected' : ''
                  }>${escapeHtml(pro)}</option>`
              )
              .join('')}
          </select>
          <input class="input" id="engine-filter-item" placeholder="Filter item / modality" value="${escapeHtml(
            state.engineResultFilters.item
          )}" />
          <select class="select" id="engine-filter-variance">
            <option value="all" ${state.engineResultFilters.variance === 'all' ? 'selected' : ''}>All variance</option>
            <option value="positive" ${state.engineResultFilters.variance === 'positive' ? 'selected' : ''}>Positive</option>
            <option value="zero" ${state.engineResultFilters.variance === 'zero' ? 'selected' : ''}>Zero</option>
            <option value="negative" ${state.engineResultFilters.variance === 'negative' ? 'selected' : ''}>Negative</option>
          </select>
          <input class="input" id="engine-filter-remark" placeholder="Filter remark" value="${escapeHtml(
            state.engineResultFilters.remark
          )}" />
          <button class="btn btn-secondary" id="engine-filter-apply">Apply Filters</button>
          <button class="btn btn-outline" id="engine-filter-clear">Clear</button>
        </div>

        <div class="table-wrap" style="margin-top:10px;">
          <table>
            <thead>
              <tr>
                <th>Doctor</th>
                <th>Group</th>
                <th>PRO</th>
                <th>Item/Modality</th>
                <th>Total Discount Amount</th>
                <th>Incentive To Doctors</th>
                <th>Sum Of Both</th>
                <th>Allowed</th>
                <th>Variance</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              ${Array.isArray(filteredEngineRows) && filteredEngineRows.length
                ? filteredEngineRows
                .map((row) => {
                  const groupCode = String(row.doctor_group || '').trim().toUpperCase();
                  let totalDiscountAmount = Number(row.actual_discount || 0);
                  let incentiveToDoctors = Number(row.payable_discount || 0);
                  if (groupCode === 'A') {
                    totalDiscountAmount = 0;
                    incentiveToDoctors = 0;
                  } else if (groupCode === 'B' || groupCode === 'C') {
                    totalDiscountAmount = Number(row.allowed_discount || 0);
                    incentiveToDoctors = 0;
                  }
                  const combinedTotal = totalDiscountAmount + incentiveToDoctors;
                  const forceVarianceBad = Number(row.group_rule_violation || 0) === 1;
                  return `
                    <tr>
                      <td>${escapeHtml(row.doctor_name || '-')}</td>
                      <td>${escapeHtml(row.doctor_group || '-')}</td>
                      <td>${escapeHtml(row.pro_name || '-')}</td>
                      <td class="cell-wrap"><span class="cell-primary">${escapeHtml(formatEngineItemModality(row))}</span></td>
                      <td>${formatCurrency(totalDiscountAmount)}</td>
                      <td>${formatCurrency(incentiveToDoctors)}</td>
                      <td>${formatCurrency(combinedTotal)}</td>
                      <td>${formatCurrency(row.allowed_discount)}</td>
                      <td>${varianceBadge(row.variance, forceVarianceBad)}</td>
                      <td>${escapeHtml(row.remark || '-')}</td>
                    </tr>
                  `;
                })
                .join('')
                : renderNoRows(10, 'No engine result rows. Run calculation for this period first.')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="page-head" style="margin-bottom:8px;">
          <h3 class="with-title-icon" style="margin:0;">${icon('trend', 18, 'PRO Productivity Projection')}PRO Productivity Projection</h3>
          <div class="toolbar">
            <input class="input" id="productivity-search" placeholder="Search PRO / case / net / projection" value="${escapeHtml(
              getTableSearch('productivity')
            )}" />
            <button class="btn btn-secondary" id="productivity-search-btn">Search</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PRO</th>
                <th>Total Cases</th>
                <th>Total Net</th>
                <th>Projected Monthly</th>
                <th>Suggested Incentive</th>
              </tr>
            </thead>
            <tbody>
              ${Array.isArray(filteredProductivityRows) && filteredProductivityRows.length
                ? filteredProductivityRows
                .map(
                  (row) => `
                    <tr>
                      <td>${escapeHtml(row.proName)}</td>
                      <td>${formatNumber(row.totalCases)}</td>
                      <td>${formatCurrency(row.totalNet)}</td>
                      <td>${formatCurrency(row.projectedMonthly)}</td>
                      <td>${formatCurrency(row.suggestedIncentive)}</td>
                    </tr>
                  `
                )
                .join('')
                : renderNoRows(5, 'No productivity data available for selected period.')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('run-engine-btn').addEventListener('click', async () => {
      state.periodYear = Number(document.getElementById('engine-year').value);
      state.periodMonth = Number(document.getElementById('engine-month').value);

      try {
        const response = await api('/api/engine/run', {
          method: 'POST',
          body: {
            year: state.periodYear,
            month: state.periodMonth
          }
        });
        state.selectedRunId = response.runId;
        notify(`Engine run ${response.runId} completed`);
        renderEnginePage();
      } catch (error) {
        notify(error.message, true);
      }
    });

    const runSelect = document.getElementById('run-select');
    if (runSelect) {
      runSelect.addEventListener('change', () => {
        state.selectedRunId = Number(runSelect.value);
        renderEnginePage();
      });
    }

    document.getElementById('flagged-only').addEventListener('change', (event) => {
      state.flaggedOnly = !!event.target.checked;
      renderEnginePage();
    });

    document.getElementById('engine-results-search-btn').addEventListener('click', () => {
      setTableSearch('engineResults', document.getElementById('engine-results-search').value);
      renderEnginePage();
    });

    document.getElementById('engine-filter-apply').addEventListener('click', () => {
      state.engineResultFilters = {
        doctor: document.getElementById('engine-filter-doctor').value.trim(),
        group: document.getElementById('engine-filter-group').value.trim(),
        pro: document.getElementById('engine-filter-pro').value.trim(),
        item: document.getElementById('engine-filter-item').value.trim(),
        variance: document.getElementById('engine-filter-variance').value,
        remark: document.getElementById('engine-filter-remark').value.trim()
      };
      renderEnginePage();
    });

    document.getElementById('engine-filter-clear').addEventListener('click', () => {
      state.engineResultFilters = {
        doctor: '',
        group: '',
        pro: '',
        item: '',
        variance: 'all',
        remark: ''
      };
      renderEnginePage();
    });

    document.getElementById('productivity-search-btn').addEventListener('click', () => {
      setTableSearch('productivity', document.getElementById('productivity-search').value);
      renderEnginePage();
    });

    document.getElementById('go-payout-center').addEventListener('click', () => {
      setPage('payout-center');
    });

    document.getElementById('gen-payments-btn').addEventListener('click', async () => {
      if (!state.selectedRunId) return;
      try {
        const result = await api('/api/payments/generate', {
          method: 'POST',
          body: { runId: state.selectedRunId }
        });
        notify(`Payments generated: ${result.generated}`);
        setPage('payout-center');
      } catch (error) {
        notify(error.message, true);
      }
    });
  } catch (error) {
    showPageError(content, error);
  }
}

async function renderPaymentsPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="panel">Loading payout center...</div>';

  try {
    const showApprovalsSection = !userIsDoctor();
    const allowPayoutEdits = !userIsDoctor();
    const [data, approvalsData] = await Promise.all([
      api(`/api/payments?year=${state.periodYear}&month=${state.periodMonth}`),
      showApprovalsSection
        ? api(`/api/approvals?status=${encodeURIComponent(state.approvalStatusFilter)}`)
        : Promise.resolve({ rows: [] })
    ]);
    const paymentRows = Array.isArray(data.rows) ? data.rows : [];
    const payoutsById = new Map(paymentRows.map((row) => [Number(row.id), row]));
    const filteredPaymentRows = filterRowsBySearch(paymentRows, getTableSearch('payments'));
    const filteredApprovalRows = filterRowsBySearch(approvalsData.rows, getTableSearch('approvals'));
    const approvalCount = Array.isArray(approvalsData.rows) ? approvalsData.rows.length : 0;
    const paymentOptions = paymentRows
      .map(
        (row) =>
          `<option value="${row.id}">${escapeHtml(row.doctor_name || 'Doctor')} | ${escapeHtml(row.pro_name || 'PRO')} | ${escapeHtml(
            formatCurrency(row.amount)
          )}</option>`
      )
      .join('');

    content.innerHTML = `
      ${renderPageHero(
        'Payout Center',
        'wallet',
        'Process approvals, update payout status, track cash in hand, and lock completed months from one place.',
        `
          <select class="select" id="pay-year">${yearOptions()}</select>
          <select class="select" id="pay-month">${monthOptions()}</select>
          <button class="btn btn-secondary" id="pay-refresh">Apply Filters</button>
        `
      )}

      ${renderPageGuide(
        'Payout Center Guide',
        'wallet',
        [
          'Use the period filter to load payout entries for the month.',
          'Update payout status, approval status, and cash-in-hand in one place.',
          showApprovalsSection ? 'Review approval requests below before final disbursal.' : 'Track your payout status and follow up through Support if anything looks wrong.'
        ],
        userIsDoctor()
          ? 'Doctor users can review only their own payout rows.'
          : 'This page combines payouts, approvals, and period control.'
      )}

      <div class="grid-4" style="margin-bottom:14px;">
        <div class="kpi"><div class="label">Total Entries</div><div class="value">${formatNumber(data.summary.total)}</div></div>
        <div class="kpi"><div class="label">Base Amount</div><div class="value">${formatCurrency(data.summary.total_amount)}</div></div>
        <div class="kpi"><div class="label">Final Payable</div><div class="value">${formatCurrency(data.summary.final_amount)}</div></div>
        <div class="kpi"><div class="label">Pending Approval</div><div class="value">${formatCurrency(
          data.summary.pending_approval_amount
        )}</div></div>
        <div class="kpi"><div class="label">${showApprovalsSection ? 'Approval Requests' : 'Paid'}</div><div class="value">${
          showApprovalsSection ? formatNumber(approvalCount) : formatCurrency(data.summary.paid_amount)
        }</div></div>
      </div>

      <section class="panel compact-summary-panel" style="margin-bottom:14px;">
        <div class="compact-summary-grid">
          <div><span class="summary-label">Adjustments</span><strong>${formatCurrency(data.summary.total_adjustments)}</strong></div>
          <div><span class="summary-label">Advance Payments</span><strong>${formatCurrency(data.summary.total_advance)}</strong></div>
          <div><span class="summary-label">Returned Incentive</span><strong>${formatCurrency(data.summary.total_return_incentive)}</strong></div>
        </div>
      </section>

      ${
        showApprovalsSection
          ? `
            <div class="grid-2" style="margin-bottom:14px;">
              <section class="panel panel-accent request-panel">
                <div class="request-card-head">
                  <div class="request-card-icon">${icon('approval', 18, 'Override Incentive Amount')}</div>
                  <div class="request-card-copy">
                    <p class="request-card-kicker">Calculation exception</p>
                    <h3 class="with-title-icon" style="margin:0;">Override Incentive Amount</h3>
                    <p class="helper request-card-note">Submit an approval request when the payout amount needs a controlled override instead of changing the row directly.</p>
                  </div>
                </div>
                <div class="request-chip-row">
                  <span class="request-chip">Approval required</span>
                  <span class="request-chip">Audit trail preserved</span>
                </div>
                <form id="override-request-form" class="form-grid">
                  ${renderField(
                    'Payout row',
                    `<select class="select" id="override-payment-id" name="paymentId" ${paymentRows.length ? '' : 'disabled'}>
                      <option value="">Select payout row</option>
                      ${paymentOptions}
                    </select>`,
                    'Choose the payout row that needs incentive override approval.'
                  )}
                  ${renderField(
                    'Current amount',
                    '<input class="input" id="override-current-amount" type="text" value="-" readonly />'
                  )}
                  <div class="input-row">
                    ${renderField(
                      'New amount',
                      '<input class="input" id="override-new-amount" name="newAmount" type="number" min="0" step="0.01" placeholder="Enter approved amount" required />'
                    )}
                    ${renderField(
                      'Run ID',
                      '<input class="input" id="override-run-id" type="text" value="-" readonly />'
                    )}
                  </div>
                  ${renderField(
                    'Reason for override',
                    '<textarea class="textarea" id="override-reason" name="reason" placeholder="Explain why the incentive amount needs to change" required></textarea>'
                  )}
                  <button class="btn btn-secondary" type="submit" ${paymentRows.length ? '' : 'disabled'}>Submit Override Request</button>
                </form>
              </section>

              <section class="panel panel-accent request-panel">
                <div class="request-card-head">
                  <div class="request-card-icon">${icon('lock', 18, 'Payout Control Rules')}</div>
                  <div class="request-card-copy">
                    <p class="request-card-kicker">Disbursal control</p>
                    <h3 class="with-title-icon" style="margin:0;">Payout Control Rules</h3>
                    <p class="helper request-card-note">These rules explain why a payout may stay on hold even after calculation is complete.</p>
                  </div>
                </div>
                <ul class="helper request-note-list">
                  <li>Fresh disbursal is blocked while PRO cash in hand or manager cash in hand is above zero.</li>
                  <li>Use the adjustment, advance, and return columns on each payout row to reach the true final payable amount.</li>
                  <li>Record cashier and PRO handover times so delay tracking is visible in the same table.</li>
                  <li>Approved disbursal requests are still reviewed in the approval queue below before month lock.</li>
                </ul>
              </section>
            </div>
          `
          : ''
      }

      <section class="panel" style="margin-bottom:14px;">
        <div class="page-head" style="margin-bottom:8px;">
          <h3 class="with-title-icon" style="margin:0;">${icon('wallet', 18, 'Payout Entries')}Payout Entries</h3>
          <div class="toolbar">
            <input class="input" id="payments-search" placeholder="Search doctor / PRO / amount / status / cash / notes" value="${escapeHtml(
              getTableSearch('payments')
            )}" />
            <button class="btn btn-secondary" id="payments-search-btn">Search</button>
          </div>
        </div>
        <p class="helper">Update adjustments, advance payment, returned incentive, handover times, and cash balances directly in this table. Final payable updates automatically.</p>
        <div class="table-wrap">
          <table class="payout-table">
            <thead>
              <tr>
                <th>Doctor</th>
                <th>PRO</th>
                <th>Base Amount</th>
                <th>Adjustment</th>
                <th>Advance</th>
                <th>Return</th>
                <th>Final Payable</th>
                <th>Status</th>
                <th>Approval</th>
                <th>PRO Cash In Hand</th>
                <th>Manager Cash In Hand</th>
                <th>Cashier Handover</th>
                <th>PRO Handover</th>
                <th>Delay</th>
                <th>Disbursed On</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${Array.isArray(filteredPaymentRows) && filteredPaymentRows.length
                ? filteredPaymentRows
                .map(
                  (row) => `
                    <tr class="status-row status-${escapeHtml(String(row.status || 'pending').toLowerCase())}">
                      <td>
                        <span class="cell-primary">${escapeHtml(row.doctor_name || '-')}</span>
                        <span class="cell-meta">Period: ${escapeHtml(
                          `${monthNames[Math.max(0, Number(row.period_month || 1) - 1)] || row.period_month || '-'} ${row.period_year || ''}`.trim()
                        )}</span>
                      </td>
                      <td>
                        <span class="cell-primary">${escapeHtml(row.pro_name || '-')}</span>
                        <span class="cell-meta">Run: ${escapeHtml(row.run_id || '-')}</span>
                      </td>
                      <td>
                        <span class="table-metric">${formatCurrency(row.amount)}</span>
                      </td>
                      <td>${
                        allowPayoutEdits
                          ? `<input class="input" data-payment-adjustment-id="${row.id}" type="number" step="0.01" value="${escapeHtml(
                              row.adjustment_amount || 0
                            )}" />`
                          : formatCurrency(row.adjustment_amount || 0)
                      }</td>
                      <td>${
                        allowPayoutEdits
                          ? `<input class="input" data-payment-advance-id="${row.id}" type="number" step="0.01" value="${escapeHtml(
                              row.advance_payment || 0
                            )}" />`
                          : formatCurrency(row.advance_payment || 0)
                      }</td>
                      <td>${
                        allowPayoutEdits
                          ? `<input class="input" data-payment-return-id="${row.id}" type="number" step="0.01" value="${escapeHtml(
                              row.return_incentive_amount || 0
                            )}" />`
                          : formatCurrency(row.return_incentive_amount || 0)
                      }</td>
                      <td><span class="table-metric table-metric-strong">${formatCurrency(computePaymentFinalAmount(row))}</span></td>
                      <td>
                        ${
                          allowPayoutEdits
                            ? `<select class="select" data-payment-status-id="${row.id}">
                                ${['pending', 'on_hold', 'paid'].map(
                                  (s) => `<option value="${s}" ${row.status === s ? 'selected' : ''}>${toReadableLabel(s)}</option>`
                                )}
                              </select>`
                            : badge(
                                toReadableLabel(row.status || 'pending'),
                                row.status === 'paid' ? 'good' : row.status === 'on_hold' ? 'warn' : 'neutral'
                              )
                        }
                      </td>
                      <td>
                        ${
                          allowPayoutEdits
                            ? `<select class="select" data-payment-approval-id="${row.id}">
                                ${['pending', 'approved', 'rejected'].map(
                                  (s) => `<option value="${s}" ${row.approval_status === s ? 'selected' : ''}>${toReadableLabel(s)}</option>`
                                )}
                              </select>`
                            : badge(
                                toReadableLabel(row.approval_status || 'pending'),
                                row.approval_status === 'approved'
                                  ? 'good'
                                  : row.approval_status === 'rejected'
                                    ? 'bad'
                                    : 'warn'
                              )
                        }
                      </td>
                      <td>${
                        allowPayoutEdits
                          ? `<input class="input" data-payment-pro-cash-id="${row.id}" type="number" step="0.01" value="${escapeHtml(
                              row.pro_cash_in_hand ?? row.cash_in_hand_snapshot ?? 0
                            )}" />`
                          : formatCurrency(row.pro_cash_in_hand ?? row.cash_in_hand_snapshot ?? 0)
                      }</td>
                      <td>${
                        allowPayoutEdits
                          ? `<input class="input" data-payment-manager-cash-id="${row.id}" type="number" step="0.01" value="${escapeHtml(
                              row.manager_cash_in_hand || 0
                            )}" />`
                          : formatCurrency(row.manager_cash_in_hand || 0)
                      }</td>
                      <td>${
                        allowPayoutEdits
                          ? `<input class="input" data-payment-cashier-id="${row.id}" type="datetime-local" value="${escapeHtml(
                              formatDateTimeInputValue(row.cashier_handover_at)
                            )}" />`
                          : escapeHtml(formatDate(row.cashier_handover_at))
                      }</td>
                      <td>${
                        allowPayoutEdits
                          ? `<input class="input" data-payment-pro-handover-id="${row.id}" type="datetime-local" value="${escapeHtml(
                              formatDateTimeInputValue(row.pro_handover_at)
                            )}" />`
                          : escapeHtml(formatDate(row.pro_handover_at))
                      }</td>
                      <td>
                        <span class="cell-primary">Cashier: ${escapeHtml(formatDelayBetween(row.created_at, row.cashier_handover_at))}</span>
                        <span class="cell-meta">PRO: ${escapeHtml(
                          formatDelayBetween(row.cashier_handover_at, row.pro_handover_at || row.disbursed_on)
                        )}</span>
                      </td>
                      <td>${escapeHtml(formatDate(row.disbursed_on))}</td>
                      <td>${
                        allowPayoutEdits
                          ? `<textarea class="textarea table-textarea" data-payment-notes-id="${row.id}" placeholder="Notes">${escapeHtml(
                              row.notes || ''
                            )}</textarea>`
                          : escapeHtml(row.notes || '-')
                      }</td>
                      <td>${allowPayoutEdits ? `<button class="btn btn-primary" data-save-payment-id="${row.id}">Save</button>` : '-'}</td>
                    </tr>
                  `
                )
                .join('')
                : renderNoRows(17, 'No payment rows found for this period. Generate payouts after engine run.')}
            </tbody>
          </table>
        </div>
      </section>

      ${
        showApprovalsSection
          ? `
            <section class="panel">
              <div class="page-head" style="margin-bottom:8px;">
                <h3 class="with-title-icon" style="margin:0;">${icon('approval', 18, 'Approval Requests')}Approval Requests</h3>
                <div class="toolbar">
                  <select class="select" id="approval-filter">
                    ${['pending', 'approved', 'rejected'].map(
                      (status) =>
                        `<option value="${status}" ${state.approvalStatusFilter === status ? 'selected' : ''}>${toReadableLabel(status)}</option>`
                    )}
                  </select>
                  <input class="input" id="approvals-search" placeholder="Search type / requester / details" value="${escapeHtml(
                    getTableSearch('approvals')
                  )}" />
                  <button class="btn btn-secondary" id="approval-refresh">Apply Filter</button>
                </div>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Type</th>
                      <th>Entity</th>
                      <th>Requested By</th>
                      <th>Status</th>
                      <th>Details</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${Array.isArray(filteredApprovalRows) && filteredApprovalRows.length
                      ? filteredApprovalRows
                          .map(
                            (row) => `
                              <tr>
                                <td>${row.id}</td>
                                <td>${escapeHtml(toReadableLabel(row.type))}</td>
                                <td>${escapeHtml(row.entity_id || '-')}</td>
                                <td>${escapeHtml(row.requested_by || '-')}</td>
                                <td>${
                                  row.status === 'pending'
                                    ? badge('Pending', 'warn')
                                    : row.status === 'approved'
                                      ? badge('Approved', 'good')
                                      : badge('Rejected', 'bad')
                                }</td>
                                <td>${renderReadablePayload(row.payload_json)}</td>
                                <td>
                                  ${
                                    row.status === 'pending' && userCanAdmin()
                                      ? `<div class="table-actions">
                                          <button class="btn btn-good" data-approval-action="approved" data-id="${row.id}">Approve</button>
                                          <button class="btn btn-danger" data-approval-action="rejected" data-id="${row.id}">Reject</button>
                                        </div>`
                                      : '-'
                                  }
                                </td>
                              </tr>
                            `
                          )
                          .join('')
                      : renderNoRows(7, 'No approval requests found for this status.')}
                  </tbody>
                </table>
              </div>
            </section>
          `
          : ''
      }
    `;

    document.getElementById('pay-refresh').addEventListener('click', () => {
      state.periodYear = Number(document.getElementById('pay-year').value);
      state.periodMonth = Number(document.getElementById('pay-month').value);
      renderPaymentsPage();
    });

    document.getElementById('payments-search-btn').addEventListener('click', () => {
      setTableSearch('payments', document.getElementById('payments-search').value);
      renderPaymentsPage();
    });

    const syncOverrideSelection = () => {
      const selectedId = Number(document.getElementById('override-payment-id')?.value || 0);
      const row = payoutsById.get(selectedId);
      const currentAmountInput = document.getElementById('override-current-amount');
      const runIdInput = document.getElementById('override-run-id');
      if (currentAmountInput) {
        currentAmountInput.value = row ? formatCurrency(row.amount) : '-';
      }
      if (runIdInput) {
        runIdInput.value = row?.run_id ? String(row.run_id) : '-';
      }
    };

    document.getElementById('override-payment-id')?.addEventListener('change', syncOverrideSelection);
    syncOverrideSelection();

    document.getElementById('override-request-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const paymentId = Number(document.getElementById('override-payment-id')?.value || 0);
      const row = payoutsById.get(paymentId);
      const newAmount = Number(document.getElementById('override-new-amount')?.value || 0);
      const reason = String(document.getElementById('override-reason')?.value || '').trim();

      if (!row || !paymentId) {
        notify('Select a payout row first', true);
        return;
      }

      if (!reason) {
        notify('Reason is required for override request', true);
        return;
      }

      try {
        await api('/api/engine/override-incentive', {
          method: 'POST',
          body: {
            runId: row.run_id ? Number(row.run_id) : null,
            paymentId,
            oldAmount: Number(row.amount || 0),
            newAmount,
            reason
          }
        });
        notify('Override request submitted');
        event.currentTarget.reset();
        syncOverrideSelection();
      } catch (error) {
        notify(error.message, true);
      }
    });

    document.querySelectorAll('[data-save-payment-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.savePaymentId;
        const status = document.querySelector(`[data-payment-status-id="${id}"]`).value;
        const approvalStatus = document.querySelector(`[data-payment-approval-id="${id}"]`).value;
        const proCashInHand = Number(document.querySelector(`[data-payment-pro-cash-id="${id}"]`).value || 0);
        const managerCashInHand = Number(document.querySelector(`[data-payment-manager-cash-id="${id}"]`).value || 0);
        const adjustmentAmount = Number(document.querySelector(`[data-payment-adjustment-id="${id}"]`).value || 0);
        const advancePayment = Number(document.querySelector(`[data-payment-advance-id="${id}"]`).value || 0);
        const returnIncentiveAmount = Number(document.querySelector(`[data-payment-return-id="${id}"]`).value || 0);
        const cashierHandoverAt = document.querySelector(`[data-payment-cashier-id="${id}"]`).value || '';
        const proHandoverAt = document.querySelector(`[data-payment-pro-handover-id="${id}"]`).value || '';
        const notes = document.querySelector(`[data-payment-notes-id="${id}"]`).value || '';
        try {
          await api(`/api/payments/${id}`, {
            method: 'PATCH',
            body: {
              status,
              approvalStatus,
              adjustmentAmount,
              advancePayment,
              returnIncentiveAmount,
              proCashInHand,
              managerCashInHand,
              cashierHandoverAt,
              proHandoverAt,
              notes
            }
          });
          notify('Payment updated');
          renderPaymentsPage();
        } catch (error) {
          notify(error.message, true);
        }
      });
    });

    const approvalRefresh = document.getElementById('approval-refresh');
    if (approvalRefresh) {
      approvalRefresh.addEventListener('click', () => {
        state.approvalStatusFilter = document.getElementById('approval-filter').value;
        setTableSearch('approvals', document.getElementById('approvals-search').value);
        renderPaymentsPage();
      });
    }

    document.querySelectorAll('[data-approval-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api(`/api/approvals/${button.dataset.id}`, {
            method: 'PATCH',
            body: { status: button.dataset.approvalAction }
          });
          notify('Approval updated');
          renderPaymentsPage();
        } catch (error) {
          notify(error.message, true);
        }
      });
    });

    if (userCanAdmin()) {
      const lockSection = await renderPeriodLockControl();
      content.appendChild(lockSection);
    }
  } catch (error) {
    showPageError(content, error);
  }
}

async function renderReportsPage() {
  const content = document.getElementById('page-content');
  const isDoctor = userIsDoctor();
  const linkedDoctorName = state.user?.doctorName || '';
  const doctorLinked = !isDoctor || linkedDoctorName !== '';

  content.innerHTML = `
    ${renderPageHero(
      'Reports',
      'reports',
      'Export doctor-level and grouped monthly reports for audit, reconciliation, and payout review.'
    )}
    ${renderPageGuide(
      'Reports Guide',
      'reports',
      isDoctor
        ? [
            'Select period and download your own individual report.',
            'Use report output to validate your payable rows and transactions.',
            'Contact admin if your doctor profile is not linked.'
          ]
        : [
            'Use Individual Report for one doctor review and audit.',
            'Use Multiple Report to summarize by PRO, doctor, or group.',
            'Always select year and month before exporting CSV.'
          ],
      isDoctor
        ? 'Doctor accounts can access only their own individual report.'
        : 'Admin, mapper, and accountant accounts can export both report types.'
    )}
    <div class="compact-section-grid">
      <section class="panel compact-card report-card">
        <div class="compact-card-head">
          <div class="compact-card-icon">${icon('wallet', 18, 'Individual Report')}</div>
          <div class="compact-card-copy">
            <p class="compact-card-kicker">Doctor level export</p>
            <h3 class="with-title-icon" style="margin:0;">Individual Report</h3>
            <p class="helper compact-card-note">Use this when you want the full monthly detail for one doctor.</p>
          </div>
        </div>
        <div class="chip-list">
          <span class="chip-note">Doctor audit</span>
          <span class="chip-note">CSV export</span>
          <span class="chip-note">Monthly detail</span>
        </div>
        <form id="individual-report-form" class="form-grid">
          ${
            isDoctor
              ? `${renderField(
                  'Linked doctor',
                  `<input class="input" value="${escapeHtml(linkedDoctorName || 'Doctor profile not linked')}" disabled />
                   <input type="hidden" name="doctor" value="${escapeHtml(linkedDoctorName)}" />`
                )}`
              : renderField(
                  'Doctor name',
                  '<input class="input" name="doctor" placeholder="Enter exact doctor name" required />',
                  'Use the same doctor name as shown in Doctor Master.'
                )
          }
          <div class="input-row">
            ${renderField('Year', `<select class="select" name="year">${yearOptions()}</select>`)}
            ${renderField('Month', `<select class="select" name="month">${monthOptions()}</select>`)}
          </div>
          <button class="btn btn-primary" type="submit" ${doctorLinked ? '' : 'disabled'}>Download Individual Report</button>
        </form>
        ${
          isDoctor && !doctorLinked
            ? '<p class="helper">Your account is not linked to a doctor profile. Contact admin.</p>'
            : ''
        }
      </section>

      ${
        isDoctor
          ? ''
          : `<section class="panel compact-card report-card">
              <div class="compact-card-head">
                <div class="compact-card-icon">${icon('reports', 18, 'Multiple Report')}</div>
                <div class="compact-card-copy">
                  <p class="compact-card-kicker">Grouped summary</p>
                  <h3 class="with-title-icon" style="margin:0;">Multiple Report</h3>
                  <p class="helper compact-card-note">Use this summary export when you want totals grouped by PRO, doctor, or incentive group.</p>
                </div>
              </div>
              <div class="chip-list">
                <span class="chip-note">PRO summary</span>
                <span class="chip-note">Doctor summary</span>
                <span class="chip-note">Group summary</span>
              </div>
              <form id="multiple-report-form" class="form-grid">
                <div class="input-row">
                  ${renderField('Year', `<select class="select" name="year">${yearOptions()}</select>`)}
                  ${renderField('Month', `<select class="select" name="month">${monthOptions()}</select>`)}
                </div>
                ${renderField(
                  'Group report by',
                  `<select class="select" name="groupBy">
                    <option value="pro">Group by PRO</option>
                    <option value="doctor">Group by Doctor</option>
                    <option value="group">Group by Incentive Group</option>
                  </select>`
                )}
                <button class="btn btn-secondary" type="submit">Download Multiple Report</button>
              </form>
            </section>`
      }
    </div>
  `;

  document.getElementById('individual-report-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!doctorLinked) return;
    const formData = new FormData(event.currentTarget);
    try {
      const individualUrl = userIsDoctor()
        ? `/api/reports/individual?year=${encodeURIComponent(formData.get('year'))}&month=${encodeURIComponent(
            formData.get('month')
          )}`
        : `/api/reports/individual?doctor=${encodeURIComponent(formData.get('doctor'))}&year=${encodeURIComponent(
            formData.get('year')
          )}&month=${encodeURIComponent(formData.get('month'))}`;
      const blob = await api(
        individualUrl
      );
      saveBlob(blob, `individual-report-${Date.now()}.csv`);
    } catch (error) {
      notify(error.message, true);
    }
  });

  const multipleForm = document.getElementById('multiple-report-form');
  if (multipleForm) {
    multipleForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      try {
        const blob = await api(
          `/api/reports/multiple?year=${encodeURIComponent(formData.get('year'))}&month=${encodeURIComponent(
            formData.get('month')
          )}&groupBy=${encodeURIComponent(formData.get('groupBy'))}`
        );
        saveBlob(blob, `multiple-report-${Date.now()}.csv`);
      } catch (error) {
        notify(error.message, true);
      }
    });
  }
}

async function renderApprovalsPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="panel">Loading approvals...</div>';

  try {
    const data = await api(`/api/approvals?status=${encodeURIComponent(state.approvalStatusFilter)}`);
    const filteredRows = filterRowsBySearch(data.rows, getTableSearch('approvals'));

      content.innerHTML = `
      <div class="page-head">
        ${pageTitle('Approvals', 'approval')}
        <div class="toolbar">
          <select class="select" id="approval-filter">
            ${['pending', 'approved', 'rejected'].map(
              (status) => `<option value="${status}" ${state.approvalStatusFilter === status ? 'selected' : ''}>${toReadableLabel(status)}</option>`
            )}
          </select>
          <input class="input" id="approvals-search" placeholder="Search type / requester / details" value="${escapeHtml(
            getTableSearch('approvals')
          )}" />
          <button class="btn btn-secondary" id="approval-refresh">Apply Filter</button>
        </div>
      </div>

      ${renderPageGuide(
        'Approvals Guide',
        'approval',
        [
          'Filter by status to focus on pending items first.',
          'Review request details shown in readable format before decision.',
          'Approve or reject to update linked entities like payment/disbursal.'
        ],
        userCanAdmin() ? 'Only admin can take approval actions.' : 'This page is read-only for non-admin users.'
      )}

      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Entity</th>
                <th>Requested By</th>
                <th>Status</th>
                <th>Payload</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${Array.isArray(filteredRows) && filteredRows.length
                ? filteredRows
                .map(
                  (row) => `
                    <tr>
                      <td>${row.id}</td>
                      <td>${escapeHtml(toReadableLabel(row.type))}</td>
                      <td>${escapeHtml(row.entity_id || '-')}</td>
                      <td>${escapeHtml(row.requested_by || '-')}</td>
                      <td>${
                        row.status === 'pending'
                          ? badge('Pending', 'warn')
                          : row.status === 'approved'
                            ? badge('Approved', 'good')
                            : badge('Rejected', 'bad')
                      }</td>
                      <td>${renderReadablePayload(row.payload_json)}</td>
                      <td>
                        ${
                          row.status === 'pending' && userCanAdmin()
                            ? `<div class="table-actions">
                                <button class="btn btn-good" data-approval-action="approved" data-id="${row.id}">Approve</button>
                                <button class="btn btn-danger" data-approval-action="rejected" data-id="${row.id}">Reject</button>
                              </div>`
                            : '-'
                        }
                      </td>
                    </tr>
                  `
                )
                .join('')
                : renderNoRows(7, 'No approval requests found for this status.')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('approval-refresh').addEventListener('click', () => {
      state.approvalStatusFilter = document.getElementById('approval-filter').value;
      setTableSearch('approvals', document.getElementById('approvals-search').value);
      renderApprovalsPage();
    });

    document.querySelectorAll('[data-approval-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api(`/api/approvals/${button.dataset.id}`, {
            method: 'PATCH',
            body: { status: button.dataset.approvalAction }
          });
          notify('Approval updated');
          renderApprovalsPage();
        } catch (error) {
          notify(error.message, true);
        }
      });
    });
  } catch (error) {
    showPageError(content, error);
  }
}

async function renderContactPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div class="panel">Loading contact form...</div>';

  let adminMessages = [];
  if (userCanAdmin()) {
    try {
      const response = await api('/api/contact');
      adminMessages = response.rows;
    } catch (_error) {
      // ignore
    }
  }
  const filteredMessages = filterRowsBySearch(adminMessages, getTableSearch('contact'));

  content.innerHTML = `
    ${renderPageHero(
      'Support',
      'mail',
      'Use support for mapping issues, payout clarification, access requests, and data corrections that need follow-up.'
    )}
    ${renderPageGuide(
      'Support Guide',
      'mail',
      [
        'Submit a clear subject and include the month or doctor name where relevant.',
        'Use this page for mapping issues, payout clarification, and access requests.',
        'Admin users can review all incoming support messages in the inbox.'
      ],
      'For urgent data correction, include the doctor name, period, and visit date in your message.'
    )}
    <div class="compact-section-grid">
      <section class="panel compact-card support-card">
        <div class="compact-card-head">
          <div class="compact-card-icon">${icon('mail', 18, 'Submit Support Request')}</div>
          <div class="compact-card-copy">
            <p class="compact-card-kicker">New request</p>
            <h3 class="with-title-icon" style="margin:0;">Submit Support Request</h3>
            <p class="helper compact-card-note">Keep the subject clear and include the doctor name, period, and issue type in the message.</p>
          </div>
        </div>
        <div class="chip-list">
          <span class="chip-note">Mapping issue</span>
          <span class="chip-note">Payout clarification</span>
          <span class="chip-note">Access request</span>
        </div>
        <form id="contact-form" class="form-grid">
          ${renderField('Your name', '<input class="input" name="name" placeholder="Enter your name" required />')}
          ${renderField('Your email', '<input class="input" name="email" type="email" placeholder="Enter your email" required />')}
          ${renderField('Subject', '<input class="input" name="subject" placeholder="What do you need help with?" required />')}
          ${renderField(
            'Message',
            '<textarea class="textarea" name="message" placeholder="Include doctor name, period, and issue details" required></textarea>',
            'Adding the doctor name and month helps admin resolve issues faster.'
          )}
          <button class="btn btn-primary" type="submit">Submit</button>
        </form>
        <p class="footer-note">AcctAbility, D-9 Ground floor, Sector-3, Gautam Buddha Nagar, Noida, Uttar Pradesh - 201301.</p>
      </section>

      <section class="panel compact-card support-card">
        <div class="page-head" style="margin-bottom:8px;">
          <h3 class="with-title-icon" style="margin:0;">${icon('mail', 18, 'Inbox')}Inbox</h3>
          ${
            userCanAdmin()
              ? `<div class="toolbar">
                  <input class="input" id="contact-search" placeholder="Search name / email / subject" value="${escapeHtml(
                    getTableSearch('contact')
                  )}" />
                  <button class="btn btn-secondary" id="contact-search-btn">Search</button>
                </div>`
              : ''
          }
        </div>
        ${
          userCanAdmin()
            ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Subject</th><th>Created</th></tr></thead><tbody>
                ${Array.isArray(filteredMessages) && filteredMessages.length
                  ? filteredMessages
                  .map(
                    (m) => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.email)}</td><td>${escapeHtml(
                        m.subject
                      )}</td><td>${escapeHtml(formatDate(m.created_at))}</td></tr>`
                  )
                  .join('')
                  : renderNoRows(4, 'No contact messages submitted yet.')}
               </tbody></table></div>`
            : '<p class="helper">Submitted messages are visible to admin users.</p>'
        }
      </section>
    </div>
  `;

  document.getElementById('contact-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await api('/api/contact', {
        method: 'POST',
        body: {
          name: formData.get('name'),
          email: formData.get('email'),
          subject: formData.get('subject'),
          message: formData.get('message')
        }
      });
      notify('Message submitted');
      event.currentTarget.reset();
      if (userCanAdmin()) renderContactPage();
    } catch (error) {
      notify(error.message, true);
    }
  });

  const contactSearchBtn = document.getElementById('contact-search-btn');
  if (contactSearchBtn) {
    contactSearchBtn.addEventListener('click', () => {
      setTableSearch('contact', document.getElementById('contact-search').value);
      renderContactPage();
    });
  }
}

async function renderPeriodLockControl() {
  const container = document.createElement('section');
  container.className = 'panel';

  try {
    const data = await api('/api/period-locks');
    const filteredLockRows = filterRowsBySearch(data.rows, getTableSearch('locks'));

    container.innerHTML = `
      <div class="page-head" style="margin-bottom:8px;">
        <h3 class="with-title-icon" style="margin:0;">${icon('lock', 18, 'Month Lock Control')}Month Lock Control</h3>
        <div class="toolbar">
          <input class="input" id="locks-search" placeholder="Search year / month / status / reason / by" value="${escapeHtml(
            getTableSearch('locks')
          )}" />
          <button class="btn btn-secondary" id="locks-search-btn">Search</button>
        </div>
      </div>
      ${
        userCanAdmin()
          ? `<form id="lock-form" class="form-grid" style="margin-bottom:10px;">
              <div class="input-row">
                ${renderField('Year', `<select class="select" name="year">${yearOptions()}</select>`)}
                ${renderField('Month', `<select class="select" name="month">${monthOptions()}</select>`)}
              </div>
              <div class="input-row">
                ${renderField(
                  'Action',
                  `<select class="select" name="locked">
                    <option value="1">Lock Period</option>
                    <option value="0">Unlock Period</option>
                  </select>`
                )}
                ${renderField(
                  'Reason',
                  '<input class="input" name="reason" placeholder="Reason for this change" />',
                  'This note is shown in lock history for audit.'
                )}
              </div>
              <button class="btn btn-secondary" type="submit">Save Lock State</button>
            </form>`
          : ''
      }
      <div class="table-wrap">
        <table>
          <thead><tr><th>Year</th><th>Month</th><th>Status</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>
            ${Array.isArray(filteredLockRows) && filteredLockRows.length
              ? filteredLockRows
              .slice(0, 50)
              .map(
                (row) => `<tr><td>${row.period_year}</td><td>${row.period_month}</td><td>${
                  row.is_locked ? badge('Locked', 'bad') : badge('Open', 'good')
                }</td><td>${escapeHtml(row.lock_reason || '-')}</td><td>${escapeHtml(row.locked_by || '-')}</td></tr>`
              )
              .join('')
              : renderNoRows(5, 'No period lock history available yet.')}
          </tbody>
        </table>
      </div>
    `;

    if (userCanAdmin()) {
      container.querySelector('#lock-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        try {
          await api('/api/period-locks', {
            method: 'POST',
            body: {
              year: Number(formData.get('year')),
              month: Number(formData.get('month')),
              locked: formData.get('locked') === '1',
              reason: formData.get('reason')
            }
          });
          notify('Lock state updated');
          await renderActivePage();
        } catch (error) {
          notify(error.message, true);
        }
      });
    }

    container.querySelector('#locks-search-btn').addEventListener('click', () => {
      setTableSearch('locks', container.querySelector('#locks-search').value);
      renderActivePage();
    });
  } catch (error) {
    container.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }

  return container;
}

async function renderActivePage() {
  if (!state.token) {
    renderLogin();
    return;
  }

  state.page = LEGACY_PAGE_MAP[state.page] || state.page;
  const visibleMenuItems = getMenuItemsForUser();
  if (!visibleMenuItems.some((item) => item.id === state.page)) {
    state.page = visibleMenuItems[0]?.id || 'overview';
  }

  renderShell();

  if (state.page === 'overview') {
    await renderDashboardPage();
    return;
  }

  if (state.page === 'monthly-intake') {
    await renderDataInputPage();
    return;
  }

  if (state.page === 'setup-center') {
    await renderReferenceTablesPage();
    return;
  }

  if (state.page === 'calculation-review') {
    await renderEnginePage();
    return;
  }

  if (state.page === 'payout-center') {
    await renderPaymentsPage();
    return;
  }

  if (state.page === 'reports') {
    await renderReportsPage();
    return;
  }

  if (state.page === 'support') {
    await renderContactPage();
    return;
  }

  document.getElementById('page-content').innerHTML = '<div class="panel">Page not found.</div>';
}

function render() {
  renderActivePage().catch((error) => {
    appEl.innerHTML = `<div class="panel" style="margin:20px;">${escapeHtml(error.message)}</div>`;
  });
}

render();
