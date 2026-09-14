/**
 * reservation.service.ts
 * ---------------------------------------------------------------------------
 * หัวใจของระบบ: เชื่อม "ตารางสอน" เข้ากับ "สต็อกครุภัณฑ์"
 *
 * ลำดับการทำงาน
 *   1) generateSessions()        แตกกติกาเกิดซ้ำ -> คาบจริงรายวัน (ยังไม่แตะ DB)
 *   2) previewReservations()     dry-run ตรวจว่าอุปกรณ์พอทุกคาบไหม (อ่านอย่างเดียว)
 *   3) commitCourseReservations() สร้างคาบ + ล็อกอุปกรณ์ ใน transaction เดียว
 *   4) issueAssetsForSession()   จ่ายของจริงหน้าสโตร์ RESERVED -> ISSUED
 *   5) closeSession()            ปิดคาบ + รับคืน + บันทึกชำรุด
 *
 * หลักการสำคัญ
 *   - ขั้นที่ 2 ไม่ล็อกอะไรเลย เพื่อให้ UI ตอบเร็วและไม่ค้างสต็อกของคนอื่น
 *   - ขั้นที่ 3 เช็กซ้ำอีกครั้ง "ภายใน advisory lock" ป้องกัน race condition
 *   - ทุกการเปลี่ยนแปลงสต็อกต้องเขียนลง stock_transactions เท่านั้น
 *     (trigger ในฐานข้อมูลจะปรับ stock_balances ให้เอง)
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

const TZ = 'Asia/Bangkok';
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannedSession {
  sessionDate: string; // YYYY-MM-DD
  startAt: Date;
  endAt: Date;
  locationId: number;
  instructorId: number;
}

export interface AssetRequirement {
  itemId: number;
  itemName: string;
  variantId: number | null;
  qtyRequired: number;
  isMandatory: boolean;
}

export interface ReservationConflict {
  sessionDate: string;
  startAt: Date;
  itemId: number;
  itemName: string;
  required: number;
  available: number;
  shortage: number;
  isMandatory: boolean;
}

export interface PreviewResult {
  totalSessions: number;
  totalReservations: number;
  feasible: boolean;            // false เมื่อมีอุปกรณ์ "บังคับ" ไม่พอ
  conflicts: ReservationConflict[];
  sessions: PlannedSession[];
}

export class InsufficientStockError extends Error {
  constructor(public conflict: ReservationConflict) {
    super(
      `อุปกรณ์ไม่พอ: ${conflict.itemName} วันที่ ${conflict.sessionDate} ` +
      `ต้องใช้ ${conflict.required} แต่ว่างเพียง ${conflict.available}`,
    );
    this.name = 'InsufficientStockError';
  }
}

// ---------------------------------------------------------------------------
// 1) แตกกติกาเกิดซ้ำ -> คาบจริงรายวัน
// ---------------------------------------------------------------------------

/**
 * class_schedules เก็บแค่ "ทุกวันจันทร์ 08:30-09:20 ตั้งแต่ 1 มิ.ย. ถึง 30 ก.ย."
 * ฟังก์ชันนี้แตกออกเป็นคาบจริงทีละวัน เพราะรายงานชั่วโมงสอนและ utilization
 * ต้องคิดจากคาบจริงเท่านั้น (คาบที่ถูกยกเลิกจะไม่ถูกนับ)
 *
 * ข้ามวันหยุดที่ระบุใน location_blackouts และวันหยุดราชการ
 */
export async function generateSessions(
  schedule: {
    scheduleId: number;
    courseId: number;
    instructorId: number;
    locationId: number;
    dayOfWeek: number;      // 0 = อาทิตย์
    startTime: string;      // 'HH:mm'
    endTime: string;
    effectiveFrom: Date;
    effectiveTo: Date;
  },
  holidays: Set<string> = new Set(),
): Promise<PlannedSession[]> {
  const sessions: PlannedSession[] = [];

  // ดึงช่วงปิดปรับปรุงของสถานที่มาข้ามด้วย
  const blackouts = await prisma.$queryRaw<{ start_at: Date; end_at: Date }[]>`
    SELECT start_at, end_at
      FROM location_blackouts
     WHERE location_id = ${schedule.locationId}
       AND end_at   >= ${schedule.effectiveFrom}
       AND start_at <= ${schedule.effectiveTo}
  `;

  let cursor = startOfDay(schedule.effectiveFrom);
  const last = startOfDay(schedule.effectiveTo);

  while (cursor <= last) {
    if (cursor.getDay() === schedule.dayOfWeek) {
      const dateStr = cursor.toISOString().slice(0, 10);

      if (!holidays.has(dateStr)) {
        // ประกอบเวลาแบบ local (Asia/Bangkok) แล้วแปลงเป็น UTC ก่อนเก็บ
        const startAt = fromZonedTime(`${dateStr}T${schedule.startTime}:00`, TZ);
        const endAt   = fromZonedTime(`${dateStr}T${schedule.endTime}:00`, TZ);

        const isBlackedOut = blackouts.some(
          (b) => b.start_at < endAt && b.end_at > startAt,
        );

        if (!isBlackedOut) {
          sessions.push({
            sessionDate: dateStr,
            startAt,
            endAt,
            locationId: schedule.locationId,
            instructorId: schedule.instructorId,
          });
        }
      }
    }
    cursor = addDays(cursor, 1);
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// 2) Dry-run: ตรวจว่าอุปกรณ์พอทุกคาบไหม (ไม่ล็อกอะไรทั้งสิ้น)
// ---------------------------------------------------------------------------

export async function previewReservations(courseId: number): Promise<PreviewResult> {
  const schedules = await prisma.$queryRaw<any[]>`
    SELECT schedule_id, course_id, instructor_id, location_id,
           day_of_week, start_time::TEXT AS start_time, end_time::TEXT AS end_time,
           effective_from, effective_to
      FROM class_schedules
     WHERE course_id = ${courseId} AND is_active = TRUE
  `;

  const requirements = await prisma.$queryRaw<AssetRequirement[]>`
    SELECT r.item_id      AS "itemId",
           i.item_name    AS "itemName",
           r.variant_id   AS "variantId",
           r.qty_required AS "qtyRequired",
           r.is_mandatory AS "isMandatory"
      FROM course_asset_requirements r
      JOIN items i ON i.item_id = r.item_id
     WHERE r.course_id = ${courseId}
  `;

  const allSessions: PlannedSession[] = [];
  for (const s of schedules) {
    allSessions.push(
      ...(await generateSessions({
        scheduleId: s.schedule_id,
        courseId: s.course_id,
        instructorId: s.instructor_id,
        locationId: s.location_id,
        dayOfWeek: s.day_of_week,
        startTime: String(s.start_time).slice(0, 5),
        endTime: String(s.end_time).slice(0, 5),
        effectiveFrom: s.effective_from,
        effectiveTo: s.effective_to,
      })),
    );
  }

  const conflicts: ReservationConflict[] = [];

  for (const session of allSessions) {
    for (const req of requirements) {
      // เรียก function ในฐานข้อมูล -> ยอดพร้อมใช้ ลบ reservation ที่ทับช่วงเวลา
      const [row] = await prisma.$queryRaw<{ available: number }[]>`
        SELECT fn_available_qty(
                 ${req.itemId}::INT,
                 ${req.variantId}::INT,
                 ${session.locationId}::INT,
                 ${session.startAt}::TIMESTAMPTZ,
                 ${session.endAt}::TIMESTAMPTZ
               ) AS available
      `;

      if (row.available < req.qtyRequired) {
        conflicts.push({
          sessionDate: session.sessionDate,
          startAt: session.startAt,
          itemId: req.itemId,
          itemName: req.itemName,
          required: req.qtyRequired,
          available: row.available,
          shortage: req.qtyRequired - row.available,
          isMandatory: req.isMandatory,
        });
      }
    }
  }

  return {
    totalSessions: allSessions.length,
    totalReservations: allSessions.length * requirements.length,
    // อุปกรณ์ที่ไม่บังคับขาดได้ ไม่บล็อกการเปิดคอร์ส
    feasible: !conflicts.some((c) => c.isMandatory),
    conflicts,
    sessions: allSessions,
  };
}

// ---------------------------------------------------------------------------
// 3) Commit: สร้างคาบ + ล็อกอุปกรณ์ ใน transaction เดียว  ★
// ---------------------------------------------------------------------------

/**
 * เรียกตอนเจ้าหน้าที่กด "อนุมัติคอร์ส"
 *
 * ทุกอย่างอยู่ใน transaction เดียว ถ้าคาบใดคาบหนึ่งจองอุปกรณ์ไม่สำเร็จ
 * ระบบจะ rollback ทั้งหมด -> ไม่มีสถานะครึ่ง ๆ กลาง ๆ ที่คอร์สถูกสร้างแล้ว
 * แต่อุปกรณ์กันไว้ไม่ครบ
 *
 * การกันแข่ง (race condition) อยู่ที่ fn_reserve_asset ซึ่งใช้
 * pg_advisory_xact_lock ต่อคู่ item+location แล้วเช็กยอดซ้ำภายใน lock
 */
export async function commitCourseReservations(
  courseId: number,
  approvedByUserId: number,
): Promise<{ sessionsCreated: number; reservationsCreated: number }> {
  const preview = await previewReservations(courseId);

  if (!preview.feasible) {
    throw new InsufficientStockError(
      preview.conflicts.find((c) => c.isMandatory)!,
    );
  }

  const requirements = await prisma.$queryRaw<AssetRequirement[]>`
    SELECT r.item_id AS "itemId", i.item_name AS "itemName",
           r.variant_id AS "variantId", r.qty_required AS "qtyRequired",
           r.is_mandatory AS "isMandatory"
      FROM course_asset_requirements r
      JOIN items i ON i.item_id = r.item_id
     WHERE r.course_id = ${courseId} AND r.is_mandatory = TRUE
  `;

  return prisma.$transaction(
    async (tx) => {
      let sessionsCreated = 0;
      let reservationsCreated = 0;

      for (const s of preview.sessions) {
        // EXCLUDE constraint ในตารางจะโยน error เองถ้าสถานที่หรือครูชนเวลา
        const [session] = await tx.$queryRaw<{ session_id: bigint }[]>`
          INSERT INTO class_sessions
            (course_id, instructor_id, location_id, session_date, start_at, end_at, status)
          VALUES
            (${courseId}, ${s.instructorId}, ${s.locationId},
             ${s.sessionDate}::DATE, ${s.startAt}::TIMESTAMPTZ, ${s.endAt}::TIMESTAMPTZ,
             'SCHEDULED')
          RETURNING session_id
        `;
        sessionsCreated++;

        for (const req of requirements) {
          // fn_reserve_asset จะ RAISE EXCEPTION ถ้าของไม่พอ -> rollback ทั้ง transaction
          await tx.$queryRaw`
            SELECT fn_reserve_asset(
              'CLASS_SESSION'::reservation_source,
              ${session.session_id}::BIGINT,
              NULL::BIGINT,
              ${req.itemId}::INT,
              ${req.variantId}::INT,
              ${s.locationId}::INT,
              ${req.qtyRequired}::INT,
              ${s.startAt}::TIMESTAMPTZ,
              ${s.endAt}::TIMESTAMPTZ,
              ${approvedByUserId}::INT
            )
          `;
          reservationsCreated++;
        }
      }

      await tx.$executeRaw`
        UPDATE courses
           SET status = 'ACTIVE', approved_by = ${approvedByUserId}, approved_at = now()
         WHERE course_id = ${courseId}
      `;

      return { sessionsCreated, reservationsCreated };
    },
    {
      // คอร์สทั้งเทอมอาจมี 18 คาบ x 3 อุปกรณ์ = 54 reservation
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

// ---------------------------------------------------------------------------
// 4) จ่ายของจริงหน้าสโตร์  RESERVED -> ISSUED
// ---------------------------------------------------------------------------

export async function issueAssetsForSession(
  sessionId: bigint,
  issuedByUserId: number,
) {
  return prisma.$transaction(async (tx) => {
    const reservations = await tx.$queryRaw<any[]>`
      SELECT reservation_id, item_id, variant_id, location_id, qty
        FROM asset_reservations
       WHERE session_id = ${sessionId} AND status = 'RESERVED'
       FOR UPDATE
    `;

    if (reservations.length === 0) {
      throw new Error('ไม่พบรายการที่สำรองไว้สำหรับคาบนี้');
    }

    for (const r of reservations) {
      await tx.$executeRaw`
        UPDATE asset_reservations SET status = 'ISSUED' WHERE reservation_id = ${r.reservation_id}
      `;

      // ตัดสต็อกผ่าน ledger เท่านั้น -> trigger ปรับ stock_balances ให้เอง
      await tx.$executeRaw`
        INSERT INTO stock_transactions
          (trx_type, item_id, variant_id, qty, location_from_id,
           ref_type, ref_id, performed_by, note)
        VALUES
          ('BORROW', ${r.item_id}, ${r.variant_id}, ${r.qty}, ${r.location_id},
           'RESERVATION', ${r.reservation_id}, ${issuedByUserId}, 'จ่ายของสำหรับคาบเรียน')
      `;
    }

    await tx.$executeRaw`
      UPDATE class_sessions
         SET status = 'IN_PROGRESS', actual_start_at = now()
       WHERE session_id = ${sessionId}
    `;

    return { issued: reservations.length };
  });
}

// ---------------------------------------------------------------------------
// 5) ปิดคาบ: รับคืน + บันทึกชำรุด
// ---------------------------------------------------------------------------

export interface DamageReport {
  itemId: number;
  variantId: number | null;
  qtyDamaged: number;
  qtyLost: number;
  problem: string;
  photoUrls?: string[];
}

/**
 * ครูหรือเจ้าหน้าที่กด "ปิดคาบ" หลังเลิกเรียน
 *
 * ของที่ชำรุดจะถูกตัดออกจากยอด "พร้อมใช้งาน" ไปเป็น "ชำรุด/รอซ่อม" ทันที
 * ทำให้คาบเรียนถัดไปที่จะจองอุปกรณ์ชุดเดียวกัน เห็นยอดที่ลดลงแล้วจริง ๆ
 */
export async function closeSession(
  sessionId: bigint,
  performedByUserId: number,
  attendeeCount: number | null,
  damages: DamageReport[] = [],
) {
  return prisma.$transaction(async (tx) => {
    const reservations = await tx.$queryRaw<any[]>`
      SELECT reservation_id, item_id, variant_id, location_id, qty
        FROM asset_reservations
       WHERE session_id = ${sessionId} AND status = 'ISSUED'
       FOR UPDATE
    `;

    const damageMap = new Map<string, DamageReport>();
    for (const d of damages) {
      damageMap.set(`${d.itemId}:${d.variantId ?? 0}`, d);
    }

    for (const r of reservations) {
      const dmg = damageMap.get(`${r.item_id}:${r.variant_id ?? 0}`);
      const broken = dmg ? dmg.qtyDamaged : 0;
      const lost   = dmg ? dmg.qtyLost : 0;
      const good   = r.qty - broken - lost;

      if (good < 0) {
        throw new Error(
          `จำนวนที่แจ้งชำรุด/สูญหาย (${broken + lost}) มากกว่าจำนวนที่ยืมไป (${r.qty})`,
        );
      }

      // 5.1 คืนของที่สภาพดี
      if (good > 0) {
        await tx.$executeRaw`
          INSERT INTO stock_transactions
            (trx_type, item_id, variant_id, qty, location_to_id,
             ref_type, ref_id, performed_by, note)
          VALUES
            ('RETURN', ${r.item_id}, ${r.variant_id}, ${good}, ${r.location_id},
             'RESERVATION', ${r.reservation_id}, ${performedByUserId}, 'คืนหลังจบคาบเรียน')
        `;
      }

      // 5.2 ของชำรุด: คืนเข้าระบบก่อน แล้วย้ายไปสถานะชำรุด
      if (broken > 0) {
        await tx.$executeRaw`
          INSERT INTO stock_transactions
            (trx_type, item_id, variant_id, qty, location_to_id, ref_type, ref_id, performed_by, note)
          VALUES
            ('RETURN', ${r.item_id}, ${r.variant_id}, ${broken}, ${r.location_id},
             'RESERVATION', ${r.reservation_id}, ${performedByUserId}, 'คืนสภาพชำรุด')
        `;
        await tx.$executeRaw`
          INSERT INTO stock_transactions
            (trx_type, item_id, variant_id, qty, location_from_id, ref_type, ref_id, performed_by, note)
          VALUES
            ('REPAIR_OUT', ${r.item_id}, ${r.variant_id}, ${broken}, ${r.location_id},
             'SESSION', ${sessionId}, ${performedByUserId}, ${dmg!.problem})
        `;
        await tx.$executeRaw`
          INSERT INTO maintenance_records
            (item_id, variant_id, qty, location_id, reported_by,
             source_session_id, problem_description, status, photo_urls)
          VALUES
            (${r.item_id}, ${r.variant_id}, ${broken}, ${r.location_id}, ${performedByUserId},
             ${sessionId}, ${dmg!.problem}, 'REPORTED',
             ${JSON.stringify(dmg!.photoUrls ?? [])}::JSONB)
        `;
      }

      // 5.3 ของสูญหาย: ตัดออกจากยอดรวมเลย
      if (lost > 0) {
        await tx.$executeRaw`
          INSERT INTO stock_transactions
            (trx_type, item_id, variant_id, qty, location_from_id, ref_type, ref_id, performed_by, note)
          VALUES
            ('LOST', ${r.item_id}, ${r.variant_id}, ${lost}, ${r.location_id},
             'SESSION', ${sessionId}, ${performedByUserId}, 'สูญหายหลังคาบเรียน')
        `;
      }

      await tx.$executeRaw`
        UPDATE asset_reservations
           SET status = 'RETURNED', released_at = now()
         WHERE reservation_id = ${r.reservation_id}
      `;
    }

    await tx.$executeRaw`
      UPDATE class_sessions
         SET status = 'COMPLETED', actual_end_at = now(), attendee_count = ${attendeeCount}
       WHERE session_id = ${sessionId}
    `;

    // แจ้งเตือนเจ้าหน้าที่เมื่อมีของชำรุด
    if (damages.length > 0) {
      await tx.$executeRaw`
        INSERT INTO notifications (type, title, message, ref_type, ref_id, priority)
        VALUES ('DAMAGED_ITEM', 'พบครุภัณฑ์ชำรุดหลังคาบเรียน',
                ${`มีรายการชำรุด/สูญหาย ${damages.length} รายการ รอตรวจสอบ`},
                'SESSION', ${sessionId}, 'HIGH')
      `;
    }

    return { returned: reservations.length, damageReports: damages.length };
  });
}

// ---------------------------------------------------------------------------
// 6) Job: ปล่อย reservation ที่ค้าง (รันทุก 15 นาที)
// ---------------------------------------------------------------------------

/**
 * กันกรณีครูลืมปิดคาบ แล้วอุปกรณ์ถูกล็อกค้างไว้จนคนอื่นจองไม่ได้
 * - RESERVED ที่เลยเวลาจบคาบแล้วยังไม่มีการจ่ายของ -> EXPIRED (ปล่อยสต็อกคืน)
 * - ISSUED ที่เลยเวลาจบคาบเกิน 24 ชม. -> แจ้งเตือนเจ้าหน้าที่ แต่ยังไม่ปล่อย
 *   (เพราะของอยู่ในมือคนยืมจริง ต้องตามคืน ไม่ใช่ปล่อยยอดลอย ๆ)
 */
export async function releaseExpiredReservations() {
  const expired = await prisma.$executeRaw`
    UPDATE asset_reservations
       SET status = 'EXPIRED', released_at = now()
     WHERE status = 'RESERVED'
       AND end_at < now() - interval '2 hours'
  `;

  await prisma.$executeRaw`
    INSERT INTO notifications (type, title, message, ref_type, ref_id, target_location_id, priority)
    SELECT 'OVERDUE',
           'ครุภัณฑ์ยังไม่ถูกคืนหลังจบคาบ',
           'คาบเรียนจบไปแล้วเกิน 24 ชั่วโมง แต่ยังไม่มีการบันทึกคืน',
           'SESSION', r.session_id, r.location_id, 'HIGH'
      FROM asset_reservations r
     WHERE r.status = 'ISSUED'
       AND r.end_at < now() - interval '24 hours'
       AND NOT EXISTS (
             SELECT 1 FROM notifications n
              WHERE n.ref_type = 'SESSION' AND n.ref_id = r.session_id
                AND n.type = 'OVERDUE'
           )
  `;

  return { expiredCount: expired };
}
