// ─── Element References ───────────────────────────────────────────────────────
const urlListEl       = document.getElementById('url-list');
const commentPoolEl   = document.getElementById('comment-pool');
const commentError    = document.getElementById('comment-error');
const runBtn          = document.getElementById('run-btn');
const stopBtn         = document.getElementById('stop-btn');
const statusLog       = document.getElementById('status-log');
const clearLogBtn     = document.getElementById('clear-log');
const excelUploadEl   = document.getElementById('excel-upload');
const excelLabelEl    = document.querySelector('label[for="excel-upload"]');
const excelFilenameEl = document.getElementById('excel-filename');
const namaEl          = document.getElementById('input-nama');
const igAccountEl     = document.getElementById('input-ig-account');
const ttAccountEl     = document.getElementById('input-tt-account');
const reportSectionEl = document.getElementById('report-section');
const reportOutputEl  = document.getElementById('report-output');
const copyReportBtn   = document.getElementById('copy-report-btn');

// ─── State ────────────────────────────────────────────────────────────────────
let isRunning  = false;
let excelRows  = [];   // [{ noPosting, tanggalPosting, igUrl, ttUrl }]
let urlMetaMap = {};   // { normalizedUrl → { noPosting, tanggalPosting } }

// ─── Year footer ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  const el = document.getElementById('current-year');
  if (el) el.textContent = new Date().getFullYear();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(message, type = 'info', ts = Date.now()) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
  entry.textContent = `[${time}] ${message}`;
  statusLog.appendChild(entry);
  statusLog.scrollTop = statusLog.scrollHeight;
}

function setRunning(running) {
  isRunning = running;
  runBtn.classList.toggle('hidden', running);
  stopBtn.classList.toggle('hidden', !running);
  urlListEl.disabled     = running;
  commentPoolEl.disabled = running;
  namaEl.disabled        = running;
  igAccountEl.disabled   = running;
  ttAccountEl.disabled   = running;
  excelUploadEl.disabled = running;
  excelLabelEl.classList.toggle('upload-disabled', running);
}

function parseLines(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

// Mirror service_worker.js normalisation so urlMetaMap keys match url_error events
function normalizeUrl(url) {
  return url.replace(/instagram\.com\/reels?\//i, 'instagram.com/p/');
}

// ─── Excel Parsing ────────────────────────────────────────────────────────────
function parseExcel(arrayBuffer) {
  /* global XLSX */
  const workbook  = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheetName = workbook.SheetNames.find(n => n.trim().toLowerCase() === 'data posting');
  if (!sheetName) {
    throw new Error(`Sheet "Data Posting" tidak ditemukan. Sheet yang ada: ${workbook.SheetNames.join(', ')}`);
  }
  const sheet = workbook.Sheets[sheetName];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  // Detect header row dynamically — find the row containing IG and TikTok link columns
  let colNo = 1, colTgl = 2, colIg = 4, colTt = 5, dataStart = 0;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(c => String(c).toLowerCase().trim());
    const igI   = cells.findIndex(c => c.includes('ig') || c.includes('instagram'));
    const ttI   = cells.findIndex(c => c.includes('tik') || c.includes('tt'));
    if (igI !== -1 && ttI !== -1 && igI !== ttI) {
      const noI  = cells.findIndex(c => c.includes('no'));
      const tglI = cells.findIndex(c => c.includes('tanggal'));
      colNo    = noI  !== -1 ? noI  : colNo;
      colTgl   = tglI !== -1 ? tglI : colTgl;
      colIg    = igI;
      colTt    = ttI;
      dataStart = i + 1;
      break;
    }
  }

  const result = [];
  for (let i = dataStart; i < rows.length; i++) {
    const row   = rows[i];
    const igUrl = String(row[colIg] ?? '').trim();
    const ttUrl = String(row[colTt] ?? '').trim();
    if (igUrl.startsWith('https://') && ttUrl.startsWith('https://')) {
      result.push({
        noPosting:      String(row[colNo]  ?? '').trim(),
        tanggalPosting: String(row[colTgl] ?? '').trim(),
        igUrl,
        ttUrl,
      });
    }
  }
  return result;
}

function applyExcelData(rows) {
  excelRows  = rows;
  urlMetaMap = {};
  const urls = [];
  for (const r of rows) {
    urls.push(r.igUrl, r.ttUrl);
    urlMetaMap[normalizeUrl(r.igUrl)] = { noPosting: r.noPosting, tanggalPosting: r.tanggalPosting };
    urlMetaMap[normalizeUrl(r.ttUrl)] = { noPosting: r.noPosting, tanggalPosting: r.tanggalPosting };
  }
  urlListEl.value = urls.join('\n');
  chrome.storage.session.set({ urlList: urlListEl.value, excelRows, urlMetaMap }).catch(() => {});
}

// ─── Report Generation ────────────────────────────────────────────────────────
function renderReport() {
  if (!excelRows.length) return;
  const nama      = namaEl.value.trim();
  const igAccount = igAccountEl.value.trim();
  const ttAccount = ttAccountEl.value.trim();
  const lines     = excelRows.map(r => `${nama} / ${r.noPosting} / ${r.tanggalPosting}`);
  const report    = lines.join('\n') + `\n\nIG: ${igAccount}\nTT: ${ttAccount}`;
  reportOutputEl.textContent = report;
  reportSectionEl.classList.remove('hidden');
}

// ─── Event Rendering ──────────────────────────────────────────────────────────
function renderEvent({ event, url, detail, failedUrls, _ts }) {
  switch (event) {
    case 'url_start':
      log(`─── ${url}`, 'muted', _ts);
      break;
    case 'like_done':
      log(`  ✓ Liked`, 'success', _ts);
      break;
    case 'like_skipped':
      log(`  · Already liked — skipped`, 'muted', _ts);
      break;
    case 'comment_done':
      log(`  ✓ Commented: "${detail}"`, 'success', _ts);
      break;
    case 'repost_done':
      log(`  ✓ Reposted`, 'success', _ts);
      break;
    case 'screenshot_done':
      log(`  📷 Screenshot saved`, 'success', _ts);
      break;
    case 'url_error': {
      const meta = urlMetaMap[normalizeUrl(url || '')];
      if (meta) {
        log(`  ✗ No. ${meta.noPosting} / ${meta.tanggalPosting} — ${detail}`, 'error', _ts);
      } else {
        log(`  ✗ ${detail}`, 'error', _ts);
      }
      break;
    }
    case 'url_skip':
      log(`  ↷ Skipped: ${detail}`, 'warning', _ts);
      break;
    case 'done': {
      const failed = failedUrls ?? [];
      log(`All done! ✓ ${detail} succeeded, ✗ ${failed.length} failed.`, failed.length ? 'warning' : 'success', _ts);
      failed.forEach(u => {
        const meta = urlMetaMap[normalizeUrl(u)];
        if (meta) {
          log(`  ✗ No. ${meta.noPosting} / ${meta.tanggalPosting}`, 'error', _ts);
        } else {
          log(`  ✗ ${u}`, 'error', _ts);
        }
      });
      setRunning(false);
      stopBtn.disabled = false;
      renderReport();
      break;
    }
    case 'stopped':
      log('Automation stopped.', 'warning', _ts);
      setRunning(false);
      stopBtn.disabled = false;
      break;
    default:
      if (detail) log(`  ${detail}`, 'info', _ts);
  }
}

// ─── Session Restore ──────────────────────────────────────────────────────────
chrome.storage.session.get(
  {
    automationLog: [],
    isRunning:     false,
    urlList:       '',
    commentPool:   '',
    excelRows:     [],
    urlMetaMap:    {},
    nama:          '',
    igAccount:     '',
    ttAccount:     '',
  },
  ({ automationLog, isRunning: running, urlList, commentPool, excelRows: savedRows, urlMetaMap: savedMap, nama, igAccount, ttAccount }) => {
    if (urlList)     urlListEl.value     = urlList;
    if (commentPool) commentPoolEl.value = commentPool;
    if (nama)        namaEl.value        = nama;
    if (igAccount)   igAccountEl.value   = igAccount;
    if (ttAccount)   ttAccountEl.value   = ttAccount;
    if (savedRows.length) {
      excelRows  = savedRows;
      urlMetaMap = savedMap;
      excelFilenameEl.textContent = `${savedRows.length} baris dari sesi sebelumnya`;
    }
    automationLog.forEach(renderEvent);
    if (running) setRunning(true);
  }
);

// ─── Input Persistence ────────────────────────────────────────────────────────
urlListEl.addEventListener('input', () => {
  chrome.storage.session.set({ urlList: urlListEl.value }).catch(() => {});
});
commentPoolEl.addEventListener('input', () => {
  chrome.storage.session.set({ commentPool: commentPoolEl.value }).catch(() => {});
});
namaEl.addEventListener('input', () => {
  chrome.storage.session.set({ nama: namaEl.value }).catch(() => {});
});
igAccountEl.addEventListener('input', () => {
  chrome.storage.session.set({ igAccount: igAccountEl.value }).catch(() => {});
});
ttAccountEl.addEventListener('input', () => {
  chrome.storage.session.set({ ttAccount: ttAccountEl.value }).catch(() => {});
});

// ─── Excel Upload ─────────────────────────────────────────────────────────────
excelUploadEl.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    alert('Hanya file .xlsx yang didukung.');
    excelUploadEl.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const rows = parseExcel(ev.target.result);
      if (rows.length === 0) {
        log('Tidak ada baris valid ditemukan di Excel — URL list tidak diubah.', 'warning');
        return;
      }
      applyExcelData(rows);
      excelFilenameEl.textContent = `${file.name} (${rows.length} baris)`;
      log(`Excel diimport: ${rows.length} baris, ${rows.length * 2} URL.`, 'info');
    } catch (err) {
      log(`Gagal membaca Excel: ${err.message}`, 'error');
    }
  };
  reader.onerror = () => log('Gagal membaca file Excel.', 'error');
  reader.readAsArrayBuffer(file);
});

// ─── Run / Stop ───────────────────────────────────────────────────────────────
runBtn.addEventListener('click', () => {
  commentError.classList.add('hidden');
  reportSectionEl.classList.add('hidden');

  const urls        = parseLines(urlListEl.value);
  const commentPool = parseLines(commentPoolEl.value);

  if (commentPool.length === 0) {
    commentError.classList.remove('hidden');
    return;
  }

  if (urls.length === 0) {
    log('No URLs provided.', 'warning');
    return;
  }

  setRunning(true);
  log(`Starting automation for ${urls.length} URL(s)...`, 'info');

  chrome.runtime.sendMessage({
    type: 'START_AUTOMATION',
    urls,
    commentPool,
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_AUTOMATION' });
  log('Stop requested — waiting for current URL to finish...', 'warning');
  stopBtn.disabled = true;
});

clearLogBtn.addEventListener('click', () => {
  statusLog.innerHTML = '';
  chrome.storage.session.set({ automationLog: [] }).catch(() => {});
});

// ─── Copy Report ──────────────────────────────────────────────────────────────
copyReportBtn.addEventListener('click', () => {
  const text = reportOutputEl.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    copyReportBtn.textContent = 'Copied!';
    setTimeout(() => { copyReportBtn.textContent = 'Copy'; }, 2000);
  }).catch(() => {
    log('Gagal menyalin ke clipboard.', 'error');
  });
});

// ─── Incoming Progress Events ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'PROGRESS') return;
  renderEvent(message);
});