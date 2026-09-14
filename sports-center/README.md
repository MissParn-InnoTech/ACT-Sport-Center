# ระบบบริหารจัดการศูนย์กีฬารวม

ระบบจัดการตารางสอน ครุภัณฑ์ และรายงานผู้บริหาร ของศูนย์กีฬา โรงเรียนอัสสัมชัญธนบุรี

## โครงสร้างโฟลเดอร์

```
db/migrations/0001_init.sql   โครงสร้างฐานข้อมูล 39 ตาราง + views + functions
docs/                          เอกสารออกแบบระบบและเทมเพลตนำเข้าข้อมูล
src/modules/reservation/       โค้ดหลักการจอง/ล็อกครุภัณฑ์ตามคาบเรียน
docker-compose.yml             สภาพแวดล้อมสำหรับพัฒนา (PostgreSQL + Redis + Adminer)
```

## เริ่มใช้งาน

```bash
cp .env.example .env     # แล้วแก้รหัสผ่านในไฟล์ .env
docker compose up -d
docker compose logs db   # ตรวจว่า schema รันผ่าน
```

เปิด http://localhost:8080 เพื่อดูฐานข้อมูล
(System: PostgreSQL / Server: db / User & Password: ตามที่ตั้งใน .env / Database: sportscenter)

## ตรวจว่าใช้งานได้

```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';
-- ควรได้ประมาณ 39
SELECT role_code, role_name FROM roles;
```

## เอกสารประกอบ

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/architecture.md` | สถาปัตยกรรม, flowchart, tech stack, โครงสร้างโปรเจกต์ |
| `docs/data-analysis-and-schema-v2.md` | การวิเคราะห์ข้อมูลเดิม และแผนย้ายข้อมูล |
| `docs/sports-center-asset-system-design.md` | การออกแบบโมดูลครุภัณฑ์ (ฉบับแรก) |
| `docs/asset-import-template.xlsx` | เทมเพลตนำเข้าข้อมูลทะเบียนครุภัณฑ์ |

## ข้อควรระวัง

- ห้าม commit ไฟล์ `.env` หรือข้อมูลจริงของนักเรียน/ครู ขึ้น repository
- ถ้าแก้ไฟล์ใน `db/migrations/` แล้วอยากให้รันใหม่ ต้อง `docker compose down -v` ก่อน (คำสั่งนี้ลบข้อมูลในฐานข้อมูลทั้งหมด)
