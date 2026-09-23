/**
 * Extras.gs — วางเพิ่มในโปรเจกต์ Apps Script "ระบบครุภัณฑ์" (ตัวเดียวกับ Code.gs)
 *
 * เพิ่ม action สำหรับหน้าเว็บ:
 *   addDocLink         — คลังความรู้: เพิ่มเอกสารแบบ "วางลิงก์ URL" (ไม่ต้องอัปโหลดไฟล์)
 *   updateRepairReport — ซ่อมบำรุง: บันทึกรายงานผลการซ่อมจากหน่วยงานภายนอก
 *   listPortfolio / addPortfolio / deletePortfolio
 *                      — โปรไฟล์: แฟ้มผลงาน (พัฒนาตนเอง/รางวัล/พาไปแข่งขัน/รางวัลนักเรียน)
 *                        เก็บในแท็บ "ผลงานบุคลากร" (สร้างให้อัตโนมัติ)
 *   login (override)   — ถ้าบัญชีตั้งรหัสผ่านใหม่แล้ว ตรวจกับรหัสที่เข้ารหัส (hash) ในแท็บ
 *                        "บัญชีรหัสผ่าน"; ถ้ายังไม่เคยตั้ง จะส่งต่อให้ login เดิมใน Code.gs
 *   pwChange           — ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง
 *   pwAdminReset       — หัวหน้า (Level L3) รีเซ็ตรหัสผ่านให้บุคลากร (ต้องยืนยันรหัสผ่านตัวเอง)
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
var EXTRA_SHEET_ID = '15KZQHTfveli-ntIKsal1kxke01vbgNxLpMSnLI-Vi7Q';

var REPAIR_REPORT_COLUMNS = {
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
    login: pwLogin_,
    pwChange: pwChange_,
    pwAdminReset: pwAdminReset_,
  };
  const fn = body && handlers[body.action];
  if (!fn) return null; // ไม่ใช่ action ของไฟล์นี้ → ให้ Code.gs ทำงานต่อตามปกติ
  let out;
  try {
    if (body.action === 'login') {
      const r = fn(body.payload || {});
      if (r === PW_PASS_THROUGH) return null; // ยังไม่เคยตั้งรหัสใหม่ → ใช้ login เดิมของ Code.gs
      out = { ok: true, result: r };
    } else {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { out = { ok: true, result: fn(body.payload || {}) }; } finally { lock.releaseLock(); }
    }
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
var PORTFOLIO_SHEET = 'ผลงานบุคลากร';
var PORTFOLIO_FIELDS = [
  ['id', 'ID'], ['teacherId', 'TeacherID'], ['owner', 'ชื่อผู้บันทึก'], ['type', 'ประเภท'],
  ['date', 'วันที่'], ['title', 'ชื่อรายการ'], ['organizer', 'หน่วยงานผู้จัด/ผู้มอบ'], ['level', 'ระดับ'],
  ['hours', 'จำนวนชั่วโมง'], ['result', 'ผลที่ได้/รางวัล'], ['students', 'นักเรียน'], ['detail', 'รายละเอียด'],
  ['evidenceUrl', 'ลิงก์หลักฐาน'], ['createdAt', 'บันทึกเมื่อ'],
];
var PORTFOLIO_TYPE_LABEL = { dev: 'การพัฒนาตนเอง', award: 'รางวัลของตนเอง', competition: 'การพาไปแข่งขัน', student: 'รางวัลนักเรียนที่ดูแล' };

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


/* ================================================================
   การจัดการรหัสผ่าน
   - เก็บรหัสผ่านแบบเข้ารหัสทางเดียว (SHA-256 + salt) ในแท็บ "บัญชีรหัสผ่าน"
     (ไม่มีใครอ่านรหัสผ่านจริงได้ แม้เปิดชีต)
   - บัญชีที่ยังไม่เคยตั้งรหัสใหม่ ใช้ Username/Password เดิม (แท็บ 9.บุคลากร / User)
   - เมื่อตั้งรหัสใหม่แล้ว รหัสเดิมแบบข้อความธรรมดาจะถูกล้างทิ้ง
   ================================================================ */
var PW_SHEET = 'บัญชีรหัสผ่าน';
var PW_FIELDS = ['Username', 'Salt', 'Hash', 'บังคับเปลี่ยน', 'แก้ไขล่าสุด', 'แก้ไขโดย'];
var PW_ROUNDS = 300;
var PW_PASS_THROUGH = { __pass: true };

function pwSheet_() {
  const ss = extraSpreadsheet_();
  let sh = ss.getSheetByName(PW_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PW_SHEET);
    sh.getRange(1, 1, 1, PW_FIELDS.length).setValues([PW_FIELDS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) { /* ignore */ }
  }
  return sh;
}

function pwNorm_(u) { return String(u == null ? '' : u).trim().toLowerCase(); }

function pwHash_(salt, password) {
  let h = salt + '|' + password;
  for (let i = 0; i < PW_ROUNDS; i++) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8);
    h = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }
  return h;
}

// ใช้ ID บุคลากรเป็นกุญแจหลัก (ผู้ใช้อาจพิมพ์ Username หรือ ID ก็ได้)
function pwCanon_(username) {
  const s = pwStaff_(username);
  return s && s.id ? s.id : String(username || '').trim();
}

function pwFindRecord_(username) {
  const sh = pwSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const vals = sh.getRange(2, 1, last - 1, PW_FIELDS.length).getValues();
  const key = pwNorm_(pwCanon_(username));
  for (let i = 0; i < vals.length; i++) {
    if (pwNorm_(vals[i][0]) === key) {
      return { row: i + 2, username: String(vals[i][0]), salt: String(vals[i][1]), hash: String(vals[i][2]), mustChange: vals[i][3] === true || String(vals[i][3]).toUpperCase() === 'TRUE' };
    }
  }
  return null;
}

function pwWriteRecord_(username, password, mustChange, by) {
  username = pwCanon_(username);
  const sh = pwSheet_();
  const salt = Utilities.getUuid();
  const row = [String(username), salt, pwHash_(salt, password), !!mustChange, new Date(), String(by || '')];
  const rec = pwFindRecord_(username);
  if (rec) sh.getRange(rec.row, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  pwClearLegacy_(username);
}

// ตารางที่เก็บ Username/Password เดิม (แบบข้อความธรรมดา): แท็บ 9.บุคลากร และ/หรือ แท็บ User
// หาแถวหัวตารางเอง (อยู่ภายใน 5 แถวแรก)
function pwLegacyTables_() {
  const ss = extraSpreadsheet_();
  const out = [];
  ['9.บุคลากร', 'User'].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
    for (let r = 0; r < Math.min(5, vals.length); r++) {
      const head = vals[r].map(function (h) { return String(h).trim(); });
      const iu = head.indexOf('Username'), ip = head.indexOf('Password');
      if (iu >= 0 && ip >= 0) { out.push({ sh: sh, vals: vals, headRow: r, iu: iu, ip: ip, iid: head.indexOf('ID') }); return; }
    }
  });
  return out;
}

function pwLegacyRow_(t, username) {
  const key = pwNorm_(username);
  for (let r = t.headRow + 1; r < t.vals.length; r++) {
    const row = t.vals[r];
    if (pwNorm_(row[t.iu]) === key || (t.iid >= 0 && pwNorm_(row[t.iid]) === key)) return r;
  }
  return -1;
}

function pwLegacyCheck_(username, password) {
  const ts = pwLegacyTables_();
  for (let i = 0; i < ts.length; i++) {
    const r = pwLegacyRow_(ts[i], username);
    if (r >= 0) { const pv = String(ts[i].vals[r][ts[i].ip]); return pv !== '' && pv === String(password); }
  }
  return false;
}

function pwClearLegacy_(username) {
  pwLegacyTables_().forEach(function (t) {
    const r = pwLegacyRow_(t, username);
    if (r >= 0) t.sh.getRange(r + 1, t.ip + 1).setValue('(ตั้งรหัสใหม่แล้ว)');
  });
}

// ตรวจรหัสผ่าน: ถ้ามีรหัสใหม่ใช้ hash, ถ้าไม่มีใช้รหัสเดิมในแท็บ User
function pwVerify_(username, password) {
  const rec = pwFindRecord_(username);
  if (rec) return pwHash_(rec.salt, String(password)) === rec.hash;
  return pwLegacyCheck_(username, password);
}

// จำกัดการเดารหัส: ผิดเกิน 5 ครั้งใน 10 นาที → ล็อกชั่วคราว
function pwThrottle_(username, failed) {
  const cache = CacheService.getScriptCache();
  const key = 'pwfail_' + pwNorm_(username);
  const n = Number(cache.get(key) || 0);
  if (failed === undefined) { if (n >= 5) throw new Error('ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่'); return; }
  if (failed) cache.put(key, String(n + 1), 600); else cache.remove(key);
}

// ข้อมูลบุคลากรจากแท็บ 9.บุคลากร (จับคู่ด้วย ID หรือ Username)
function pwStaff_(username) {
  const sh = extraSpreadsheet_().getSheetByName('9.บุคลากร') || extraFindSheet_(['ID', 'ชื่อ', 'Level']);
  if (!sh) return null;
  const vals = sh.getDataRange().getDisplayValues();
  const head = vals[0].map(function (h) { return String(h).trim(); });
  const col = function (names) { for (let i = 0; i < names.length; i++) { const k = head.indexOf(names[i]); if (k >= 0) return k; } return -1; };
  const c = { id: col(['ID']), user: col(['Username']), prefix: col(['นำหน้า', 'คำนำหน้า']), name: col(['ชื่อ']), dept: col(['หน่วยงาน']), role: col(['หน้าที่']), phone: col(['เบอร์โทร']), level: col(['Level']), photo: col(['รูปโปรไฟล์', 'Picture', 'รูป', 'photoUrl']) };
  const key = pwNorm_(username);
  for (let r = 1; r < vals.length; r++) {
    const g = function (k) { return c[k] >= 0 ? String(vals[r][c[k]]).trim() : ''; };
    if (pwNorm_(g('id')) === key || (c.user >= 0 && pwNorm_(g('user')) === key)) {
      let name = g('name');
      const pre = g('prefix');
      if (pre && name.indexOf(pre) !== 0) name = pre + name;
      return { id: g('id'), name: name, dept: g('dept'), title: g('role'), phone: g('phone'), role: g('level') || 'L1', photoUrl: g('photo') };
    }
  }
  return null;
}

function pwLogin_(p) {
  const username = String(p.username || '').trim();
  const rec = pwFindRecord_(username);
  if (!rec) return PW_PASS_THROUGH;
  pwThrottle_(username);
  const ok = pwHash_(rec.salt, String(p.password || '')) === rec.hash;
  pwThrottle_(username, !ok);
  if (!ok) throw new Error('Username หรือ Password ไม่ถูกต้อง');
  const staff = pwStaff_(username);
  if (!staff) throw new Error('ไม่พบบัญชีผู้ใช้นี้');
  staff.mustChange = rec.mustChange;
  return { user: staff };
}

function pwCheckStrength_(pw) {
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(pw || ''))) throw new Error('รหัสผ่านอย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข');
}

function pwChange_(p) {
  const username = String(p.username || '').trim();
  if (!username) throw new Error('ไม่พบบัญชีผู้ใช้นี้');
  pwThrottle_(username);
  const ok = pwVerify_(username, p.oldPassword);
  pwThrottle_(username, !ok);
  if (!ok) throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  pwCheckStrength_(p.newPassword);
  if (String(p.newPassword) === String(p.oldPassword)) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  pwWriteRecord_(username, String(p.newPassword), false, username);
  return { changed: true };
}

function pwAdminReset_(p) {
  const admin = String(p.adminUsername || '').trim();
  const target = String(p.targetUsername || '').trim();
  pwThrottle_(admin);
  const ok = pwVerify_(admin, p.adminPassword);
  pwThrottle_(admin, !ok);
  if (!ok) throw new Error('รหัสผ่านของหัวหน้าไม่ถูกต้อง');
  const a = pwStaff_(admin);
  if (!a || a.role !== 'L3') throw new Error('ต้องเป็นหัวหน้า (L3) เท่านั้น');
  if (!pwStaff_(target)) throw new Error('ไม่พบบัญชีผู้ใช้นี้');
  pwCheckStrength_(p.newPassword);
  pwWriteRecord_(target, String(p.newPassword), p.mustChange !== false, a.id + ' ' + a.name);
  CacheService.getScriptCache().remove('pwfail_' + pwNorm_(target));
  return { reset: true };
}

/* ทดสอบใน editor: ตรวจว่าเจอแท็บ User / 9.บุคลากร (ไม่เปลี่ยนรหัสใคร) */
function testPasswords() {
  const ts = pwLegacyTables_();
  Logger.log('ตาราง Username/Password เดิม: ' + ts.map(function (t) { return t.sh.getName(); }).join(', '));
  Logger.log('แท็บบุคลากร: ' + (extraFindSheet_(['ID', 'ชื่อ', 'Level']) ? 'พบ' : 'ไม่พบ'));
  Logger.log('แท็บ ' + PW_SHEET + ': ' + (pwSheet_().getLastRow() - 1) + ' บัญชีที่ตั้งรหัสใหม่แล้ว');
}
