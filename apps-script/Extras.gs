/**
 * Extras.gs — วางเพิ่มในโปรเจกต์ Apps Script "ระบบครุภัณฑ์" (ตัวเดียวกับ Code.gs)
 *
 * เพิ่ม action สำหรับหน้าเว็บ:
 *   addDocLink         — คลังความรู้: เพิ่มเอกสารแบบ "วางลิงก์ URL" (ไม่ต้องอัปโหลดไฟล์)
 *   updateRepairReport — ซ่อมบำรุง: บันทึกรายงานผลการซ่อมจากหน่วยงานภายนอก
 *   listPortfolio / addPortfolio / deletePortfolio
 *                      — โปรไฟล์: แฟ้มผลงาน (พัฒนาตนเอง/รางวัล/พาไปแข่งขัน/รางวัลนักเรียน)
 *                        เก็บในแท็บ "ผลงานบุคลากร" (สร้างให้อัตโนมัติ)
 *
 * ติดตั้ง (ครั้งเดียว):
 *   1) สร้างไฟล์ใหม่ชื่อ Extras แล้ววางโค้ดนี้
 *   2) ใน doPost(e) ของ Code.gs เพิ่มบรรทัดนี้เป็นบรรทัดแรกในฟังก์ชัน
 *        const extra = handleExtraPost_(e); if (extra) return extra;
 *   3) Deploy → Manage deployments → ✏️ → Version: New version → Deploy
 *
 * สคริปต์นี้หาชีตจาก "หัวคอลัมน์" จึงไม่ต้องรู้ชื่อแท็บ และจะเพิ่มคอลัมน์ที่ยังไม่มีให้เอง
 * (ใช้ชีตที่ผูกกับสคริปต์ ถ้าไม่ได้ผูกจะเปิดไฟล์ EXTRA_SHEET_ID)
 */

// ไฟล์ "ระบบครุภัณฑ์ศูนย์กีฬา" — ใช้เมื่อสคริปต์ไม่ได้ผูกกับชีต (standalone)
const EXTRA_SHEET_ID = '15KZQHTfveli-ntIKsal1kxke01vbgNxLpMSnLI-Vi7Q';

const REPAIR_REPORT_COLUMNS = {
  status: 'สถานะ',
  condition: 'สภาพหลังซ่อม',
  result: 'ผลการซ่อม',
  recommendation: 'คำแนะนำจากช่าง',
  warrantyUntil: 'รับประกันถึง',
  reportUrl: 'ลิงก์รายงานผล',
  reportedAt: 'วันที่บันทึกผล',
};

function handleExtraPost_(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return null; }
  const handlers = {
    addDocLink: extraAddDocLink_,
    updateRepairReport: extraUpdateRepairReport_,
    listPortfolio: extraListPortfolio_,
    addPortfolio: extraAddPortfolio_,
    deletePortfolio: extraDeletePortfolio_,
  };
  const fn = body && handlers[body.action];
  if (!fn) return null; // ไม่ใช่ action ของไฟล์นี้ → ให้ Code.gs ทำงานต่อตามปกติ
  let out;
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { out = { ok: true, result: fn(body.payload || {}) }; } finally { lock.releaseLock(); }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- คลังความรู้: เพิ่มลิงก์เอกสาร ---------- */
function extraAddDocLink_(p) {
  const title = String(p.title || '').trim();
  const url = String(p.url || '').trim();
  if (!title) throw new Error('กรุณาใส่ชื่อเอกสาร');
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)');

  const sh = extraFindSheet_(['ชื่อเอกสาร', 'ลิงก์ไฟล์']);
  if (!sh) throw new Error('ไม่พบชีตคลังความรู้ (ต้องมีคอลัมน์ "ชื่อเอกสาร" และ "ลิงก์ไฟล์")');

  const id = 'DOC-' + Date.now();
  extraAppendByHeader_(sh, {
    'ID': id,
    'ชื่อเอกสาร': title,
    'หมวดหมู่': p.category || 'อื่นๆ',
    'ลิงก์ไฟล์': url,
    'อัปโหลดโดย': p.uploadedBy || '',
    'วันที่อัปเดต': new Date(),
    'เวอร์ชัน': '1',
    'ประเภท': 'ลิงก์',
  });
  return { id: id, url: url };
}

/* ---------- ซ่อมบำรุง: บันทึกรายงานผลการซ่อม ---------- */
function extraUpdateRepairReport_(p) {
  const id = String(p.id || '').trim();
  if (!id) throw new Error('ไม่พบรหัสรายการซ่อม');

  const sh = extraFindSheet_(['ร้าน/ช่าง', 'วันที่ซ่อม']);
  if (!sh) throw new Error('ไม่พบชีตประวัติการซ่อม (ต้องมีคอลัมน์ "ร้าน/ช่าง" และ "วันที่ซ่อม")');

  const values = Object.assign({}, p, { reportedAt: new Date() });
  const headers = extraEnsureColumns_(sh, Object.keys(REPAIR_REPORT_COLUMNS).map(function (k) { return REPAIR_REPORT_COLUMNS[k]; }));
  const idCol = headers.indexOf('ID');
  if (idCol < 0) throw new Error('ชีตประวัติการซ่อมไม่มีคอลัมน์ "ID"');

  const ids = sh.getRange(2, idCol + 1, Math.max(sh.getLastRow() - 1, 1), 1).getDisplayValues().map(function (r) { return r[0]; });
  const idx = ids.indexOf(id);
  if (idx < 0) throw new Error('ไม่พบรายการซ่อม ID ' + id);
  const row = idx + 2;

  Object.keys(REPAIR_REPORT_COLUMNS).forEach(function (k) {
    if (values[k] === undefined) return;
    const col = headers.indexOf(REPAIR_REPORT_COLUMNS[k]);
    if (col >= 0) sh.getRange(row, col + 1).setValue(values[k]);
  });
  return { id: id };
}

/* ---------- โปรไฟล์: แฟ้มผลงานบุคลากร ---------- */
const PORTFOLIO_SHEET = 'ผลงานบุคลากร';
const PORTFOLIO_FIELDS = [
  ['id', 'ID'], ['teacherId', 'TeacherID'], ['owner', 'ชื่อผู้บันทึก'], ['type', 'ประเภท'],
  ['date', 'วันที่'], ['title', 'ชื่อรายการ'], ['organizer', 'หน่วยงานผู้จัด/ผู้มอบ'], ['level', 'ระดับ'],
  ['hours', 'จำนวนชั่วโมง'], ['result', 'ผลที่ได้/รางวัล'], ['students', 'นักเรียน'], ['detail', 'รายละเอียด'],
  ['evidenceUrl', 'ลิงก์หลักฐาน'], ['createdAt', 'บันทึกเมื่อ'],
];
const PORTFOLIO_TYPE_LABEL = { dev: 'การพัฒนาตนเอง', award: 'รางวัลของตนเอง', competition: 'การพาไปแข่งขัน', student: 'รางวัลนักเรียนที่ดูแล' };

function extraPortfolioSheet_() {
  const ss = extraSpreadsheet_();
  let sh = ss.getSheetByName(PORTFOLIO_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PORTFOLIO_SHEET);
    sh.getRange(1, 1, 1, PORTFOLIO_FIELDS.length).setValues([PORTFOLIO_FIELDS.map(function (f) { return f[1]; })]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  extraEnsureColumns_(sh, PORTFOLIO_FIELDS.map(function (f) { return f[1]; }));
  return sh;
}

function extraListPortfolio_(p) {
  const sh = extraPortfolioSheet_();
  const v = sh.getDataRange().getDisplayValues();
  const head = v[0].map(function (h) { return String(h).trim(); });
  const labelToType = {};
  Object.keys(PORTFOLIO_TYPE_LABEL).forEach(function (k) { labelToType[PORTFOLIO_TYPE_LABEL[k]] = k; });
  const tid = String(p.teacherId || '');
  const items = v.slice(1).map(function (row) {
    const o = {};
    PORTFOLIO_FIELDS.forEach(function (f) { const i = head.indexOf(f[1]); o[f[0]] = i >= 0 ? row[i] : ''; });
    o.type = labelToType[o.type] || o.type;
    return o;
  }).filter(function (o) { return o.id && (!tid || String(o.teacherId) === tid); });
  return { items: items };
}

function extraAddPortfolio_(p) {
  if (!String(p.title || '').trim()) throw new Error('กรุณาใส่ชื่อรายการ');
  if (!p.teacherId) throw new Error('ไม่พบรหัสครู');
  const sh = extraPortfolioSheet_();
  const id = 'PF-' + Date.now();
  const rec = Object.assign({}, p, { id: id, createdAt: new Date(), type: PORTFOLIO_TYPE_LABEL[p.type] || p.type });
  const obj = {};
  PORTFOLIO_FIELDS.forEach(function (f) { obj[f[1]] = rec[f[0]] !== undefined ? rec[f[0]] : ''; });
  extraAppendByHeader_(sh, obj);
  return { id: id };
}

function extraDeletePortfolio_(p) {
  const sh = extraPortfolioSheet_();
  const v = sh.getDataRange().getDisplayValues();
  const head = v[0];
  const idCol = head.indexOf('ID'), tCol = head.indexOf('TeacherID');
  for (let r = v.length - 1; r >= 1; r--) {
    if (v[r][idCol] === String(p.id)) {
      if (p.teacherId && String(v[r][tCol]) !== String(p.teacherId)) throw new Error('ลบได้เฉพาะผลงานของตนเอง');
      sh.deleteRow(r + 1);
      return { id: p.id };
    }
  }
  throw new Error('ไม่พบรายการ');
}

/* ---------- helpers ---------- */
function extraSpreadsheet_() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(EXTRA_SHEET_ID);
}

// หาแท็บที่แถวหัวตารางมีครบทุกคำที่ระบุ
function extraFindSheet_(requiredHeaders) {
  const sheets = extraSpreadsheet_().getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (sh.getLastColumn() < 1) continue;
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    if (requiredHeaders.every(function (h) { return head.indexOf(h) >= 0; })) return sh;
  }
  return null;
}

// เพิ่มคอลัมน์ท้ายตารางถ้ายังไม่มี แล้วคืนรายชื่อหัวคอลัมน์ทั้งหมด
function extraEnsureColumns_(sh, names) {
  let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  names.forEach(function (n) {
    if (head.indexOf(n) < 0) {
      sh.getRange(1, head.length + 1).setValue(n);
      head.push(n);
    }
  });
  return head;
}

function extraAppendByHeader_(sh, obj) {
  const head = extraEnsureColumns_(sh, Object.keys(obj).filter(function (k) { return k !== 'ประเภท'; }));
  const row = head.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
}

/* ทดสอบใน editor: เลือกฟังก์ชันนี้แล้วกด Run — จะบอกว่าเจอชีตไหน (ไม่เขียนข้อมูล) */
function testExtras() {
  const d = extraFindSheet_(['ชื่อเอกสาร', 'ลิงก์ไฟล์']);
  const r = extraFindSheet_(['ร้าน/ช่าง', 'วันที่ซ่อม']);
  Logger.log('ชีตคลังความรู้: ' + (d ? d.getName() : 'ไม่พบ'));
  Logger.log('ชีตประวัติซ่อม: ' + (r ? r.getName() : 'ไม่พบ'));
}
