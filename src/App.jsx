import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, RadialBarChart, RadialBar,
} from "recharts";
import {
  LayoutDashboard, Package, MapPin, ArrowLeftRight, Wrench, BarChart3,
  FileText, Sparkles, LogOut, Search, ChevronRight, CheckCircle2, XCircle,
  AlertTriangle, Clock, Plus, X, Eye, Pencil, ShieldCheck, TrendingUp,
  Building2, Shirt, Trophy, Download, Bell, ChevronDown, User, Users,
} from "lucide-react";

/* ============================================================
   DESIGN TOKENS — ACT Sport Center
   Deep Royal Blue + Crimson + Gold on white. Premium enterprise,
   sports-technology feel. No rounded "SaaS card kit" sameness —
   flat panels, a hairline rule system, and a court-line motif.
   ============================================================ */
const C = {
  navy: "#181818",       // primary — near-black (was deep royal blue)
  navyDeep: "#0A0A0A",   // sidebar / hero — true black
  navySoft: "#3D3D3D",   // secondary neutral
  crimson: "#C81E3A",    // primary red accent
  crimsonDeep: "#8C1327",
  gold: "#7A1220",       // tertiary accent — deep red (was gold)
  goldSoft: "#F1D2D6",   // light red tint (was gold tint)
  accent: "#E4354F",     // bright red — for icons/highlights on dark backgrounds
  ink: "#12151C",
  slate: "#5B6273",
  line: "#E2E4EA",
  paper: "#FBFBFA",
  white: "#FFFFFF",
  ok: "#1E7A4C",
  okBg: "#EAF6EF",
  warn: "#B8791A",
  warnBg: "#FBF1DF",
  bad: "#B91C3C",
  badBg: "#FBEAEC",
  mute: "#8A8FA0",
};

const FONT = "'Noto Sans Thai','Sarabun',ui-sans-serif,system-ui,-apple-system,sans-serif";

/* ============================================================
   GOOGLE SHEETS BACKEND
   ------------------------------------------------------------
   ระบบหลังบ้านคือไฟล์ Google Sheet "ระบบครุภัณฑ์ศูนย์กีฬา"
   (https://docs.google.com/spreadsheets/d/15KZQHTfveli-.../edit)
   ผ่าน Web App ที่ deploy จาก Apps Script (ไฟล์ Code.gs ที่แนบมาด้วย)

   วิธีเปิดใช้งานจริง: deploy Code.gs เป็น Web App แล้วนำ URL ที่ได้
   มาใส่ค่าด้านล่างนี้ — ถ้าเว้นว่างไว้ ระบบจะทำงานด้วยข้อมูลตัวอย่าง
   ในเครื่อง (seed data) เหมือนเดิม ไม่กระทบการใช้งาน
   ============================================================ */
const API_URL = "https://script.google.com/macros/s/AKfycbyk-K8T2uIgWtyPeiltRbjzyyuuWFoA3al-9y-cJNW9ASgm3lSeRoesIbrF2Bhr9JW7lQ/exec";

function catCodeFromName(name) {
  const hit = CATEGORIES.find((c) => c.name === name);
  return hit ? hit.code : name;
}
function fmtDate(v) {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v); }
}
async function sheetsFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error("Sheets API error " + res.status);
  return res.json();
}
async function loadFromSheets() {
  const data = await sheetsFetch(`${API_URL}?action=data`);
  if (!data.ok) throw new Error(data.error || "load failed");
  const items = data.items.map((r) => ({
    id: r["รหัส"], code: r["รหัส"], name: r["รายการ"], brand: r["ยี่ห้อ / รุ่น"] || "",
    catCode: catCodeFromName(r["หมวด"]), loc: r["สถานที่เก็บ"], owner: r["ผู้ดูแล"],
    normal: Number(r["ปกติ"]) || 0, damaged: Number(r["ชำรุด"]) || 0,
    lost: Number(r["สูญหาย"]) || 0, disposed: Number(r["จำหน่ายออก"]) || 0,
    borrowed: Number(r["ถูกยืมอยู่"]) || 0, minAlert: Number(r["เตือนเมื่อเหลือ"]) || 0,
    price: Number(r["ราคา/หน่วย"]) || 0, note: r["หมายเหตุ"] || "", imageUrl: r["รูปภาพ"] || "", _row: r._row,
  }));
  const borrows = data.borrows.map((r) => ({
    id: `BR-${r._row}`, _row: r._row, date: fmtDate(r["วันที่ยืม"]), borrower: r["ผู้ยืม"],
    itemCode: r["รหัสอุปกรณ์"], itemName: r["ชื่ออุปกรณ์"], qty: Number(r["จำนวน"]) || 0,
    where: r["ใช้ที่ไหน"], purpose: r["ใช้ทำอะไร"], due: fmtDate(r["กำหนดคืน"]),
    returned: r["วันที่คืนจริง"] ? fmtDate(r["วันที่คืนจริง"]) : null,
    status: r["วันที่คืนจริง"] ? "returned" : "borrowed",
  }));
  const damages = data.damages.map((r) => ({
    id: `DM-${r._row}`, _row: r._row, date: fmtDate(r["วันที่แจ้ง"]), itemCode: r["รหัสอุปกรณ์"],
    itemName: r["ชื่ออุปกรณ์"], qty: Number(r["จำนวน"]) || 0, symptom: r["อาการ / สาเหตุ"] || "",
    reporter: r["ผู้แจ้ง"], severity: "ปานกลาง", status: r["สถานะ"] || "รอตรวจสอบ",
  }));
  const staff = (data.staff || []).map((r) => ({
    id: String(r["ID"]), name: r["ชื่อ"], dept: r["หน่วยงาน"], role: r["หน้าที่"],
    phone: r["เบอร์โทร"] || "", level: (r["Level"] || "L1").trim(),
  }));
  return { items, borrows, damages, staff };
}
function postToSheets(action, payload) {
  if (!API_URL) return Promise.resolve();
  return fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, payload }) }).catch(() => {});
}

// resize + compress a File to a JPEG data URL's base64 body, so uploads stay small
function compressImage(file, maxW = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

async function uploadItemImage(code, file) {
  if (!API_URL) throw new Error("ยังไม่ได้เชื่อมต่อ Google Sheets backend — อัปโหลดรูปไม่ได้ในโหมดตัวอย่างนี้");
  const base64 = await compressImage(file);
  const res = await fetch(API_URL, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "uploadImage", payload: { code, filename: `${code}.jpg`, mimeType: "image/jpeg", base64 } }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "อัปโหลดไม่สำเร็จ");
  return data.result.url;
}

/* ============================================================
   SEED DATA — extracted from ระบบครุภัณฑ์ศูนย์กีฬา (live sheet)
   ============================================================ */
const CATEGORIES = [
  { code: "TKD", name: "เทควันโด" }, { code: "CLB", name: "ปีนหน้าผา" },
  { code: "GLF", name: "กอล์ฟ" }, { code: "FUT", name: "ฟุตซอล" },
  { code: "FBL", name: "ฟุตบอล" }, { code: "BKB", name: "บาสเกตบอล" },
  { code: "TEN", name: "เทนนิส" }, { code: "BDM", name: "แบดมินตัน" },
  { code: "TTN", name: "เทเบิลเทนนิส" }, { code: "DAN", name: "เต้น/การแสดง" },
  { code: "SPS", name: "วิทยาศาสตร์การกีฬา" }, { code: "OFF", name: "อุปกรณ์สำนักงาน" },
  { code: "GEN", name: "อุปกรณ์ฝึกทั่วไป" }, { code: "FAC", name: "สิ่งอำนวยความสะดวก" },
  { code: "UNI", name: "ชุดกีฬา/ชุดแสดง" }, { code: "SWM", name: "สระว่ายน้ำ" },
  { code: "FIT", name: "ฟิตเนส" },
];

const LOCATIONS = [
  { code: "OFF-SPORT", name: "สำนักงานศูนย์กีฬา", owner: "มิสกฤติยา ต่อสกุล" },
  { code: "TTN-ROOM", name: "ห้องเทเบิลเทนนิส", owner: "ม.อนุวัฒน์ เทพประเทียน" },
  { code: "TTN-STORE", name: "ชั้น 3 ห้องเก็บของ", owner: "ม.อนุวัฒน์ เทพประเทียน" },
  { code: "DAN-ROOM", name: "ห้องเต้น", owner: "มิสกฤติยา ต่อสกุล" },
  { code: "TKD-ROOM-1", name: "ห้องเทควันโด 1", owner: "มิสวรรณา จิรพลานุรักษ์" },
  { code: "TKD-ROOM-2", name: "ห้องเทควันโด 2", owner: "มิสวรรณา จิรพลานุรักษ์" },
  { code: "GLF-RANGE", name: "ห้องไดร์ฟกอล์ฟ", owner: "ยังไม่ระบุ" },
  { code: "GLF-CHIP", name: "สนามชิพกอล์ฟ", owner: "ยังไม่ระบุ" },
  { code: "CLB-WALL", name: "ผนังปีนหน้าผา", owner: "ม.ชาญวิทย์ พึ่งอิ่ม" },
  { code: "TEN-COURT", name: "คอร์ตเทนนิส", owner: "ม.ชาญวิทย์ พึ่งอิ่ม" },
  { code: "FUT-COURT", name: "สนามฟุตซอล", owner: "ม.ชาญวิทย์ พึ่งอิ่ม" },
  { code: "FBL-FIELD", name: "สนามฟุตบอล", owner: "ม.ชาญวิทย์ พึ่งอิ่ม" },
  { code: "BKB-COURT", name: "สนามบาสเกตบอล", owner: "ม.ชาญวิทย์ พึ่งอิ่ม" },
  { code: "ARENA", name: "อารีน่า", owner: "ม.ชาญวิทย์ พึ่งอิ่ม" },
  { code: "ACT-ACTIVITY", name: "ห้องฝ่ายกิจกรรม", owner: "ยังไม่ระบุ" },
  { code: "SWM-POOL", name: "สระว่ายน้ำ", owner: "มิสรัตนาภรณ์ ลิ้มทุติเนตร" },
  { code: "FIT-CENTER", name: "ศูนย์ฟิตเนส", owner: "ม.ชวินทร์ โรยอุตระ" },
];

// [code, name, brand, category, location, owner, normal, damaged, lost, disposed, note]
const RAW_ITEMS = [
["OFF-001","คอมพิวเตอร์ All-in-One พร้อมเมาส์/คีย์บอร์ด","DELL All in One","OFF","สำนักงานศูนย์กีฬา","มิสกฤติยา ต่อสกุล",8,0,0,0,"เลขครุภัณฑ์ ACT SPORT-03 4787"],
["OFF-002","โต๊ะสำนักงาน สีเบจ","LOGICA","OFF","สำนักงานศูนย์กีฬา","มิสกฤติยา ต่อสกุล",8,0,0,0,""],
["OFF-003","เก้าอี้สำนักงาน เบาะหนังดำ มีล้อเลื่อน","LOGICA","OFF","สำนักงานศูนย์กีฬา","มิสกฤติยา ต่อสกุล",2,0,0,0,""],
["OFF-007","เครื่องพิมพ์","HP JET PRO LJM20IN","OFF","สำนักงานศูนย์กีฬา","มิสกฤติยา ต่อสกุล",1,0,0,0,""],
["OFF-008","โซฟา สีน้ำตาล","","OFF","ห้องฝ่ายกิจกรรม","มิสกฤติยา ต่อสกุล",2,0,0,0,""],
["FAC-001","ตู้น้ำร้อน-น้ำเย็น","IMARFREX IF-115","FAC","สำนักงานศูนย์กีฬา","มิสกฤติยา ต่อสกุล",1,0,0,0,""],
["GEN-001","นาฬิกาจับเวลา","Geonaute","GEN","สำนักงานศูนย์กีฬา","มิสกฤติยา ต่อสกุล",2,0,0,0,""],
["GEN-002","ปืนปล่อยตัว Blankgun","EKOL Viper 4.5\"","GEN","สำนักงานศูนย์กีฬา","มิสกฤติยา ต่อสกุล",1,0,0,0,""],
["TTN-001","โต๊ะปิงปอง","TIBHAR","TTN","ชั้น 3 ห้องเก็บของ","ม.อนุวัฒน์ เทพประเทียน",2,0,0,0,""],
["TTN-002","เครื่องยิงลูกปิงปอง","ROBO-PONG","TTN","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",0,1,0,0,""],
["TTN-003","เครื่องยิงลูกปิงปอง","Y&T V-986","TTN","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",1,0,0,0,""],
["TTN-004","ตาข่ายปิงปอง","FORMULA","TTN","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",0,1,0,0,""],
["TTN-005","ตาข่ายปิงปอง","BUTTERFLY","TTN","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",0,2,0,0,""],
["TTN-006","แผ่นพื้นยางจิ๊กซอว์ สีแดง","","TTN","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",30,0,0,0,""],
["TTN-007","แผ่นพื้นยางจิ๊กซอว์ สีน้ำเงิน","","TTN","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",40,0,0,0,""],
["TTN-009","เสาปิงปองพร้อมเน็ท","","TTN","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",2,1,0,0,""],
["FAC-006","พัดลมแอร์","","FAC","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",1,1,3,0,"⚠️ ต้องยืนยันยอดใหม่"],
["FAC-007","ปลั๊กไฟ","","FAC","ห้องเทเบิลเทนนิส","ม.อนุวัฒน์ เทพประเทียน",4,0,1,0,"⚠️ เดิมระบุ 'หาย 1 เล็ก'"],
["TTN-010","โต๊ะปิงปอง yinhe","รุ่น TOP","TTN","ชั้น 3 ห้องเก็บของ","ม.อนุวัฒน์ เทพประเทียน",2,0,0,0,""],
["TTN-011","โต๊ะปิงปอง joola","","TTN","ชั้น 3 ห้องเก็บของ","ม.อนุวัฒน์ เทพประเทียน",1,4,0,0,""],
["TTN-012","โต๊ะปิงปอง VIGA","","TTN","ชั้น 3 ห้องเก็บของ","ม.อนุวัฒน์ เทพประเทียน",6,0,0,0,""],
["FAC-008","ทีวีจอแบน 45 นิ้ว สีดำ","SONY","FAC","ห้องเต้น","มิสกฤติยา ต่อสกุล",1,0,0,0,""],
["DAN-001","เครื่องเสียง","SONY","DAN","ห้องเต้น","มิสกฤติยา ต่อสกุล",1,0,0,0,""],
["DAN-002","ลำโพงพร้อมไมค์สาย","samson","DAN","ห้องเต้น","มิสกฤติยา ต่อสกุล",1,0,1,0,"⚠️ นับไมค์เป็นสูญหาย"],
["FAC-009","แอร์เคลื่อนที่","","FAC","ห้องเต้น","มิสกฤติยา ต่อสกุล",1,0,0,0,""],
["UNI-001","เสื้อเงินไหล่ตัด + โจงสำเร็จ","","UNI","ห้องเต้น","มิสกฤติยา ต่อสกุล",8,0,0,0,""],
["UNI-004","ชุดพม่า (บอดี้สูท+ผ้าถุง)","","UNI","ห้องเต้น","มิสกฤติยา ต่อสกุล",6,0,0,0,""],
["UNI-005","รองเท้าบัลเล่ต์","","UNI","ห้องเต้น","มิสกฤติยา ต่อสกุล",8,0,0,0,""],
["UNI-010","ชุดบัลเล่ต์เด็กเล็ก","","UNI","ห้องเต้น","มิสกฤติยา ต่อสกุล",2,2,0,0,""],
["UNI-013","ธง + เสาธงโรงเรียน","","UNI","ห้องเต้น","มิสกฤติยา ต่อสกุล",23,0,0,0,""],
["DAN-004","เบาะหนังน้ำเงิน","","DAN","ห้องเต้น","มิสกฤติยา ต่อสกุล",3,1,0,0,""],
["TKD-001","EVERLAST Freestanding Reflex Bag","Everlast","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",2,2,0,0,"ฐานชำรุด เก็บที่ห้องแม่บ้าน"],
["TKD-002","EVERLAST Pro Everflex Freestanding HB","Everlast","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",2,0,0,0,"ฟองน้ำเสื่อมสภาพ"],
["TKD-003","EVERLAST Kick Boxing Trainer (ใหญ่)","Everlast","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",0,2,0,0,"กิ่งหักทั้งหมด"],
["TKD-004","EVERLAST Kick Boxing Trainer (เล็ก)","Everlast","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",0,1,0,0,"กิ่งหักทั้งหมด"],
["TKD-005","หุ่นซ้อมมวย สีแดง","HITMAN","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",2,0,0,0,""],
["TKD-006","หุ่นซ้อมมวย สีน้ำเงิน","HITMAN","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",2,0,0,0,""],
["TKD-007","ชุดป้องกันตัว (เบอร์ 1-4)","WTF","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",23,3,0,0,"เบอร์1=6 เบอร์2=7 เบอร์3=9 เบอร์4=4"],
["TKD-008","เป้า POWER KICK","WTF","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",0,10,0,0,"ชำรุดมาก"],
["TKD-009","เป้า POWER KICK","Pro Kicker","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",8,4,0,0,""],
["TKD-010","เป้า SPEED KICK สีดำ","WTF","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",3,5,0,0,""],
["TKD-011","เป้า SPEED KICK","Kick","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",18,2,0,0,""],
["TKD-012","Headgear เกราะสวมศีรษะ","WTF","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",2,0,0,0,""],
["TKD-013","เฮดการ์ด สีน้ำเงิน","","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",4,4,0,0,""],
["TKD-014","เฮดการ์ด สีแดง","","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",4,5,0,0,""],
["TKD-015","แผ่นพื้นยางจิ๊กซอว์ สีน้ำตาล","BROWN 003","TKD","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",178,0,0,0,""],
["GEN-003","ชุด Cone Hurdle","","GEN","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",20,5,0,0,"⚠️ ต้องยืนยันยอดใหม่"],
["GEN-004","Speed Ring วงกลมฝึกการเคลื่อนไหว","","GEN","ห้องเทควันโด 1","มิสวรรณา จิรพลานุรักษ์",2,8,0,0,"⚠️ ต้องยืนยันยอดใหม่"],
["GLF-001","ไม้กอล์ฟ (เหล็ก)","","GLF","ห้องไดร์ฟกอล์ฟ","ยังไม่ระบุ",30,0,0,0,""],
["GLF-002","พัตเตอร์","","GLF","ห้องไดร์ฟกอล์ฟ","ยังไม่ระบุ",30,0,0,0,""],
["GLF-003","ลูกกอล์ฟ (สำรอง)","toppoint","GLF","ห้องไดร์ฟกอล์ฟ","ยังไม่ระบุ",2000,0,0,0,"วัสดุสิ้นเปลือง"],
["GLF-004","พรมสวิง","","GLF","ห้องไดร์ฟกอล์ฟ","ยังไม่ระบุ",6,0,0,0,""],
["GLF-011","ถุงกอล์ฟพร้อมไม้กอล์ฟ (สนามชิพ)","","GLF","สนามชิพกอล์ฟ","ยังไม่ระบุ",7,0,0,0,""],
["CLB-001","Harness","Black Diamond","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",9,0,0,0,""],
["CLB-004","รองเท้าปีนหน้าผา","Mad Rock","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",8,0,0,0,""],
["CLB-009","Auto Belay","Perfect Descent","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",2,1,0,0,"ชำรุด รอตรวจเช็ค"],
["CLB-011","Quickdraw ควิกดรอว์","Black Diamond","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",55,0,0,0,""],
["CLB-018","เบาะกันกระแทก 6 นิ้ว ยาว 8 ม.","","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",0,1,0,0,"ผ้าใบขาด"],
["CLB-022","ตัวจับปีนหน้าผา สีเหลือง","","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",79,2,0,0,""],
["CLB-024","ตัวจับปีนหน้าผา สีเทา","","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",100,1,0,0,""],
["CLB-026","ตัวจับปีนหน้าผา สีม่วง","","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",79,0,0,0,""],
["CLB-027","ตัวจับปีนหน้าผา สีเขียว","","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",474,0,0,0,""],
["CLB-029","ตัวจับปีนหน้าผา สีชมพู","","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",142,1,0,0,""],
["CLB-030","ตัวจับปีนหน้าผา สีน้ำเงิน","","CLB","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",66,0,0,0,""],
["FAC-016","บันไดอลูมิเนียม 12 ขั้น","","FAC","ผนังปีนหน้าผา","ม.ชาญวิทย์ พึ่งอิ่ม",2,1,0,0,"⚠️ อารีน่ายืมใช้งาน 1 ตัว"],
["FBL-001","เสาประตูฟุตบอลพร้อมตาข่าย","FBT","FBL","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",1,0,0,0,"ซ่อมแล้ว ตาข่ายขาด"],
["GEN-007","กรวยจราจร เล็ก","FBT","GEN","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",7,3,0,0,""],
["GEN-008","รั้วกระโดดปรับได้ WT 9\"/12\"","FBT","GEN","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",2,7,0,0,"⚠️ ต้องยืนยันยอดใหม่"],
["GEN-009","รั้วกระโดดปรับได้ WT 6\"/12\"","FBT","GEN","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",8,2,0,0,""],
["GEN-010","เทรนนิ่งมาร์กโคน","GRAND SPORT","GEN","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",10,30,0,0,"1 ชุด 40 อัน"],
["GEN-011","สปีดแลดเดอร์ ยาว 4 เมตร","FBT","GEN","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",0,1,0,0,""],
["GEN-013","กระเป๋าใส่ลูกบอลใหญ่","FBT","GEN","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",3,2,0,0,""],
["FAC-020","รั้วตาข่ายกั้นสนาม","","FAC","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",0,16,0,0,""],
["UNI-014","เสื้อเอี๊ยม สีส้ม","KIPSTA","UNI","สนามฟุตซอล","ม.ชาญวิทย์ พึ่งอิ่ม",8,0,0,0,"⚠️ ต้องยืนยันยอดใหม่"],
["UNI-015","เสื้อเอี๊ยม สีเขียว","KIPSTA","UNI","สนามฟุตซอล","ม.ชาญวิทย์ พึ่งอิ่ม",7,0,0,0,"⚠️ ต้องยืนยันยอดใหม่"],
["TEN-001","ตะกร้าใส่ลูกเทนนิสพร้อมล้อ","","TEN","คอร์ตเทนนิส","ม.ชาญวิทย์ พึ่งอิ่ม",0,2,0,0,""],
["TEN-002","เสาเทนนิส แบบมีเฟือง (ชุดที่ 1)","","TEN","คอร์ตเทนนิส","ม.ชาญวิทย์ พึ่งอิ่ม",0,2,0,0,""],
["TEN-003","เสาเทนนิส แบบมีเฟือง (ชุดที่ 2)","","TEN","คอร์ตเทนนิส","ม.ชาญวิทย์ พึ่งอิ่ม",0,1,0,0,""],
["FUT-005","ลูกฟุตซอล สีขาว-ฟ้า (ใหม่)","Molten","FUT","สนามฟุตซอล","ม.ชาญวิทย์ พึ่งอิ่ม",22,0,0,0,""],
["BKB-004","ลูกบาสเกตบอล SPALDING เบอร์ 5","SPALDING","BKB","สนามบาสเกตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",10,15,0,0,""],
["BKB-005","ลูกบาสเกตบอล SPALDING เบอร์ 6","SPALDING","BKB","สนามบาสเกตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",12,15,0,0,""],
["BKB-006","ลูกบาสเกตบอล Molten เบอร์ 7","Molten","BKB","สนามบาสเกตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",25,15,0,0,""],
["FBL-003","ลูกฟุตบอล Molten","Molten","FBL","สนามฟุตบอล","ม.ชาญวิทย์ พึ่งอิ่ม",50,25,0,0,""],
];

function seedItems() {
  return RAW_ITEMS.map((r, i) => {
    const [code, name, brand, catCode, loc, owner, normal, damaged, lost, disposed, note] = r;
    return {
      id: `${code}-${i}`, code, name, brand, catCode, loc, owner,
      normal, damaged, lost, disposed, borrowed: 0,
      minAlert: normal + damaged > 0 && normal <= 2 ? 2 : 0,
      price: 0, note, imageUrl: "",
    };
  });
}

const STAFF = [
  { id: "10645", name: "น.ส.วรรณา จิรพลานุรักษ์", dept: "ศูนย์กีฬา", role: "สอนกีฬา แผนก EP", phone: "099-453-0235", level: "L1" },
  { id: "10668", name: "นายชวินทร์ โรยอุตระ", dept: "ศูนย์กีฬา", role: "งานศูนย์กีฬา", phone: "085-155-4533", level: "L2" },
  { id: "10691", name: "น.ส.รัตนาภรณ์ ลิ้มทุติเนตร", dept: "งานสระว่ายน้ำ", role: "หัวหน้างานสระว่ายน้ำ", phone: "084-356-5748", level: "L2" },
  { id: "10692", name: "นายชาญวิทย์ พึ่งอิ่ม", dept: "ศูนย์กีฬา", role: "หัวหน้าศูนย์กีฬา", phone: "089-524-1646", level: "L3" },
  { id: "10711", name: "นายณัฐวุฒิ ดอกกฐิน", dept: "งานกิจกรรมนักเรียน", role: "งานกิจกรรมนักเรียน/งานสอนกีฬา", phone: "087-763-3250", level: "L1" },
  { id: "10755", name: "นายศุภรักษ์ สุขพันธ์", dept: "ศูนย์กีฬา", role: "ดูแล ACT Sport Arena/สอนกีฬาเทนนิส", phone: "080-665-5530", level: "L1" },
  { id: "10788", name: "น.ส.มลาภรณ์ ซังปาน", dept: "ศูนย์กีฬา", role: "งานจัดการเรียนการสอนศูนย์กีฬา", phone: "090-708-6748", level: "L2" },
  { id: "10800", name: "นายสุขพงษ์ ประดับพลอย", dept: "ศูนย์กีฬา", role: "ครูผู้สอน ฟุตบอลป.6", phone: "099-396-7779", level: "L1" },
  { id: "10804", name: "นายกรภัทร์ นิ่มนวน", dept: "ศูนย์กีฬา", role: "ครูผู้สอน ฟุตบอลป.4", phone: "087-714-8914", level: "L1" },
  { id: "10819", name: "นายรณกฤต พรจิรกิตติพงศ์", dept: "ศูนย์ฟิตเนส", role: "ผู้ประสานงานศูนย์ฟิตเนส", phone: "081-410-1200", level: "L2" },
  { id: "10830", name: "น.ส.ภวรัญชน์ ผลเจริญ", dept: "ศูนย์กีฬา", role: "งานศูนย์กีฬา", phone: "095-167-4514", level: "L2" },
  { id: "20242", name: "นางวรัญญา ตันพิริยะกุล", dept: "ศูนย์กีฬา", role: "ธุรการศูนย์กีฬา", phone: "095-567-9360", level: "L2" },
  { id: "20246", name: "น.ส.ธนัญญา แสงศิโรเวฐน์", dept: "ศูนย์ฟิตเนส", role: "ประจำเคาท์เตอร์ศูนย์ฟิตเนส", phone: "", level: "L1" },
  { id: "20197", name: "นายธนกร บุญจรัส", dept: "งานสระว่ายน้ำ", role: "ผู้ฝึกสอนกีฬาว่ายน้ำ", phone: "084-209-6530", level: "L1" },
  { id: "62271", name: "นางจำปี เอี่ยมกลิ่น", dept: "งานสระว่ายน้ำ", role: "พนักงานประจำสระว่ายน้ำ", phone: "064-131-8663", level: "L1" },
  { id: "10360", name: "น.ส.เพชรพรรณ์ เหมะสุรินทร์", dept: "งานสระว่ายน้ำ", role: "ประจำเคาท์เตอร์สระว่ายน้ำ", phone: "083-023-2618", level: "L1" },
  { id: "50013", name: "น.ส.กนกวรรณ หม่องสนธิ", dept: "ศูนย์กีฬา", role: "งานการเรียนการสอนกีฬา/สอนเต้น", phone: "063-1596459", level: "L1" },
  { id: "50051", name: "นายธีระพงศ์ ปานเด", dept: "ศูนย์กีฬา", role: "ผู้ฝึกสอนวิชาศิลปะการเต้น/สอนวิชาศิลป์ดนตรี ม.4-6", phone: "099-289-8366", level: "L1" },
  { id: "50052", name: "น.ส.กฤติยา ต่อสกุล", dept: "ศูนย์กีฬา", role: "ผู้ฝึกสอนวิชาศิลปะการเต้น", phone: "088-646-6368", level: "L2" },
  { id: "50053", name: "น.ส.ภวรัญชน์ ผลเจริญ", dept: "บริหารฝ่าย", role: "", phone: "096-642-9968", level: "L2" },
  { id: "50060", name: "นายธภัทร์ ถิ่นทิพย์", dept: "สระว่ายน้ำ", role: "ผู้ฝึกสอนทีมสโมสรว่ายน้ำ/ดูแลสระว่ายน้ำ", phone: "080-054-6597", level: "L1" },
  { id: "50062", name: "นายอนุวัฒน์ เทพประเทียน", dept: "ศูนย์กีฬา", role: "ผู้ฝึกสอนวิชาเทเบิลเทนนิส/สอนเทเบิลเทนนิส", phone: "085095943", level: "L1" },
  { id: "40001", name: "นายวุฒิพร ไชยเผือก", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเทควันโด", phone: "083-5555727", level: "L1" },
  { id: "40002", name: "นายกรณ์พงษ์ พงษ์ศิริปรีดา", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเทควันโด", phone: "081-7713306", level: "L1" },
  { id: "40004", name: "นายวิทวัส ศรีระโส", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเทควันโด", phone: "084-7329426", level: "L1" },
  { id: "40005", name: "นายณัทพงษ์ ศรีไชยกิจ", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเทควันโด", phone: "085-5167152", level: "L1" },
  { id: "40008", name: "น.สณัฏฐกันย์ วรรณตุง", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเทควันโด", phone: "086-9943119", level: "L1" },
  { id: "40009", name: "นายธนรัฐ จาตุกานต์นนท์", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนกอล์ฟ", phone: "082-6639149", level: "L1" },
  { id: "40021", name: "นายประทีป กลับบ้านเกาะ", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนว่ายน้ำ", phone: "097-2950564", level: "L1" },
  { id: "40022", name: "นายศาสตรา อินทรประเสริฐ", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเทนนิส", phone: "091-8746480", level: "L1" },
  { id: "40023", name: "นายสิรภพ จิรจตุรพักตร์", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนปีนหน้าผา", phone: "065-4788744", level: "L1" },
  { id: "40023", name: "นายอัมรินทร์ จุลแวง", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนมวยไทย", phone: "094-5678983", level: "L1" },
  { id: "40024", name: "นายทศพล ภูสมหมาย", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนปีนหน้าผา", phone: "095-5071621", level: "L1" },
  { id: "40025", name: "นายประพัฒน์ เจริญเณรรักษา", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนว่ายน้ำ", phone: "094-5501256", level: "L1" },
  { id: "40030", name: "นายเอกพงษ์ แสงเขียว", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนว่ายน้ำ", phone: "083-102-4750", level: "L1" },
  { id: "40031", name: "นายคชภัค กุลกวีวุฒิ", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนว่ายน้ำ", phone: "089-513-2239", level: "L1" },
  { id: "40033", name: "นายณัฐวินท์ ลิ่มสกุล", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนกอล์ฟ", phone: "082-5274340", level: "L1" },
  { id: "40036", name: "นายแหลมทอง รัตนสมัย", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนมวย", phone: "086-019-8341", level: "L1" },
  { id: "40037", name: "นายอานุภาพ พณิชีพ", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนปีนผา", phone: "0887256147", level: "L1" },
  { id: "40038", name: "นายธีรศักดิ์ อินต๊ะเรือน", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนฟุตซอล", phone: "0852495268", level: "L1" },
  { id: "40039", name: "นายกรวสิษฎิ์ แก้วกระหนก", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเต้น", phone: "0825659923", level: "L1" },
  { id: "40040", name: "น.ส.มนต์ทิรา พรหมาพันธุ์", dept: "ครูสอนกีฬาพิเศษ", role: "เทควันโด", phone: "095-905-0368", level: "L1" },
  { id: "40043", name: "นายอมรเทพ เจริญชัย", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนปีนผา", phone: "064-348-3071", level: "L1" },
  { id: "40044", name: "นายรุ่งรดิศ ทานะมัย", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนฟุตซอล", phone: "629355988", level: "L1" },
  { id: "40045", name: "นายวัชระ เขียวอุ่ม", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนเต้น", phone: "0826748604", level: "L1" },
  { id: "40047", name: "นายกศมพงศ์ ไตรสมบูรณ์", dept: "ครูสอนกีฬาพิเศษ", role: "ครูสอนว่ายน้ำ", phone: "080-264-2915", level: "L1" },
  { id: "60001", name: "น.ส.สุชารัตน์ ภาพทอง", dept: "ศูนย์ฟิตเนส", role: "ครูสอนคลาส Yoga", phone: "087-0564-696", level: "L1" },
  { id: "60002", name: "น.ส.วนิดา จิรเจริญจิตต์", dept: "ศูนย์ฟิตเนส", role: "ครูสอนคลาส Yoga", phone: "085-3306-629", level: "L1" },
  { id: "60005", name: "นายเจษฎา พินิจมั้ง", dept: "ศูนย์ฟิตเนส", role: "ครูสอนคลาส Weight Training", phone: "097-1313063", level: "L1" },
  { id: "60007", name: "นายพีรวัส ชูเพชร", dept: "ศูนย์ฟิตเนส", role: "ครูสอนคลาส Gym Ball", phone: "087-1094565", level: "L1" },
  { id: "60006", name: "นายกรันติพล โชคศักดิ์ศรีกุล", dept: "ศูนย์ฟิตเนส", role: "ครูสอนคลาส Mind & Body", phone: "085-9952-464", level: "L1" },
  { id: "60008", name: "น.ส.ชฏาภรณ์ จันทะหงษ์", dept: "ศูนย์ฟิตเนส", role: "ครูสอนคลาส Zumba Dance", phone: "080-1101-160", level: "L1" },
  { id: "60009", name: "นายมานิตย์ บุบผาสุข", dept: "ศูนย์ฟิตเนส", role: "ครูสอนคลาส Power Fighting", phone: "090-9722716", level: "L1" },
];

const USERS = [
  { id: "T00500", name: "มิสสุพัตรา แสงทอง", role: "L0", dept: "กลุ่มสาระภาษาไทย (นอกสังกัดศูนย์กีฬา)", title: "ครูนอกสังกัดศูนย์กีฬา" },
  { id: "T00212", name: "ม.อนุวัฒน์ เทพประเทียน", role: "L1", dept: "เทเบิลเทนนิส", title: "ครูผู้สอน" },
  { id: "T00088", name: "มิสวรรณา จิรพลานุรักษ์", role: "L2", dept: "เทควันโด", title: "เจ้าหน้าที่ปฏิบัติการ" },
  { id: "T00125", name: "ม.ชาญวิทย์ พึ่งอิ่ม", role: "L3", dept: "ศูนย์กีฬา", title: "หัวหน้าศูนย์กีฬา" },
  { id: "T00004", name: "ดร.ประภาส วิริยะกิจ", role: "L4", dept: "ฝ่ายกิจการนักเรียน", title: "หัวหน้าฝ่ายกิจการนักเรียน" },
];

const ROLE_META = {
  L0: { label: "L0 · ครูนอกสังกัด", dash: "ยืม–คืนอุปกรณ์เท่านั้น", tint: C.crimson },
  L1: { label: "L1 · Teacher", dash: "MY WORKSPACE", tint: C.navySoft },
  L2: { label: "L2 · Staff", dash: "OPERATIONS CENTER", tint: C.navy },
  L3: { label: "L3 · Manager", dash: "RESOURCE COMMAND CENTER", tint: C.crimson },
  L4: { label: "L4 · Executive", dash: "EXECUTIVE OVERVIEW · READ ONLY", tint: C.gold },
};

const NAV = {
  L0: [["borrow", "ยืม–คืนอุปกรณ์", ArrowLeftRight]],
  L1: [["dashboard", "งานของฉัน", LayoutDashboard], ["borrow", "ยืม–คืน", ArrowLeftRight], ["damage", "แจ้งชำรุด", Wrench]],
  L2: [["dashboard", "ภาพรวมปฏิบัติการ", LayoutDashboard], ["inventory", "ครุภัณฑ์", Package], ["facility", "สถานที่", MapPin], ["borrow", "ยืม–คืน", ArrowLeftRight], ["damage", "ชำรุด–ซ่อม", Wrench], ["staff", "บุคลากร", Users]],
  L3: [["dashboard", "ภาพรวมระบบ", LayoutDashboard], ["inventory", "ครุภัณฑ์", Package], ["facility", "สถานที่", MapPin], ["borrow", "ยืม–คืน", ArrowLeftRight], ["damage", "ชำรุด–ซ่อม", Wrench], ["staff", "บุคลากร", Users], ["analytics", "วิเคราะห์ข้อมูล", BarChart3], ["reports", "รายงาน", FileText], ["actions", "สั่งการบริหาร", Sparkles]],
  L4: [["dashboard", "ภาพรวมผู้บริหาร", LayoutDashboard], ["inventory", "ครุภัณฑ์", Package], ["facility", "สถานที่", MapPin], ["borrow", "ยืม–คืน", ArrowLeftRight], ["damage", "ชำรุด–ซ่อม", Wrench], ["staff", "บุคลากร", Users], ["analytics", "วิเคราะห์ข้อมูล", BarChart3], ["reports", "รายงาน", FileText]],
};

const canEdit = (role) => role === "L2" || role === "L3";
const canManage = (role) => role === "L3";
const isReadOnly = (role) => role === "L4";

function catName(code) { return CATEGORIES.find((c) => c.code === code)?.name || code; }
function statusOf(it) {
  const avail = it.normal - it.borrowed;
  if (avail <= 0 && it.normal === 0) return { key: "out", label: "หมดสต๊อก", fg: C.bad, bg: C.badBg };
  if (it.damaged > 0 && it.damaged >= it.normal) return { key: "risk", label: "เสี่ยงสูง", fg: C.bad, bg: C.badBg };
  if (it.damaged > 0) return { key: "watch", label: "ต้องจับตา", fg: C.warn, bg: C.warnBg };
  return { key: "ok", label: "ปกติ", fg: C.ok, bg: C.okBg };
}

/* ============================================================
   SMALL UI PRIMITIVES
   ============================================================ */
function Pill({ children, fg, bg }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium"
      style={{ color: fg, background: bg, border: `1px solid ${fg}33` }}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, icon: Icon, small }) {
  const base = "inline-flex items-center gap-1.5 font-medium transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed";
  const sizing = small ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  const styles = {
    primary: { background: C.navy, color: C.white },
    crimson: { background: C.crimson, color: C.white },
    ghost: { background: "transparent", color: C.navy, border: `1px solid ${C.line}` },
    gold: { background: C.gold, color: C.white },
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${sizing}`} style={styles[variant]}>
      {Icon && <Icon size={small ? 13 : 15} />}
      {children}
    </button>
  );
}

function SectionHead({ eyebrow, title, sub, right }) {
  return (
    <div className="flex items-end justify-between mb-5 pb-4" style={{ borderBottom: `2px solid ${C.navy}` }}>
      <div>
        <div className="text-xs font-semibold tracking-wide mb-1" style={{ color: C.crimson }}>{eyebrow}</div>
        <h1 className="text-2xl font-bold" style={{ color: C.ink }}>{title}</h1>
        {sub && <p className="text-sm mt-1" style={{ color: C.slate }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function StatCard({ label, value, sub, tone = "navy", icon: Icon }) {
  const tones = { navy: C.navy, crimson: C.crimson, gold: C.gold, ok: C.ok, warn: C.warn };
  return (
    <div className="p-4" style={{ background: C.white, border: `1px solid ${C.line}`, borderTop: `3px solid ${tones[tone]}` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: C.slate }}>{label}</span>
        {Icon && <Icon size={16} style={{ color: tones[tone] }} />}
      </div>
      <div className="text-2xl font-bold" style={{ color: C.ink }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: C.mute }}>{sub}</div>}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,26,62,0.55)" }}>
      <div className="w-full flex flex-col" style={{ maxWidth: wide ? 640 : 460, maxHeight: "88vh", background: C.white, border: `1px solid ${C.line}` }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.line}` }}>
          <h3 className="font-bold text-base" style={{ color: C.navy }}>{title}</h3>
          <button onClick={onClose}><X size={18} style={{ color: C.slate }} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-semibold mb-1" style={{ color: C.slate }}>{label}</span>
      {children}
    </label>
  );
}
const inputStyle = { border: `1px solid ${C.line}`, padding: "8px 10px", width: "100%", fontFamily: FONT, fontSize: 14, color: C.ink, background: C.white };

/* ============================================================
   MAIN APP
   ============================================================ */
export default function App() {
  const [user, setUser] = useState(null);
  const [loginId, setLoginId] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState(seedItems());
  const [borrows, setBorrows] = useState([
    { id: "BR-1001", date: "2026-09-10", borrower: "อารีน่า (หน่วยงานภายนอก)", itemId: null, itemCode: "FAC-016", itemName: "บันไดอลูมิเนียม 12 ขั้น", qty: 1, where: "อารีน่า", purpose: "ใช้งานทั่วไป", due: "2026-09-30", returned: null, status: "borrowed" },
    { id: "BR-1002", date: "2026-09-15", borrower: "ม.ชาญวิทย์ พึ่งอิ่ม", itemId: null, itemCode: "FUT-005", itemName: "ลูกฟุตซอล สีขาว-ฟ้า (ใหม่)", qty: 10, where: "สนามฟุตซอล", purpose: "สอนคาบ ป.5/2", due: "2026-09-15", returned: null, status: "borrowed" },
  ]);
  const [damages, setDamages] = useState([]);
  const [actionsLog, setActionsLog] = useState([]);
  const [staffList, setStaffList] = useState(STAFF);

  const [sheetsError, setSheetsError] = useState("");

  // persistence — Google Sheets backend when API_URL is set, else local shared storage
  useEffect(() => {
    (async () => {
      if (API_URL) {
        try {
          const { items: si, borrows: sb, damages: sd, staff: ss } = await loadFromSheets();
          setItems(si); setBorrows(sb); setDamages(sd);
          if (ss && ss.length) setStaffList(ss);
        } catch (e) { setSheetsError("เชื่อมต่อ Google Sheets ไม่สำเร็จ — กำลังใช้ข้อมูลตัวอย่างในเครื่องแทน"); }
        setLoading(false);
        return;
      }
      try {
        const [i, b, d, a] = await Promise.all([
          window.storage?.get("items", true).catch(() => null),
          window.storage?.get("borrows", true).catch(() => null),
          window.storage?.get("damages", true).catch(() => null),
          window.storage?.get("actions", true).catch(() => null),
        ]);
        if (i?.value) setItems(JSON.parse(i.value));
        if (b?.value) setBorrows(JSON.parse(b.value));
        if (d?.value) setDamages(JSON.parse(d.value));
        if (a?.value) setActionsLog(JSON.parse(a.value));
      } catch (e) { /* first run, no data yet */ }
      setLoading(false);
    })();
  }, []);
  useEffect(() => { if (!loading && !API_URL) window.storage?.set("items", JSON.stringify(items), true).catch(() => {}); }, [items, loading]);
  useEffect(() => { if (!loading && !API_URL) window.storage?.set("borrows", JSON.stringify(borrows), true).catch(() => {}); }, [borrows, loading]);
  useEffect(() => { if (!loading && !API_URL) window.storage?.set("damages", JSON.stringify(damages), true).catch(() => {}); }, [damages, loading]);
  useEffect(() => { if (!loading) window.storage?.set("actions", JSON.stringify(actionsLog), true).catch(() => {}); }, [actionsLog, loading]);

  const handleLogin = (id) => {
    const demo = USERS.find((x) => x.id.toLowerCase() === id.trim().toLowerCase());
    if (demo) { setUser(demo); setTab(demo.role === "L0" ? "borrow" : "dashboard"); setLoginErr(""); return; }
    const s = staffList.find((x) => x.id.toLowerCase() === id.trim().toLowerCase());
    if (s) {
      const role = ["L0", "L1", "L2", "L3", "L4"].includes(s.level) ? s.level : "L1";
      setUser({ id: s.id, name: s.name, role, dept: s.dept, title: s.role });
      setTab(role === "L0" ? "borrow" : "dashboard"); setLoginErr("");
      return;
    }
    setLoginErr("ไม่พบรหัสครู (Teacher ID) นี้ในระบบ — ลองเลือกบัญชีตัวอย่างด้านล่าง");
  };

  const logAction = useCallback((text) => {
    setActionsLog((prev) => [{ id: `A-${Date.now()}`, ts: new Date().toISOString(), user: user?.name, text }, ...prev].slice(0, 200));
  }, [user]);

  if (!user) return <LoginScreen loginId={loginId} setLoginId={setLoginId} onLogin={handleLogin} err={loginErr} />;

  const nav = NAV[user.role];

  return (
    <div className="w-full min-h-screen flex" style={{ fontFamily: FONT, background: C.paper, color: C.ink }}>
      <Sidebar user={user} nav={nav} tab={tab} setTab={setTab} onLogout={() => setUser(null)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} />
        {(!API_URL || sheetsError) && (
          <div className="px-6 py-2 text-xs flex items-center gap-2" style={{ background: sheetsError ? C.badBg : C.goldSoft, color: sheetsError ? C.crimsonDeep : C.crimsonDeep }}>
            <AlertTriangle size={13} />
            {sheetsError || "ยังไม่ได้เชื่อมต่อกับ Google Sheet หลังบ้าน — ตอนนี้ใช้ข้อมูลตัวอย่างในเครื่อง (ดูวิธีเชื่อมต่อใน Code.gs ที่แนบมา)"}
          </div>
        )}
        <main className="flex-1 p-6 overflow-y-auto">
          {tab === "dashboard" && <Dashboard user={user} items={items} borrows={borrows} damages={damages} setTab={setTab} />}
          {tab === "inventory" && <Inventory user={user} items={items} setItems={setItems} logAction={logAction} />}
          {tab === "facility" && <Facility items={items} />}
          {tab === "staff" && <StaffDirectory staff={staffList} setStaffList={setStaffList} user={user} logAction={logAction} />}
          {tab === "borrow" && <Borrowing user={user} items={items} setItems={setItems} borrows={borrows} setBorrows={setBorrows} logAction={logAction} />}
          {tab === "damage" && <DamageMaint user={user} items={items} setItems={setItems} damages={damages} setDamages={setDamages} logAction={logAction} />}
          {tab === "analytics" && <Analytics items={items} />}
          {tab === "reports" && <Reports items={items} borrows={borrows} damages={damages} />}
          {tab === "actions" && <ManagementActions user={user} items={items} setItems={setItems} actionsLog={actionsLog} logAction={logAction} />}
        </main>
      </div>
    </div>
  );
}

/* ============================================================
   LOGIN
   ============================================================ */
function LoginScreen({ loginId, setLoginId, onLogin, err }) {
  return (
    <div className="min-h-screen w-full flex" style={{ fontFamily: FONT, background: "#0A0A0A" }}>
      {/* LEFT — illustration panel, image fills edge-to-edge */}
      <div className="hidden md:block w-[46%] relative overflow-hidden" style={{ borderRight: "3px solid #C9A15A" }}>
        <img src="https://i.postimg.cc/KzSFyxxH/ACT-SPORT-CENTER-(2).png" alt="ACT Sport Center mascots"
          className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center" }} />
      </div>

      {/* RIGHT — brushed-metal glass login panel */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden" style={{
        background: "linear-gradient(135deg,#3a3a3c 0%,#232325 30%,#1a1a1c 60%,#0e0e10 100%)",
      }}>
        {/* brushed-metal texture */}
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: "repeating-linear-gradient(100deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 3px)",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(60% 50% at 70% 20%, rgba(255,255,255,0.08), transparent 60%)",
        }} />

        {/* vertical brand wordmark — real image asset, flush to the top-right corner */}
        <div className="hidden lg:block absolute right-0 top-0 w-24">
          <img src="https://i.postimg.cc/vBFMdbbL/ACT-SPORT-CENTER.png" alt="ACT SPORT CENTER"
            className="w-full" style={{ objectFit: "contain" }} />
        </div>

        {/* developer credit, bottom-right */}
        <div className="absolute bottom-4 right-6 lg:right-32 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Developer : P.Prayoon-Anutep</div>

        <div className="relative w-full max-w-sm mx-6">
          <div className="flex items-center gap-3 mb-6">
            <Users size={30} strokeWidth={1.4} style={{ color: "rgba(255,255,255,0.7)" }} />
            <div>
              <div className="text-lg font-semibold" style={{ color: C.white }}>ACT SportHub</div>
              <div className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>ลงทะเบียนเข้าใช้งานด้วยรหัสประจำตัวครู</div>
            </div>
          </div>

          {/* glass card */}
          <div className="relative p-6" style={{
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
          }}>
            <h2 className="text-xl font-bold mb-5" style={{ color: C.white }}>Login</h2>

            <div className="relative mb-4">
              <User size={15} style={{ position: "absolute", left: 12, top: 13, color: "rgba(255,255,255,0.4)" }} />
              <input value={loginId} onChange={(e) => setLoginId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onLogin(loginId)}
                placeholder="Teacher ID เช่น T00125"
                style={{
                  width: "100%", padding: "10px 12px 10px 34px", fontFamily: FONT, fontSize: 14,
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                  color: C.white, outline: "none",
                }} />
            </div>

            {err && <div className="text-xs mb-3 flex items-center gap-1.5" style={{ color: "#FF9EAE" }}><AlertTriangle size={13} />{err}</div>}

            {/* GO button — circular red gem, glass-card style */}
            <div className="flex items-center gap-3 mt-5">
              <button onClick={() => onLogin(loginId)}
                className="flex-1 py-2.5 text-sm font-semibold"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: C.white }}>
                เข้าสู่ระบบ
              </button>
              <button onClick={() => onLogin(loginId)}
                aria-label="Go"
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center font-bold text-xs"
                style={{
                  background: `radial-gradient(circle at 32% 28%, #ff5a72, ${C.crimson} 45%, ${C.crimsonDeep} 100%)`,
                  boxShadow: "0 0 18px rgba(200,30,58,0.55), inset 0 1px 1px rgba(255,255,255,0.4)",
                  color: C.white,
                }}>
                GO
              </button>
            </div>
          </div>

          <div className="mt-6 text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
            © 2026 Assumption College Thonburi<br />ACT Sport Center Resource Intelligence · v1.0.0
          </div>

          {/* demo accounts */}
          <div className="mt-8 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="text-xs font-semibold mb-3" style={{ color: "rgba(255,255,255,0.45)" }}>บัญชีตัวอย่างสำหรับสาธิตแต่ละระดับสิทธิ์</div>
            <div className="space-y-2">
              {USERS.map((u) => (
                <button key={u.id} onClick={() => onLogin(u.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                  style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>{u.name}</div>
                    <div className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{u.title} · {u.id}</div>
                  </div>
                  <Pill fg={C.accent} bg="rgba(228,53,79,0.12)">{ROLE_META[u.role].label}</Pill>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SIDEBAR / TOPBAR
   ============================================================ */
function Sidebar({ user, nav, tab, setTab, onLogout }) {
  return (
    <aside className="w-60 shrink-0 flex flex-col" style={{ background: C.navyDeep }}>
      <div className="px-5 py-5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <Trophy size={20} style={{ color: C.accent }} />
        <div>
          <div className="text-white font-bold text-sm leading-tight">ACT SPORT CENTER</div>
          <div className="text-[11px]" style={{ color: "#93A0C4" }}>Resource Intelligence</div>
        </div>
      </div>
      <nav className="flex-1 py-4">
        {nav.map(([key, label, Icon]) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)}
              className="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-left transition-colors"
              style={{
                color: active ? C.white : "#AEB8D6",
                background: active ? "rgba(255,255,255,0.08)" : "transparent",
                borderLeft: active ? `3px solid ${C.accent}` : "3px solid transparent",
              }}>
              <Icon size={16} />{label}
            </button>
          );
        })}
      </nav>
      <div className="px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <button onClick={onLogout} className="flex items-center gap-2 text-xs" style={{ color: "#93A0C4" }}>
          <LogOut size={13} /> ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}

function TopBar({ user }) {
  const meta = ROLE_META[user.role];
  return (
    <header className="flex items-center justify-between px-6 py-4" style={{ background: C.white, borderBottom: `1px solid ${C.line}` }}>
      <div>
        <div className="text-xs font-semibold tracking-wide" style={{ color: meta.tint }}>{meta.dash}</div>
      </div>
      <div className="flex items-center gap-4">
        {user.role === "L4" && (
          <Pill fg={C.gold} bg={C.goldSoft}><Eye size={12} /> โหมดดูอย่างเดียว</Pill>
        )}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center" style={{ background: meta.tint, color: C.white }}>
            <User size={15} />
          </div>
          <div className="text-right">
            <div className="text-sm font-medium leading-tight" style={{ color: C.ink }}>{user.name}</div>
            <div className="text-xs" style={{ color: C.mute }}>{user.title}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ============================================================
   DASHBOARD (role-adaptive)
   ============================================================ */
function computeKpis(items, borrows) {
  const total = items.length;
  const normal = items.reduce((s, i) => s + i.normal, 0);
  const damaged = items.reduce((s, i) => s + i.damaged, 0);
  const lost = items.reduce((s, i) => s + i.lost, 0);
  const disposed = items.reduce((s, i) => s + i.disposed, 0);
  const activeBorrows = borrows.filter((b) => b.status === "borrowed").length;
  const overdue = borrows.filter((b) => b.status === "borrowed" && new Date(b.due) < new Date("2026-09-15")).length;
  const outOfStock = items.filter((i) => i.normal === 0).length;
  const watch = items.filter((i) => i.damaged > 0).length;
  return { total, normal, damaged, lost, disposed, activeBorrows, overdue, outOfStock, watch };
}

function Dashboard({ user, items, borrows, damages, setTab }) {
  const k = computeKpis(items, borrows);
  const byCat = useMemo(() => {
    const m = {};
    items.forEach((i) => {
      m[i.catCode] = m[i.catCode] || { cat: catName(i.catCode), ok: 0, damaged: 0 };
      m[i.catCode].ok += i.normal; m[i.catCode].damaged += i.damaged;
    });
    return Object.values(m).sort((a, b) => b.damaged - a.damaged).slice(0, 8);
  }, [items]);

  const topDamaged = useMemo(() => [...items].filter((i) => i.damaged > 0).sort((a, b) => b.damaged - a.damaged).slice(0, 6), [items]);

  if (user.role === "L1") {
    const mine = borrows.filter((b) => b.borrower === user.name);
    return (
      <div>
        <SectionHead eyebrow="MY WORKSPACE" title={`สวัสดี, ${user.name}`} sub="รายการยืม–คืนและงานของคุณ" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="กำลังยืมอยู่" value={mine.filter((b) => b.status === "borrowed").length} icon={ArrowLeftRight} tone="navy" />
          <StatCard label="เกินกำหนดคืน" value={mine.filter((b) => b.status === "borrowed" && new Date(b.due) < new Date("2026-09-15")).length} icon={AlertTriangle} tone="crimson" />
          <StatCard label="คืนแล้วทั้งหมด" value={mine.filter((b) => b.status === "returned").length} icon={CheckCircle2} tone="ok" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <QuickAction icon={ArrowLeftRight} title="ยืมอุปกรณ์" desc="ค้นหาอุปกรณ์ที่พร้อมใช้และส่งคำขอยืม" onClick={() => setTab("borrow")} />
          <QuickAction icon={Wrench} title="แจ้งของชำรุด" desc="รายงานอุปกรณ์ที่พบว่าชำรุดหรือใช้งานไม่ได้" onClick={() => setTab("damage")} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHead eyebrow={ROLE_META[user.role].dash} title="ภาพรวมทรัพยากรศูนย์กีฬา" sub="อัปเดตแบบเรียลไทม์จากทะเบียนครุภัณฑ์และรายการยืม–คืน" />
      <div className="grid grid-cols-4 gap-4 mb-4">
        <StatCard label="รายการทั้งหมด" value={k.total} tone="navy" icon={Package} />
        <StatCard label="ใช้งานได้ (ชิ้น)" value={k.normal.toLocaleString()} tone="ok" icon={CheckCircle2} />
        <StatCard label="ชำรุด (ชิ้น)" value={k.damaged.toLocaleString()} tone="crimson" icon={Wrench} />
        <StatCard label="ถูกยืมอยู่" value={k.activeBorrows} sub={k.overdue > 0 ? `${k.overdue} เกินกำหนด` : "ไม่มีเกินกำหนด"} tone="gold" icon={ArrowLeftRight} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="col-span-2 p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold" style={{ color: C.navy }}>สุขภาพทรัพยากรแยกตามหมวด (Top 8 ชำรุดสูงสุด)</h3>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={byCat} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
              <XAxis dataKey="cat" tick={{ fontSize: 11, fontFamily: FONT }} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontFamily: FONT, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: FONT }} />
              <Bar dataKey="ok" name="ใช้งานได้" fill={C.navy} />
              <Bar dataKey="damaged" name="ชำรุด" fill={C.crimson} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: C.navy }}>รายการชำรุดมากที่สุด</h3>
          <div className="space-y-2.5">
            {topDamaged.map((it) => (
              <div key={it.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium" style={{ color: C.ink }}>{it.name}</div>
                  <div className="text-xs" style={{ color: C.mute }}>{it.code}</div>
                </div>
                <Pill fg={C.crimson} bg={C.badBg}>{it.damaged}</Pill>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4" style={{ background: C.badBg, border: `1px solid #E9B9C1` }}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} style={{ color: C.crimson, marginTop: 2 }} />
          <div>
            <div className="text-sm font-bold" style={{ color: C.crimsonDeep }}>คำแนะนำเชิงบริหาร</div>
            <p className="text-sm mt-1" style={{ color: "#5B2430" }}>
              หมวด <b>{byCat[0]?.cat}</b> มีอัตราชำรุดสูงสุด ({byCat[0]?.damaged} ชิ้น) — แนะนำให้พิจารณา
              ซ่อม/จัดซื้อทดแทน และตรวจสอบ {k.watch} รายการที่มีของชำรุดปนอยู่กับของปกติในทะเบียน
            </p>
            {user.role === "L3" && <button onClick={() => setTab("actions")} className="text-xs font-semibold mt-2 underline" style={{ color: C.crimsonDeep }}>ไปที่หน้าสั่งการบริหาร →</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, title, desc, onClick }) {
  return (
    <button onClick={onClick} className="text-left p-5 flex items-start gap-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
      <div className="w-10 h-10 flex items-center justify-center shrink-0" style={{ background: C.navy }}>
        <Icon size={18} color={C.white} />
      </div>
      <div>
        <div className="font-bold text-sm" style={{ color: C.ink }}>{title}</div>
        <div className="text-xs mt-1" style={{ color: C.slate }}>{desc}</div>
      </div>
    </button>
  );
}

/* ============================================================
   INVENTORY
   ============================================================ */
function Inventory({ user, items, setItems, logAction }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("ALL");
  const [edit, setEdit] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const editable = canEdit(user.role) || canManage(user.role);
  const manager = canManage(user.role);

  const filtered = items.filter((i) =>
    (cat === "ALL" || i.catCode === cat) &&
    (i.name.toLowerCase().includes(q.toLowerCase()) || i.code.toLowerCase().includes(q.toLowerCase()))
  );

  const saveEdit = (patch) => {
    setItems((prev) => prev.map((i) => (i.id === edit.id ? { ...i, ...patch } : i)));
    logAction(`แก้ไขครุภัณฑ์ ${edit.code} — ${edit.name}`);
    postToSheets("updateItem", { code: edit.code, ...patch });
    setEdit(null);
  };

  const addItem = (form) => {
    const rec = { id: form.code, code: form.code, name: form.name, brand: form.brand, catCode: form.catCode,
      loc: form.loc, owner: form.owner, normal: form.normal, damaged: form.damaged, lost: 0, disposed: 0,
      borrowed: 0, minAlert: form.minAlert, price: form.price, note: form.note, imageUrl: "" };
    setItems((prev) => [rec, ...prev]);
    logAction(`เพิ่มครุภัณฑ์ใหม่ ${form.code} — ${form.name}`);
    postToSheets("addItem", { ...form, catName: catName(form.catCode) });
    setShowNew(false);
  };

  const deleteItem = (it) => {
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    logAction(`ลบครุภัณฑ์ ${it.code} — ${it.name}`);
    postToSheets("deleteItem", { code: it.code });
    setConfirmDel(null);
  };

  return (
    <div>
      <SectionHead eyebrow="INVENTORY" title="ทะเบียนครุภัณฑ์" sub={`${filtered.length} รายการ จากทั้งหมด ${items.length} รายการ`}
        right={manager ? <Btn onClick={() => setShowNew(true)} icon={Plus}>เพิ่มครุภัณฑ์ใหม่</Btn> : !editable && <Pill fg={C.gold} bg={C.goldSoft}><Eye size={12} /> ดูอย่างเดียว</Pill>} />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: C.mute }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหารหัสหรือชื่ออุปกรณ์..."
            style={{ ...inputStyle, paddingLeft: 32 }} />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...inputStyle, width: 200 }}>
          <option value="ALL">ทุกหมวด</option>
          {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ border: `1px solid ${C.line}`, background: C.white }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.navy, color: C.white }}>
              {["รหัส", "รายการ", "หมวด", "สถานที่", "ปกติ", "ชำรุด", "พร้อมใช้", "สถานะ", ""].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map((it) => {
              const s = statusOf(it);
              const avail = it.normal - it.borrowed;
              return (
                <tr key={it.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: C.slate }}>{it.code}</td>
                  <td className="px-3 py-2 font-medium">
                    <button onClick={() => setPreview(it)} className="text-left hover:underline" style={{ color: C.ink }} title="คลิกเพื่อดูรูปอุปกรณ์">
                      {it.name}{it.brand && <span className="text-xs" style={{ color: C.mute }}> · {it.brand}</span>}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: C.slate }}>{catName(it.catCode)}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: C.slate }}>{it.loc}</td>
                  <td className="px-3 py-2 text-xs">{it.normal}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: it.damaged > 0 ? C.crimson : C.mute, fontWeight: it.damaged > 0 ? 600 : 400 }}>{it.damaged}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{avail}</td>
                  <td className="px-3 py-2"><Pill fg={s.fg} bg={s.bg}>{s.label}</Pill></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {editable ? (
                        <button onClick={() => setEdit(it)}><Pencil size={14} style={{ color: C.navy }} /></button>
                      ) : (
                        <Eye size={14} style={{ color: C.mute }} />
                      )}
                      {manager && <button onClick={() => setConfirmDel(it)}><X size={14} style={{ color: C.crimson }} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={`แก้ไข: ${edit.code}`} onClose={() => setEdit(null)}>
          <ItemEditForm item={edit} onSave={saveEdit} manager={canManage(user.role)} />
        </Modal>
      )}
      {showNew && (
        <Modal title="เพิ่มครุภัณฑ์ใหม่" onClose={() => setShowNew(false)} wide>
          <ItemAddForm onSave={addItem} />
        </Modal>
      )}
      {confirmDel && (
        <Modal title="ยืนยันการลบ" onClose={() => setConfirmDel(null)}>
          <p className="text-sm mb-4" style={{ color: C.ink }}>
            ต้องการลบ <b>{confirmDel.code} — {confirmDel.name}</b> ออกจากทะเบียนใช่หรือไม่? การลบนี้จะลบแถวออกจาก Google Sheet ด้วย และย้อนกลับไม่ได้
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setConfirmDel(null)}>ยกเลิก</Btn>
            <Btn variant="crimson" onClick={() => deleteItem(confirmDel)} icon={X}>ยืนยันลบ</Btn>
          </div>
        </Modal>
      )}
      {preview && (
        <ItemImagePopup
          item={preview}
          onClose={() => setPreview(null)}
          editable={editable}
          onUploaded={(code, url) => {
            setItems((prev) => prev.map((i) => (i.code === code ? { ...i, imageUrl: url } : i)));
            setPreview((prev) => (prev ? { ...prev, imageUrl: url } : prev));
            logAction(`อัปโหลดรูป ${code}`);
          }}
        />
      )}
    </div>
  );
}

function ItemAddForm({ onSave }) {
  const [form, setForm] = useState({ code: "", name: "", brand: "", catCode: CATEGORIES[0].code, loc: "", owner: "", normal: 1, damaged: 0, minAlert: 0, price: 0, note: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNum = (k) => (e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  const valid = form.code.trim() && form.name.trim();
  return (
    <div className="grid grid-cols-2 gap-x-4">
      <Field label="รหัสครุภัณฑ์ *"><input value={form.code} onChange={set("code")} placeholder="เช่น BDM-001" style={inputStyle} /></Field>
      <Field label="ชื่อรายการ *"><input value={form.name} onChange={set("name")} style={inputStyle} /></Field>
      <Field label="ยี่ห้อ/รุ่น"><input value={form.brand} onChange={set("brand")} style={inputStyle} /></Field>
      <Field label="หมวด">
        <select value={form.catCode} onChange={set("catCode")} style={inputStyle}>
          {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="สถานที่เก็บ">
        <select value={form.loc} onChange={set("loc")} style={inputStyle}>
          <option value="">— เลือกสถานที่ —</option>
          {LOCATIONS.map((l) => <option key={l.code} value={l.name}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="ผู้ดูแล"><input value={form.owner} onChange={set("owner")} style={inputStyle} /></Field>
      <Field label="จำนวนปกติ"><input type="number" value={form.normal} onChange={setNum("normal")} style={inputStyle} /></Field>
      <Field label="จำนวนชำรุด"><input type="number" value={form.damaged} onChange={setNum("damaged")} style={inputStyle} /></Field>
      <Field label="ราคา/หน่วย (บาท)"><input type="number" value={form.price} onChange={setNum("price")} style={inputStyle} /></Field>
      <Field label="เตือนเมื่อเหลือ"><input type="number" value={form.minAlert} onChange={setNum("minAlert")} style={inputStyle} /></Field>
      <div className="col-span-2">
        <Field label="หมายเหตุ"><textarea rows={2} value={form.note} onChange={set("note")} style={inputStyle} /></Field>
      </div>
      <div className="col-span-2 flex justify-end mt-2">
        <Btn onClick={() => onSave(form)} disabled={!valid}>บันทึกครุภัณฑ์ใหม่</Btn>
      </div>
    </div>
  );
}

function ItemImagePopup({ item, onClose, editable, onUploaded }) {
  const s = statusOf(item);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const pick = () => fileRef.current?.click();
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(""); setUploading(true);
    try {
      const url = await uploadItemImage(item.code, file);
      onUploaded(item.code, url);
    } catch (ex) {
      setErr(ex.message || "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,10,10,0.65)" }} onClick={onClose}>
      <div className="w-full flex flex-col" style={{ maxWidth: 380, background: C.white, border: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()}>
        <div className="relative flex items-center justify-center overflow-hidden" style={{ height: 200, background: item.imageUrl ? "#000" : `linear-gradient(150deg, ${C.navyDeep}, ${C.navy})` }}>
          <button onClick={onClose} className="absolute top-2 right-2 z-10"><X size={18} color={C.white} /></button>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.name} className="w-full h-full" style={{ objectFit: "cover" }} />
          ) : (
            <>
              <Package size={64} color={C.accent} strokeWidth={1.25} />
              <div className="absolute bottom-2 left-2 text-[11px]" style={{ color: "#C9C9CC" }}>ยังไม่มีรูปถ่ายจริงในระบบ — แสดงไอคอนตัวแทน</div>
            </>
          )}
          {editable && (
            <button onClick={pick} disabled={uploading}
              className="absolute bottom-2 right-2 z-10 px-2.5 py-1 text-xs font-medium flex items-center gap-1"
              style={{ background: "rgba(0,0,0,0.55)", color: C.white, border: "1px solid rgba(255,255,255,0.3)" }}>
              <Plus size={12} /> {uploading ? "กำลังอัปโหลด..." : item.imageUrl ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>
        {err && <div className="px-4 pt-2 text-xs" style={{ color: C.crimson }}>{err}</div>}
        <div className="p-4">
          <div className="text-xs font-mono mb-1" style={{ color: C.mute }}>{item.code}</div>
          <div className="font-bold text-base mb-1" style={{ color: C.ink }}>{item.name}</div>
          {item.brand && <div className="text-xs mb-2" style={{ color: C.slate }}>ยี่ห้อ/รุ่น: {item.brand}</div>}
          <div className="grid grid-cols-2 gap-2 text-xs mb-3" style={{ color: C.slate }}>
            <div>หมวด: <b style={{ color: C.ink }}>{catName(item.catCode)}</b></div>
            <div>สถานที่: <b style={{ color: C.ink }}>{item.loc}</b></div>
            <div>ผู้ดูแล: <b style={{ color: C.ink }}>{item.owner || "ยังไม่ระบุ"}</b></div>
            <div>สถานะ: <Pill fg={s.fg} bg={s.bg}>{s.label}</Pill></div>
          </div>
          {item.note && <div className="text-xs p-2" style={{ background: C.badBg, color: C.crimsonDeep }}>{item.note}</div>}
        </div>
      </div>
    </div>
  );
}

function ItemEditForm({ item, onSave, manager }) {
  const [normal, setNormal] = useState(item.normal);
  const [damaged, setDamaged] = useState(item.damaged);
  const [note, setNote] = useState(item.note || "");
  return (
    <div>
      <Field label="จำนวนปกติ (พร้อมใช้)">
        <input type="number" value={normal} onChange={(e) => setNormal(Number(e.target.value))} style={inputStyle} />
      </Field>
      <Field label="จำนวนชำรุด">
        <input type="number" value={damaged} onChange={(e) => setDamaged(Number(e.target.value))} style={inputStyle} />
      </Field>
      <Field label="หมายเหตุ">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={inputStyle} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Btn variant="primary" onClick={() => onSave({ normal, damaged, note })}>บันทึกการแก้ไข</Btn>
      </div>
      {manager && <p className="text-xs mt-3" style={{ color: C.mute }}>สิทธิ์ผู้จัดการ: การแก้ไขนี้จะถูกบันทึกใน Audit Log</p>}
    </div>
  );
}

/* ============================================================
   FACILITY
   ============================================================ */
function Facility({ items }) {
  const byLoc = useMemo(() => {
    const m = {};
    LOCATIONS.forEach((l) => { m[l.name] = { ...l, count: 0, ok: 0, damaged: 0 }; });
    items.forEach((i) => {
      if (!m[i.loc]) m[i.loc] = { name: i.loc, owner: i.owner, count: 0, ok: 0, damaged: 0 };
      m[i.loc].count += 1; m[i.loc].ok += i.normal; m[i.loc].damaged += i.damaged;
    });
    return Object.values(m);
  }, [items]);

  return (
    <div>
      <SectionHead eyebrow="FACILITY" title="สถานที่และผู้ดูแล" sub="สรุปทรัพยากรแยกตามสถานที่จัดเก็บ / พื้นที่ใช้งาน" />
      <div className="grid grid-cols-3 gap-4">
        {byLoc.map((l) => (
          <div key={l.name} className="p-4" style={{ background: C.white, border: `1px solid ${C.line}`, borderLeft: `3px solid ${l.damaged > l.ok * 0.3 && l.ok > 0 ? C.crimson : C.navy}` }}>
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={15} style={{ color: C.navy }} />
              <span className="font-bold text-sm" style={{ color: C.ink }}>{l.name}</span>
            </div>
            <div className="text-xs mb-3" style={{ color: C.slate }}>ผู้ดูแล: {l.owner || "ยังไม่ระบุ"}</div>
            <div className="flex items-center justify-between text-sm">
              <div><span className="font-bold">{l.count}</span> <span className="text-xs" style={{ color: C.mute }}>รายการ</span></div>
              <div style={{ color: C.ok }}><span className="font-bold">{l.ok}</span> <span className="text-xs">ใช้ได้</span></div>
              <div style={{ color: C.crimson }}><span className="font-bold">{l.damaged}</span> <span className="text-xs">ชำรุด</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   STAFF DIRECTORY — safe subset only (name, dept, role, work phone)
   Full HR data (ID card, salary, address, DOB, religion) is kept
   OUT of this system entirely — delivered separately as an
   internal-only spreadsheet, never wired into the web app or the
   Google Sheets backend.
   ============================================================ */
function StaffDirectory({ staff, setStaffList, user, logAction }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("ALL");
  const [edit, setEdit] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const manager = canManage(user.role);
  const depts = useMemo(() => Array.from(new Set(staff.map((s) => s.dept))), [staff]);
  const filtered = staff.filter((s) =>
    (dept === "ALL" || s.dept === dept) &&
    (s.name.toLowerCase().includes(q.toLowerCase()) || s.role.toLowerCase().includes(q.toLowerCase()))
  );

  const saveEdit = (patch) => {
    setStaffList((prev) => prev.map((s) => (s.id === edit.id ? { ...s, ...patch } : s)));
    logAction(`แก้ไขบุคลากร ${edit.id} — ${edit.name}`);
    postToSheets("updateStaff", { id: edit.id, ...patch });
    setEdit(null);
  };

  const addStaff = (form) => {
    setStaffList((prev) => [{ ...form }, ...prev]);
    logAction(`เพิ่มบุคลากรใหม่ ${form.id} — ${form.name}`);
    postToSheets("addStaff", form);
    setShowNew(false);
  };

  const deleteStaff = (s) => {
    setStaffList((prev) => prev.filter((x) => x.id !== s.id));
    logAction(`ลบบุคลากร ${s.id} — ${s.name}`);
    postToSheets("deleteStaff", { id: s.id });
    setConfirmDel(null);
  };

  return (
    <div>
      <SectionHead eyebrow="STAFF DIRECTORY" title="ทำเนียบบุคลากรศูนย์กีฬา"
        sub={`${filtered.length} คน จากทั้งหมด ${staff.length} คน — แสดงเฉพาะชื่อ/หน่วยงาน/หน้าที่/เบอร์ติดต่องาน (ไม่มีข้อมูลอ่อนไหว)`}
        right={manager ? <Btn onClick={() => setShowNew(true)} icon={Plus}>เพิ่มบุคลากร</Btn> : <Pill fg={C.gold} bg={C.goldSoft}><Eye size={12} /> ดูอย่างเดียว</Pill>} />
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: C.mute }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรือหน้าที่..."
            style={{ ...inputStyle, paddingLeft: 32 }} />
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} style={{ ...inputStyle, width: 220 }}>
          <option value="ALL">ทุกหน่วยงาน</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {filtered.map((s) => (
          <div key={s.id} className="p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center" style={{ background: C.navy, color: C.white }}>
                  <User size={15} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: C.ink }}>{s.name}</div>
                  <div className="text-xs" style={{ color: C.mute }}>{s.dept}</div>
                </div>
              </div>
              {manager && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setEdit(s)}><Pencil size={13} style={{ color: C.navy }} /></button>
                  <button onClick={() => setConfirmDel(s)}><X size={13} style={{ color: C.crimson }} /></button>
                </div>
              )}
            </div>
            <div className="text-xs mb-1" style={{ color: C.slate }}>{s.role || "-"}</div>
            <div className="flex items-center justify-between">
              {s.phone && <div className="text-xs font-mono" style={{ color: C.navySoft }}>{s.phone}</div>}
              {s.level && <Pill fg={ROLE_META[s.level]?.tint || C.navy} bg="#F2F3F7">{s.level}</Pill>}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title={`แก้ไขบุคลากร: ${edit.name}`} onClose={() => setEdit(null)}>
          <StaffForm initial={edit} onSave={saveEdit} idEditable={false} />
        </Modal>
      )}
      {showNew && (
        <Modal title="เพิ่มบุคลากรใหม่" onClose={() => setShowNew(false)}>
          <StaffForm initial={{ id: "", name: "", dept: "", role: "", phone: "", level: "L1" }} onSave={addStaff} idEditable />
        </Modal>
      )}
      {confirmDel && (
        <Modal title="ยืนยันการลบ" onClose={() => setConfirmDel(null)}>
          <p className="text-sm mb-4" style={{ color: C.ink }}>ต้องการลบ <b>{confirmDel.name}</b> ออกจากทำเนียบบุคลากรใช่หรือไม่? การลบนี้จะลบแถวออกจาก Google Sheet ด้วย และย้อนกลับไม่ได้</p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setConfirmDel(null)}>ยกเลิก</Btn>
            <Btn variant="crimson" onClick={() => deleteStaff(confirmDel)} icon={X}>ยืนยันลบ</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StaffForm({ initial, onSave, idEditable }) {
  const [form, setForm] = useState(initial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.id.trim() && form.name.trim();
  return (
    <div>
      <Field label="Teacher ID *"><input value={form.id} onChange={set("id")} disabled={!idEditable} style={{ ...inputStyle, opacity: idEditable ? 1 : 0.6 }} /></Field>
      <Field label="ชื่อ-นามสกุล *"><input value={form.name} onChange={set("name")} style={inputStyle} /></Field>
      <Field label="หน่วยงาน"><input value={form.dept} onChange={set("dept")} style={inputStyle} /></Field>
      <Field label="หน้าที่รับผิดชอบ"><input value={form.role} onChange={set("role")} style={inputStyle} /></Field>
      <Field label="เบอร์โทรงาน"><input value={form.phone} onChange={set("phone")} style={inputStyle} /></Field>
      <Field label="สิทธิ์การใช้งาน (Level)">
        <select value={form.level} onChange={set("level")} style={inputStyle}>
          {["L0", "L1", "L2", "L3", "L4"].map((l) => <option key={l} value={l}>{l} — {ROLE_META[l].label}</option>)}
        </select>
      </Field>
      <div className="flex justify-end mt-2">
        <Btn onClick={() => onSave(form)} disabled={!valid}>บันทึก</Btn>
      </div>
    </div>
  );
}

/* ============================================================
   BORROWING
   ============================================================ */
function Borrowing({ user, items, setItems, borrows, setBorrows, logAction }) {
  const [showNew, setShowNew] = useState(false);
  const editable = canEdit(user.role) || canManage(user.role);
  // L0/L1 can self-service return only their own borrowed items; L2/L3 can process any return
  const canReturn = (b) => editable || b.borrower === user.name;

  const submit = ({ itemId, qty, where, purpose, due }) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const rec = { id: `BR-${Date.now()}`, date: "2026-09-15", borrower: user.name, itemId, itemCode: item.code, itemName: item.name, qty, where, purpose, due, returned: null, status: "borrowed" };
    setBorrows((p) => [rec, ...p]);
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, borrowed: i.borrowed + qty } : i)));
    logAction(`บันทึกการยืม ${item.code} จำนวน ${qty}`);
    postToSheets("borrow", { date: rec.date, borrower: rec.borrower, itemCode: item.code, itemName: item.name, qty, where, purpose, due });
    setShowNew(false);
  };

  const markReturned = (b) => {
    const returnedDate = "2026-09-15";
    setBorrows((p) => p.map((x) => (x.id === b.id ? { ...x, status: "returned", returned: returnedDate } : x)));
    setItems((prev) => prev.map((i) => (i.id === b.itemId ? { ...i, borrowed: Math.max(0, i.borrowed - b.qty) } : i)));
    logAction(`บันทึกการคืน ${b.itemCode}`);
    postToSheets("return", { itemCode: b.itemCode, borrower: b.borrower, returnedDate });
  };

  const available = items.filter((i) => i.normal - i.borrowed > 0);

  return (
    <div>
      <SectionHead eyebrow="BORROWING" title="ยืม–คืนอุปกรณ์" sub="Request → Approved → Borrowed → Return"
        right={<Btn onClick={() => setShowNew(true)} icon={Plus}>บันทึกการยืมใหม่</Btn>} />

      <div style={{ border: `1px solid ${C.line}`, background: C.white }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.navy, color: C.white }}>
              {["วันที่ยืม", "ผู้ยืม", "อุปกรณ์", "จำนวน", "ใช้ที่", "กำหนดคืน", "สถานะ", ""].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {borrows.map((b) => {
              const overdue = b.status === "borrowed" && new Date(b.due) < new Date("2026-09-15");
              return (
                <tr key={b.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td className="px-3 py-2 text-xs">{b.date}</td>
                  <td className="px-3 py-2 font-medium">{b.borrower}</td>
                  <td className="px-3 py-2 text-xs">{b.itemName} <span style={{ color: C.mute }}>({b.itemCode})</span></td>
                  <td className="px-3 py-2 text-xs">{b.qty}</td>
                  <td className="px-3 py-2 text-xs">{b.where}</td>
                  <td className="px-3 py-2 text-xs">{b.due}</td>
                  <td className="px-3 py-2">
                    {b.status === "returned"
                      ? <Pill fg={C.ok} bg={C.okBg}><CheckCircle2 size={11} /> คืนแล้ว</Pill>
                      : overdue ? <Pill fg={C.bad} bg={C.badBg}><AlertTriangle size={11} /> เกินกำหนด</Pill>
                      : <Pill fg={C.warn} bg={C.warnBg}><Clock size={11} /> ยังไม่คืน</Pill>}
                  </td>
                  <td className="px-3 py-2">
                    {canReturn(b) && b.status === "borrowed" && (
                      <button onClick={() => markReturned(b)} className="text-xs font-semibold underline" style={{ color: C.crimson }}>บันทึกคืน</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showNew && (
        <Modal title="บันทึกการยืม" onClose={() => setShowNew(false)}>
          <BorrowForm available={available} onSubmit={submit} />
        </Modal>
      )}
    </div>
  );
}

function BorrowForm({ available, onSubmit }) {
  const [itemId, setItemId] = useState(available[0]?.id || "");
  const [qty, setQty] = useState(1);
  const [where, setWhere] = useState("");
  const [purpose, setPurpose] = useState("");
  const [due, setDue] = useState("2026-09-22");
  const chosen = available.find((i) => i.id === itemId);
  const max = chosen ? chosen.normal - chosen.borrowed : 1;
  return (
    <div>
      <Field label="อุปกรณ์">
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={inputStyle}>
          {available.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name} (พร้อมใช้ {i.normal - i.borrowed})</option>)}
        </select>
      </Field>
      <Field label={`จำนวน (สูงสุด ${max})`}>
        <input type="number" min={1} max={max} value={qty} onChange={(e) => setQty(Math.min(max, Number(e.target.value)))} style={inputStyle} />
      </Field>
      <Field label="ใช้ที่ไหน"><input value={where} onChange={(e) => setWhere(e.target.value)} style={inputStyle} /></Field>
      <Field label="ใช้ทำอะไร"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} style={inputStyle} /></Field>
      <Field label="กำหนดคืน"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={inputStyle} /></Field>
      <div className="flex justify-end mt-2">
        <Btn onClick={() => onSubmit({ itemId, qty, where, purpose, due })} disabled={!chosen || !where}>ยืนยันการยืม</Btn>
      </div>
    </div>
  );
}

/* ============================================================
   DAMAGE & MAINTENANCE
   ============================================================ */
const SEVERITY = ["น้อย", "ปานกลาง", "สูง"];
const MAINT_ACTIONS = ["Repair", "Waiting Part", "Replace", "Write-off"];

function DamageMaint({ user, items, setItems, damages, setDamages, logAction }) {
  const [showNew, setShowNew] = useState(false);
  const manage = canEdit(user.role) || canManage(user.role);

  const submit = ({ itemId, qty, symptom }) => {
    const item = items.find((i) => i.id === itemId);
    const rec = { id: `DM-${Date.now()}`, date: "2026-09-15", itemId, itemCode: item.code, itemName: item.name, qty, symptom, reporter: user.name, severity: "ปานกลาง", status: "รอตรวจสอบ", action: "", cost: 0 };
    setDamages((p) => [rec, ...p]);
    logAction(`แจ้งชำรุด ${item.code} จำนวน ${qty}`);
    postToSheets("damage", { date: rec.date, itemCode: item.code, itemName: item.name, qty, symptom, reporter: user.name });
    setShowNew(false);
  };

  const advance = (d, patch) => {
    setDamages((p) => p.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
    logAction(`อัปเดตสถานะซ่อม ${d.itemCode} → ${patch.status || d.status}`);
    if (d._row) postToSheets("updateDamageStatus", { row: d._row, status: patch.status });
  };

  return (
    <div>
      <SectionHead eyebrow="DAMAGE & MAINTENANCE" title="แจ้งชำรุด–ซ่อมบำรุง" sub="Report → Review → Severity → Maintenance → Resolved"
        right={<Btn onClick={() => setShowNew(true)} icon={Plus}>แจ้งของชำรุด</Btn>} />

      {damages.length === 0 ? (
        <div className="p-8 text-center text-sm" style={{ color: C.mute, border: `1px dashed ${C.line}`, background: C.white }}>
          ยังไม่มีรายการแจ้งชำรุดใหม่ในรอบนี้ — ใช้ปุ่ม "แจ้งของชำรุด" เพื่อเริ่มบันทึก
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.line}`, background: C.white }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: C.navy, color: C.white }}>
                {["วันที่แจ้ง", "อุปกรณ์", "จำนวน", "อาการ", "ผู้แจ้ง", "ความรุนแรง", "สถานะ", ""].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {damages.map((d) => (
                <tr key={d.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td className="px-3 py-2 text-xs">{d.date}</td>
                  <td className="px-3 py-2 text-xs">{d.itemName} <span style={{ color: C.mute }}>({d.itemCode})</span></td>
                  <td className="px-3 py-2 text-xs">{d.qty}</td>
                  <td className="px-3 py-2 text-xs">{d.symptom}</td>
                  <td className="px-3 py-2 text-xs">{d.reporter}</td>
                  <td className="px-3 py-2">
                    {manage ? (
                      <select value={d.severity} onChange={(e) => advance(d, { severity: e.target.value })} style={{ ...inputStyle, padding: "3px 6px", fontSize: 12, width: 110 }}>
                        {SEVERITY.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    ) : <span className="text-xs">{d.severity}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {manage ? (
                      <select value={d.status} onChange={(e) => advance(d, { status: e.target.value })} style={{ ...inputStyle, padding: "3px 6px", fontSize: 12, width: 130 }}>
                        {["รอตรวจสอบ", ...MAINT_ACTIONS, "Resolved"].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    ) : <Pill fg={C.warn} bg={C.warnBg}>{d.status}</Pill>}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: C.mute }}>{d.status === "Resolved" ? "✓ ปิดงาน" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <Modal title="แจ้งของชำรุด" onClose={() => setShowNew(false)}>
          <DamageForm items={items} onSubmit={submit} />
        </Modal>
      )}
    </div>
  );
}

function DamageForm({ items, onSubmit }) {
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [qty, setQty] = useState(1);
  const [symptom, setSymptom] = useState("");
  return (
    <div>
      <Field label="อุปกรณ์">
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={inputStyle}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
        </select>
      </Field>
      <Field label="จำนวนที่ชำรุด"><input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={inputStyle} /></Field>
      <Field label="อาการ / รายละเอียด"><textarea rows={3} value={symptom} onChange={(e) => setSymptom(e.target.value)} style={inputStyle} /></Field>
      <div className="flex justify-end mt-2">
        <Btn variant="crimson" onClick={() => onSubmit({ itemId, qty, symptom })} disabled={!symptom}>ส่งรายงานชำรุด</Btn>
      </div>
    </div>
  );
}

/* ============================================================
   ANALYTICS
   ============================================================ */
function Analytics({ items }) {
  const health = useMemo(() => {
    const ok = items.reduce((s, i) => s + i.normal, 0);
    const dmg = items.reduce((s, i) => s + i.damaged, 0);
    const lost = items.reduce((s, i) => s + i.lost, 0);
    return [
      { name: "ใช้งานได้", value: ok, fill: C.ok },
      { name: "ชำรุด", value: dmg, fill: C.crimson },
      { name: "สูญหาย", value: lost, fill: C.warn },
    ];
  }, [items]);

  const byCat = useMemo(() => {
    const m = {};
    items.forEach((i) => {
      m[i.catCode] = m[i.catCode] || { cat: catName(i.catCode), ok: 0, damaged: 0, total: 0 };
      m[i.catCode].ok += i.normal; m[i.catCode].damaged += i.damaged; m[i.catCode].total += i.normal + i.damaged;
    });
    return Object.values(m).map((c) => ({ ...c, rate: c.total ? Math.round((c.damaged / c.total) * 100) : 0 })).sort((a, b) => b.rate - a.rate);
  }, [items]);

  const riskItems = items.filter((i) => i.damaged > 0 && i.damaged >= i.normal).slice(0, 8);

  return (
    <div>
      <SectionHead eyebrow="ANALYTICS" title="วิเคราะห์ทรัพยากร" sub="Resource Health · Damage Rate · High-risk Resources" />
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <h3 className="text-sm font-bold mb-2" style={{ color: C.navy }}>สุขภาพทรัพยากรรวม</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={health} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                {health.map((h, i) => <Cell key={i} fill={h.fill} />)}
              </Pie>
              <Tooltip contentStyle={{ fontFamily: FONT, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: FONT }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="col-span-2 p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <h3 className="text-sm font-bold mb-2" style={{ color: C.navy }}>อัตราชำรุดแยกตามหมวด (%)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byCat} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
              <YAxis type="category" dataKey="cat" width={110} tick={{ fontSize: 11, fontFamily: FONT }} />
              <Tooltip contentStyle={{ fontFamily: FONT, fontSize: 12 }} />
              <Bar dataKey="rate" name="อัตราชำรุด %" fill={C.crimson} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: C.navy }}>รายการความเสี่ยงสูง (ชำรุด ≥ พร้อมใช้)</h3>
        <div className="grid grid-cols-2 gap-3">
          {riskItems.length === 0 && <div className="text-sm" style={{ color: C.mute }}>ไม่มีรายการความเสี่ยงสูงในขณะนี้</div>}
          {riskItems.map((it) => (
            <div key={it.id} className="flex items-center justify-between px-3 py-2" style={{ background: C.badBg }}>
              <div>
                <div className="text-sm font-medium" style={{ color: C.ink }}>{it.name}</div>
                <div className="text-xs" style={{ color: C.mute }}>{it.code} · {catName(it.catCode)}</div>
              </div>
              <Pill fg={C.crimson} bg={C.white}>ชำรุด {it.damaged}/{it.normal + it.damaged}</Pill>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   REPORTS
   ============================================================ */
const REPORT_TYPES = [
  "Inventory Report", "Facility Report", "Borrowing Report", "Return Report",
  "Damage Report", "Maintenance Report", "Utilization Report", "Monthly Management Report",
];

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")].concat(rows.map((r) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(",")));
  return lines.join("\n");
}

function Reports({ items, borrows, damages }) {
  const [type, setType] = useState(REPORT_TYPES[0]);

  const exportCsv = () => {
    let rows = [];
    if (type === "Inventory Report") rows = items.map((i) => ({ รหัส: i.code, รายการ: i.name, หมวด: catName(i.catCode), สถานที่: i.loc, ปกติ: i.normal, ชำรุด: i.damaged }));
    else if (type === "Borrowing Report" || type === "Return Report") rows = borrows.map((b) => ({ วันที่: b.date, ผู้ยืม: b.borrower, อุปกรณ์: b.itemName, จำนวน: b.qty, สถานะ: b.status }));
    else if (type === "Damage Report" || type === "Maintenance Report") rows = damages.map((d) => ({ วันที่: d.date, อุปกรณ์: d.itemName, จำนวน: d.qty, สถานะ: d.status }));
    else rows = items.map((i) => ({ รหัส: i.code, รายการ: i.name, หมวด: catName(i.catCode) }));
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${type.replace(/\s/g, "_")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <SectionHead eyebrow="REPORTS" title="รายงาน" sub="เลือกประเภทรายงานและส่งออกเป็นไฟล์ CSV" />
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-1 space-y-1">
          {REPORT_TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)} className="w-full text-left px-3 py-2 text-sm"
              style={{ background: type === t ? C.navy : C.white, color: type === t ? C.white : C.ink, border: `1px solid ${C.line}` }}>
              {t}
            </button>
          ))}
        </div>
        <div className="col-span-3 p-5" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <h3 className="font-bold text-base mb-1" style={{ color: C.navy }}>{type}</h3>
          <p className="text-sm mb-4" style={{ color: C.slate }}>ข้อมูลคำนวณจากทะเบียนครุภัณฑ์และรายการยืม–คืนล่าสุดแบบเรียลไทม์</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatCard label="รายการในรายงาน" value={items.length} tone="navy" />
            <StatCard label="รอบข้อมูล" value="ปีการศึกษา 2568" tone="gold" />
            <StatCard label="อัปเดตล่าสุด" value="15 ก.ย. 2569" tone="ok" />
          </div>
          <Btn onClick={exportCsv} icon={Download}>ส่งออก CSV</Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MANAGEMENT ACTIONS (L3 only)
   ============================================================ */
function ManagementActions({ user, items, setItems, actionsLog, logAction }) {
  const recommended = useMemo(() => {
    return items
      .filter((i) => i.damaged > 0)
      .map((i) => {
        const rate = i.damaged / (i.normal + i.damaged || 1);
        let rec = "Monitor";
        if (rate >= 0.7) rec = "Replace";
        else if (rate >= 0.4) rec = "Procure";
        else rec = "Repair";
        return { ...i, rate, rec };
      })
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10);
  }, [items]);

  const takeAction = (it, action) => {
    logAction(`สั่งการ: ${action} — ${it.code} (${it.name})`);
    if (action === "Repair") {
      const newNormal = it.normal + it.damaged;
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, normal: newNormal, damaged: 0 } : x)));
      postToSheets("updateItem", { code: it.code, normal: newNormal, damaged: 0 });
    }
  };

  return (
    <div>
      <SectionHead eyebrow="MANAGEMENT ACTION" title="สั่งการบริหารทรัพยากร" sub="DATA → INSIGHT → DECISION → ACTION" />

      <div className="p-4 mb-5" style={{ background: C.white, border: `1px solid ${C.line}` }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: C.navy }}>รายการที่ระบบแนะนำให้ดำเนินการ</h3>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: C.slate }}>
              {["อุปกรณ์", "หมวด", "อัตราชำรุด", "คำแนะนำระบบ", "การดำเนินการ"].map((h) => <th key={h} className="text-left px-2 py-2 text-xs font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {recommended.map((it) => (
              <tr key={it.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <td className="px-2 py-2">{it.name} <span className="text-xs" style={{ color: C.mute }}>({it.code})</span></td>
                <td className="px-2 py-2 text-xs">{catName(it.catCode)}</td>
                <td className="px-2 py-2"><Pill fg={it.rate >= 0.7 ? C.bad : it.rate >= 0.4 ? C.warn : C.ok} bg={it.rate >= 0.7 ? C.badBg : it.rate >= 0.4 ? C.warnBg : C.okBg}>{Math.round(it.rate * 100)}%</Pill></td>
                <td className="px-2 py-2 text-xs font-semibold" style={{ color: C.navy }}>{it.rec}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1.5">
                    {["Repair", "Replace", "Procure"].map((a) => (
                      <Btn key={a} small variant={a === it.rec ? "crimson" : "ghost"} onClick={() => takeAction(it, a)}>{a}</Btn>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: C.navy }}><ShieldCheck size={15} /> Audit Log ล่าสุด</h3>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {actionsLog.length === 0 && <div className="text-sm" style={{ color: C.mute }}>ยังไม่มีการดำเนินการที่บันทึกไว้</div>}
          {actionsLog.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs py-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
              <span style={{ color: C.ink }}>{a.text}</span>
              <span style={{ color: C.mute }}>{a.user} · {new Date(a.ts).toLocaleTimeString("th-TH")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
