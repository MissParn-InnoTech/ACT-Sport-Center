-- =====================================================================
--  ระบบบริหารจัดการศูนย์กีฬารวม (Sports Center Management System)
--  Assumption College Thonburi
--  Database: PostgreSQL 15+
--  Schema Version: 3.0  (Class Schedule + Asset + Executive Report)
--
--  หมายเหตุการออกแบบ:
--  1) class_schedules = "กติกาการเกิดซ้ำ" (ทุกวันจันทร์ 08:30-09:20)
--     class_sessions  = "คาบจริงรายวัน" ที่ระบบ generate ออกมา
--     -> รายงานชั่วโมงสอน / Utilization ต้องคิดจาก class_sessions เท่านั้น
--        เพราะคาบที่ถูกยกเลิก/เลื่อน จะไม่ถูกนับ
--  2) asset_reservations คือหัวใจของการเชื่อมตารางสอนกับครุภัณฑ์
--     จำนวนที่ยืมได้จริง = stock_balances.qty_available - SUM(reservation ที่ทับช่วงเวลา)
--  3) stock_balances เป็น cache ที่ trigger คำนวณจาก stock_transactions
--     ห้าม UPDATE ตรง ๆ ต้องบันทึกผ่าน stock_transactions เสมอ
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- สำหรับ EXCLUDE constraint กันจองชนกัน
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()


-- =====================================================================
-- SECTION 0 : ENUM TYPES
-- =====================================================================

CREATE TYPE user_status        AS ENUM ('ACTIVE','INACTIVE','SUSPENDED','PENDING_APPROVAL');
CREATE TYPE member_type        AS ENUM ('STUDENT','TEACHER','STAFF','EXTERNAL');
CREATE TYPE location_type      AS ENUM ('BUILDING','STORE','SHELF','COURT','FIELD','ROOM','OFFICE','POOL');
CREATE TYPE location_status    AS ENUM ('ACTIVE','MAINTENANCE','CLOSED');
CREATE TYPE item_type          AS ENUM ('DURABLE','CONSUMABLE');
CREATE TYPE unit_status        AS ENUM ('AVAILABLE','IN_USE','BORROWED','RESERVED',
                                        'DAMAGED_REPAIRABLE','DAMAGED_BEYOND_REPAIR','LOST','DISPOSED');
CREATE TYPE condition_grade    AS ENUM ('A','B','C','D');
CREATE TYPE trx_type           AS ENUM ('RECEIVE','ISSUE','BORROW','RETURN','TRANSFER',
                                        'ADJUST','REPAIR_OUT','REPAIR_IN','DISPOSE','LOST');
CREATE TYPE maintenance_status AS ENUM ('REPORTED','APPROVED','IN_REPAIR','COMPLETED','CANNOT_REPAIR','DISPOSED');
CREATE TYPE session_status     AS ENUM ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','POSTPONED');
CREATE TYPE course_status      AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','CLOSED','REJECTED');
CREATE TYPE reservation_source AS ENUM ('CLASS_SESSION','LOCATION_BOOKING','MANUAL');
CREATE TYPE reservation_status AS ENUM ('RESERVED','ISSUED','RETURNED','RELEASED','CANCELLED','EXPIRED');
CREATE TYPE borrow_status      AS ENUM ('DRAFT','PENDING','APPROVED','REJECTED','ISSUED',
                                        'PARTIAL_RETURNED','RETURNED','OVERDUE','CANCELLED');
CREATE TYPE return_condition   AS ENUM ('GOOD','MINOR_DAMAGE','MAJOR_DAMAGE','LOST');
CREATE TYPE booking_status     AS ENUM ('PENDING','APPROVED','REJECTED','IN_USE','COMPLETED','CANCELLED');
CREATE TYPE report_type        AS ENUM ('MONTHLY_EXECUTIVE','ASSET_UTILIZATION','LOCATION_UTILIZATION',
                                        'TEACHING_HOURS','ASSET_STATUS','INVENTORY_COUNT');
CREATE TYPE report_format      AS ENUM ('PDF','XLSX','CSV');
CREATE TYPE job_status         AS ENUM ('QUEUED','RUNNING','SUCCESS','FAILED');


-- =====================================================================
-- SECTION 1 : ผู้ใช้งานและสิทธิ์  (Users / RBAC)
-- =====================================================================

CREATE TABLE roles (
    role_id      SERIAL PRIMARY KEY,
    role_code    VARCHAR(20)  NOT NULL UNIQUE,   -- PUBLIC | STUDENT | INSTRUCTOR | STAFF | ADMIN | EXECUTIVE
    role_name    VARCHAR(100) NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    permission_id    SERIAL PRIMARY KEY,
    permission_code  VARCHAR(60) NOT NULL UNIQUE, -- 'asset.create', 'borrow.approve', 'report.executive.view'
    module           VARCHAR(30) NOT NULL,
    description      VARCHAR(255)
);

CREATE TABLE role_permissions (
    role_id        INT NOT NULL REFERENCES roles(role_id)             ON DELETE CASCADE,
    permission_id  INT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE organization_units (
    unit_id        SERIAL PRIMARY KEY,
    unit_code      VARCHAR(30)  NOT NULL UNIQUE,
    unit_name      VARCHAR(150) NOT NULL,
    parent_unit_id INT REFERENCES organization_units(unit_id),
    head_user_id   INT,                      -- FK เพิ่มทีหลัง (circular กับ users)
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
    user_id         SERIAL PRIMARY KEY,
    uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    username        VARCHAR(60)  NOT NULL UNIQUE,
    password_hash   VARCHAR(255),             -- NULL ได้ กรณี login ผ่าน Google Workspace ของโรงเรียน
    role_id         INT NOT NULL REFERENCES roles(role_id),
    unit_id         INT REFERENCES organization_units(unit_id),
    member_code     VARCHAR(30) UNIQUE,       -- รหัสนักเรียน / รหัสบุคลากร
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(150) UNIQUE,
    phone           VARCHAR(30),
    member_type     member_type  NOT NULL DEFAULT 'STUDENT',
    borrow_limit    INT          NOT NULL DEFAULT 5,
    is_blacklisted  BOOLEAN      NOT NULL DEFAULT FALSE,
    status          user_status  NOT NULL DEFAULT 'PENDING_APPROVAL',
    avatar_url      VARCHAR(255),
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE organization_units
    ADD CONSTRAINT fk_unit_head FOREIGN KEY (head_user_id) REFERENCES users(user_id);

-- เจ้าหน้าที่ล็อกอิน "แยกตามสถานที่" : ผูกสิทธิ์ดูแลเฉพาะ location ที่รับผิดชอบ
CREATE TABLE user_locations (
    user_id      INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    location_id  INT NOT NULL,                -- FK เพิ่มหลังสร้าง locations
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve  BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, location_id)
);

CREATE TABLE login_logs (
    log_id      BIGSERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(user_id),
    username_try VARCHAR(60),
    action      VARCHAR(20) NOT NULL,         -- LOGIN_SUCCESS | LOGIN_FAIL | LOGOUT
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    audit_id    BIGSERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(user_id),
    table_name  VARCHAR(60) NOT NULL,
    record_id   VARCHAR(60) NOT NULL,
    action      VARCHAR(10) NOT NULL,         -- CREATE | UPDATE | DELETE
    old_value   JSONB,
    new_value   JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_created      ON audit_logs(created_at DESC);


-- =====================================================================
-- SECTION 2 : สถานที่  (Locations)
-- =====================================================================

CREATE TABLE buildings (
    building_id   SERIAL PRIMARY KEY,
    building_code VARCHAR(20)  NOT NULL UNIQUE,
    building_name VARCHAR(150) NOT NULL,
    address       VARCHAR(255),
    map_url       VARCHAR(255),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE sport_categories (
    category_id        SERIAL PRIMARY KEY,
    category_code      VARCHAR(10)  NOT NULL UNIQUE,
    category_name      VARCHAR(100) NOT NULL,
    parent_category_id INT REFERENCES sport_categories(category_id),
    icon               VARCHAR(50),
    color              VARCHAR(10),
    sort_order         INT NOT NULL DEFAULT 0,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE locations (
    location_id          SERIAL PRIMARY KEY,
    building_id          INT REFERENCES buildings(building_id),
    parent_location_id   INT REFERENCES locations(location_id),
    location_code        VARCHAR(30)  NOT NULL UNIQUE,
    location_name        VARCHAR(150) NOT NULL,
    location_type        location_type NOT NULL,
    category_id          INT REFERENCES sport_categories(category_id),
    is_storage           BOOLEAN NOT NULL DEFAULT FALSE,  -- ใช้เป็นที่จัดเก็บครุภัณฑ์ได้
    is_bookable          BOOLEAN NOT NULL DEFAULT FALSE,  -- เปิดให้จองใช้งาน
    is_public_visible    BOOLEAN NOT NULL DEFAULT TRUE,   -- แสดงในหน้าสาธารณะ (ไม่ต้องล็อกอิน)
    capacity             INT,
    default_store_id     INT REFERENCES locations(location_id), -- สโตร์ที่จ่ายของให้สถานที่นี้
    responsible_user_id  INT REFERENCES users(user_id),
    status               location_status NOT NULL DEFAULT 'ACTIVE',
    note                 TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_locations
    ADD CONSTRAINT fk_userloc_location FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE;

-- เวลาทำการรายวัน (0=อาทิตย์ ... 6=เสาร์)
CREATE TABLE location_operating_hours (
    id           SERIAL PRIMARY KEY,
    location_id  INT NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time    TIME NOT NULL,
    close_time   TIME NOT NULL,
    CHECK (close_time > open_time),
    UNIQUE (location_id, day_of_week)
);

-- ปิดปรับปรุงชั่วคราว -> บล็อกทั้งการจองและการสอน
CREATE TABLE location_blackouts (
    blackout_id  SERIAL PRIMARY KEY,
    location_id  INT NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    start_at     TIMESTAMPTZ NOT NULL,
    end_at       TIMESTAMPTZ NOT NULL,
    reason       VARCHAR(255),
    created_by   INT REFERENCES users(user_id),
    CHECK (end_at > start_at)
);


-- =====================================================================
-- SECTION 3 : ครุภัณฑ์และสต็อก  (Assets & Inventory)
-- =====================================================================

CREATE TABLE items (
    item_id              SERIAL PRIMARY KEY,
    item_code            VARCHAR(30)  NOT NULL UNIQUE,
    item_name            VARCHAR(200) NOT NULL,
    category_id          INT NOT NULL REFERENCES sport_categories(category_id),
    owner_unit_id        INT REFERENCES organization_units(unit_id),
    responsible_user_id  INT REFERENCES users(user_id),
    item_type            item_type NOT NULL DEFAULT 'DURABLE',
    is_serialized        BOOLEAN   NOT NULL DEFAULT FALSE,
    has_variants         BOOLEAN   NOT NULL DEFAULT FALSE,
    brand                VARCHAR(100),
    model                VARCHAR(100),
    unit_of_measure      VARCHAR(20) NOT NULL DEFAULT 'ชิ้น',
    image_url            VARCHAR(255),
    default_location_id  INT REFERENCES locations(location_id),
    min_stock_alert      INT NOT NULL DEFAULT 0,
    is_borrowable        BOOLEAN NOT NULL DEFAULT TRUE,
    is_reservable        BOOLEAN NOT NULL DEFAULT TRUE,  -- ให้ระบบตารางสอนจองล่วงหน้าได้ไหม
    max_borrow_days      INT NOT NULL DEFAULT 7,
    require_approval     BOOLEAN NOT NULL DEFAULT TRUE,
    useful_life_years    INT,                            -- ใช้คำนวณค่าเสื่อมราคา
    description          TEXT,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_items_unit     ON items(owner_unit_id);

-- รองรับ สี / ไซส์ / เบอร์  (เสื้อกีฬาสี, ชุดป้องกันเทควันโดเบอร์ 1-4, ตัวจับปีนหน้าผา)
CREATE TABLE item_variants (
    variant_id        SERIAL PRIMARY KEY,
    item_id           INT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    variant_code      VARCHAR(40) NOT NULL UNIQUE,
    attr_1_name       VARCHAR(30) NOT NULL,
    attr_1_value      VARCHAR(50) NOT NULL,
    attr_2_name       VARCHAR(30),
    attr_2_value      VARCHAR(50),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (item_id, attr_1_value, attr_2_value)
);

-- ครุภัณฑ์รายชิ้น (มีเลขครุภัณฑ์ / QR)
CREATE TABLE item_units (
    unit_id              SERIAL PRIMARY KEY,
    item_id              INT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    variant_id           INT REFERENCES item_variants(variant_id),
    asset_number         VARCHAR(50) UNIQUE,     -- เลขครุภัณฑ์ทางการ เช่น ACT-SPORT-03-4787
    serial_number        VARCHAR(100),
    qr_code              VARCHAR(100) UNIQUE,
    current_location_id  INT REFERENCES locations(location_id),
    status               unit_status NOT NULL DEFAULT 'AVAILABLE',
    condition_grade      condition_grade NOT NULL DEFAULT 'A',
    purchase_date        DATE,
    purchase_price       NUMERIC(12,2),
    budget_year          INT,
    supplier             VARCHAR(150),
    warranty_expire_date DATE,
    note                 TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_units_item_status ON item_units(item_id, status);
CREATE INDEX idx_units_location    ON item_units(current_location_id);

-- ยอดคงเหลือ "ต่อสถานที่" -- ห้าม UPDATE ตรง ๆ (trigger จัดการให้)
CREATE TABLE stock_balances (
    balance_id     BIGSERIAL PRIMARY KEY,
    item_id        INT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    variant_id     INT REFERENCES item_variants(variant_id) ON DELETE CASCADE,
    location_id    INT NOT NULL REFERENCES locations(location_id),
    qty_total      INT NOT NULL DEFAULT 0,
    qty_available  INT NOT NULL DEFAULT 0,
    qty_borrowed   INT NOT NULL DEFAULT 0,
    qty_damaged    INT NOT NULL DEFAULT 0,
    qty_lost       INT NOT NULL DEFAULT 0,
    qty_disposed   INT NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (qty_available >= 0)
);
CREATE UNIQUE INDEX uq_balance ON stock_balances
    (item_id, location_id, COALESCE(variant_id, 0));

-- Ledger กลาง : ทุกการเคลื่อนไหวของสต็อกต้องผ่านตารางนี้
CREATE TABLE stock_transactions (
    trx_id            BIGSERIAL PRIMARY KEY,
    trx_type          trx_type NOT NULL,
    item_id           INT NOT NULL REFERENCES items(item_id),
    variant_id        INT REFERENCES item_variants(variant_id),
    unit_id           INT REFERENCES item_units(unit_id),
    qty               INT NOT NULL,           -- +เข้า / -ออก
    location_from_id  INT REFERENCES locations(location_id),
    location_to_id    INT REFERENCES locations(location_id),
    ref_type          VARCHAR(30),            -- BORROW | RETURN | RESERVATION | MAINTENANCE | COUNT | MANUAL
    ref_id            BIGINT,
    performed_by      INT REFERENCES users(user_id),
    note              TEXT,
    trx_date          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trx_item_date ON stock_transactions(item_id, trx_date DESC);
CREATE INDEX idx_trx_ref       ON stock_transactions(ref_type, ref_id);

CREATE TABLE maintenance_records (
    maintenance_id      BIGSERIAL PRIMARY KEY,
    item_id             INT NOT NULL REFERENCES items(item_id),
    variant_id          INT REFERENCES item_variants(variant_id),
    unit_id             INT REFERENCES item_units(unit_id),
    qty                 INT NOT NULL DEFAULT 1,
    location_id         INT REFERENCES locations(location_id),
    reported_by         INT REFERENCES users(user_id),
    report_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_session_id   BIGINT,                -- FK เพิ่มหลังสร้าง class_sessions
    source_return_id    BIGINT,
    problem_description TEXT NOT NULL,
    action_taken        TEXT,
    vendor              VARCHAR(150),
    cost                NUMERIC(12,2) DEFAULT 0,
    status              maintenance_status NOT NULL DEFAULT 'REPORTED',
    completed_date      DATE,
    photo_urls          JSONB
);
CREATE INDEX idx_maint_status ON maintenance_records(status, report_date DESC);


-- =====================================================================
-- SECTION 4 : ตารางสอน  (Courses / Schedules / Sessions)
-- =====================================================================

CREATE TABLE academic_terms (
    term_id     SERIAL PRIMARY KEY,
    term_code   VARCHAR(20) NOT NULL UNIQUE,   -- '2568-1'
    term_name   VARCHAR(100) NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    is_current  BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (end_date > start_date)
);

CREATE TABLE courses (
    course_id          SERIAL PRIMARY KEY,
    course_code        VARCHAR(30)  NOT NULL UNIQUE,
    course_name        VARCHAR(200) NOT NULL,
    category_id        INT NOT NULL REFERENCES sport_categories(category_id),
    term_id            INT NOT NULL REFERENCES academic_terms(term_id),
    level              VARCHAR(50),             -- 'ป.1-ป.3', 'ม.ปลาย', 'บุคคลทั่วไป'
    description        TEXT,
    max_participants   INT,
    is_open_enrollment BOOLEAN NOT NULL DEFAULT FALSE,  -- ให้คนนอกจองคาบได้
    status             course_status NOT NULL DEFAULT 'DRAFT',
    created_by         INT REFERENCES users(user_id),
    approved_by        INT REFERENCES users(user_id),
    approved_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE course_instructors (
    course_id     INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    user_id       INT NOT NULL REFERENCES users(user_id),
    is_primary    BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (course_id, user_id)
);

-- กติกาการเกิดซ้ำ : ทุกวันจันทร์ 08:30-09:20 ที่ยิม A
CREATE TABLE class_schedules (
    schedule_id    SERIAL PRIMARY KEY,
    course_id      INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    instructor_id  INT NOT NULL REFERENCES users(user_id),
    location_id    INT NOT NULL REFERENCES locations(location_id),
    day_of_week    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time     TIME NOT NULL,
    end_time       TIME NOT NULL,
    effective_from DATE NOT NULL,
    effective_to   DATE NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_time > start_time),
    CHECK (effective_to >= effective_from)
);
CREATE INDEX idx_sched_loc_day ON class_schedules(location_id, day_of_week);

-- คาบจริงรายวัน (generate จาก class_schedules) -- ใช้เป็นฐานของทุกรายงาน
CREATE TABLE class_sessions (
    session_id      BIGSERIAL PRIMARY KEY,
    schedule_id     INT REFERENCES class_schedules(schedule_id) ON DELETE SET NULL,
    course_id       INT NOT NULL REFERENCES courses(course_id),
    instructor_id   INT NOT NULL REFERENCES users(user_id),
    location_id     INT NOT NULL REFERENCES locations(location_id),
    session_date    DATE NOT NULL,
    start_at        TIMESTAMPTZ NOT NULL,
    end_at          TIMESTAMPTZ NOT NULL,
    status          session_status NOT NULL DEFAULT 'SCHEDULED',
    actual_start_at TIMESTAMPTZ,
    actual_end_at   TIMESTAMPTZ,
    attendee_count  INT,
    cancel_reason   TEXT,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at),

    -- กันสอนชนห้อง: สถานที่เดียวกัน ช่วงเวลาทับกัน ไม่ได้ (ยกเว้นคาบที่ยกเลิก)
    EXCLUDE USING gist (
        location_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
    ) WHERE (status <> 'CANCELLED'),

    -- กันครูสอนซ้อนเวลา
    EXCLUDE USING gist (
        instructor_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
    ) WHERE (status <> 'CANCELLED')
);
CREATE INDEX idx_session_date       ON class_sessions(session_date);
CREATE INDEX idx_session_instructor ON class_sessions(instructor_id, session_date);
CREATE INDEX idx_session_location   ON class_sessions(location_id, start_at);
CREATE INDEX idx_session_range      ON class_sessions USING gist (tstzrange(start_at, end_at, '[)'));

ALTER TABLE maintenance_records
    ADD CONSTRAINT fk_maint_session FOREIGN KEY (source_session_id) REFERENCES class_sessions(session_id);

-- "คอร์สนี้ ทุกคาบต้องใช้ลูกฟุตซอล 10 ลูก + กรวย 20 อัน"
CREATE TABLE course_asset_requirements (
    requirement_id  SERIAL PRIMARY KEY,
    course_id       INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    item_id         INT NOT NULL REFERENCES items(item_id),
    variant_id      INT REFERENCES item_variants(variant_id),
    qty_required    INT NOT NULL CHECK (qty_required > 0),
    is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = ขาดได้ ไม่บล็อกการเปิดคอร์ส
    note            VARCHAR(255),
    UNIQUE (course_id, item_id, variant_id)
);

CREATE TABLE class_enrollments (
    enrollment_id  BIGSERIAL PRIMARY KEY,
    course_id      INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    user_id        INT NOT NULL REFERENCES users(user_id),
    enrolled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    UNIQUE (course_id, user_id)
);

CREATE TABLE session_attendance (
    session_id  BIGINT NOT NULL REFERENCES class_sessions(session_id) ON DELETE CASCADE,
    user_id     INT NOT NULL REFERENCES users(user_id),
    status      VARCHAR(20) NOT NULL DEFAULT 'PRESENT',  -- PRESENT | ABSENT | LATE | EXCUSED
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id)
);


-- =====================================================================
-- SECTION 5 : การจองสถานที่  (Location Booking)
-- =====================================================================

CREATE TABLE location_bookings (
    booking_id        BIGSERIAL PRIMARY KEY,
    booking_no        VARCHAR(30) NOT NULL UNIQUE,
    location_id       INT NOT NULL REFERENCES locations(location_id),
    user_id           INT NOT NULL REFERENCES users(user_id),
    category_id       INT REFERENCES sport_categories(category_id),
    activity_name     VARCHAR(200) NOT NULL,
    start_at          TIMESTAMPTZ NOT NULL,
    end_at            TIMESTAMPTZ NOT NULL,
    participant_count INT,
    status            booking_status NOT NULL DEFAULT 'PENDING',
    approved_by       INT REFERENCES users(user_id),
    approved_at       TIMESTAMPTZ,
    reject_reason     TEXT,
    note              TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at),

    -- กันจองชน (นับเฉพาะที่อนุมัติแล้ว/กำลังใช้)
    EXCLUDE USING gist (
        location_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
    ) WHERE (status IN ('APPROVED','IN_USE'))
);
CREATE INDEX idx_booking_loc_time ON location_bookings(location_id, start_at);


-- =====================================================================
-- SECTION 6 : การสำรองครุภัณฑ์  ★ หัวใจการเชื่อมตารางสอน <-> สต็อก
-- =====================================================================

CREATE TABLE asset_reservations (
    reservation_id  BIGSERIAL PRIMARY KEY,
    source_type     reservation_source NOT NULL,
    session_id      BIGINT REFERENCES class_sessions(session_id)   ON DELETE CASCADE,
    booking_id      BIGINT REFERENCES location_bookings(booking_id) ON DELETE CASCADE,
    item_id         INT NOT NULL REFERENCES items(item_id),
    variant_id      INT REFERENCES item_variants(variant_id),
    location_id     INT NOT NULL REFERENCES locations(location_id), -- สต็อกของสถานที่ไหนถูกกัน
    qty             INT NOT NULL CHECK (qty > 0),
    start_at        TIMESTAMPTZ NOT NULL,
    end_at          TIMESTAMPTZ NOT NULL,
    status          reservation_status NOT NULL DEFAULT 'RESERVED',
    created_by      INT REFERENCES users(user_id),
    released_at     TIMESTAMPTZ,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at),
    CHECK (
        (source_type = 'CLASS_SESSION'    AND session_id IS NOT NULL) OR
        (source_type = 'LOCATION_BOOKING' AND booking_id IS NOT NULL) OR
        (source_type = 'MANUAL')
    )
);
-- index สำคัญที่สุดของระบบ : ใช้หาว่ามี reservation ทับช่วงเวลาหรือไม่
CREATE INDEX idx_resv_item_range ON asset_reservations
    USING gist (item_id, location_id, tstzrange(start_at, end_at, '[)'))
    WHERE status IN ('RESERVED','ISSUED');
CREATE INDEX idx_resv_session ON asset_reservations(session_id);
CREATE INDEX idx_resv_status  ON asset_reservations(status, start_at);


-- =====================================================================
-- SECTION 7 : ยืม-คืน  (Borrow & Return)
-- =====================================================================

CREATE TABLE borrow_requests (
    request_id           BIGSERIAL PRIMARY KEY,
    request_no           VARCHAR(30) NOT NULL UNIQUE,
    borrower_id          INT NOT NULL REFERENCES users(user_id),
    borrower_unit_id     INT REFERENCES organization_units(unit_id),
    borrower_org_name    VARCHAR(150),          -- กรณีหน่วยงานภายนอก เช่น อารีน่า
    purpose              TEXT,
    session_id           BIGINT REFERENCES class_sessions(session_id),  -- ยืมเพื่อใช้ในคาบสอน
    booking_id           BIGINT REFERENCES location_bookings(booking_id),
    source_location_id   INT NOT NULL REFERENCES locations(location_id), -- เบิกจากสโตร์ไหน
    usage_location_id    INT REFERENCES locations(location_id),
    external_location    VARCHAR(255),
    borrow_date          TIMESTAMPTZ,
    due_date             TIMESTAMPTZ NOT NULL,
    actual_return_date   TIMESTAMPTZ,
    status               borrow_status NOT NULL DEFAULT 'PENDING',
    approved_by          INT REFERENCES users(user_id),
    approved_at          TIMESTAMPTZ,
    reject_reason        TEXT,
    issued_by            INT REFERENCES users(user_id),
    received_by          INT REFERENCES users(user_id),
    total_penalty        NUMERIC(12,2) NOT NULL DEFAULT 0,
    note                 TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_borrow_status_due ON borrow_requests(status, due_date);
CREATE INDEX idx_borrow_borrower   ON borrow_requests(borrower_id, created_at DESC);
CREATE INDEX idx_borrow_session    ON borrow_requests(session_id);

CREATE TABLE borrow_items (
    borrow_item_id   BIGSERIAL PRIMARY KEY,
    request_id       BIGINT NOT NULL REFERENCES borrow_requests(request_id) ON DELETE CASCADE,
    item_id          INT NOT NULL REFERENCES items(item_id),
    variant_id       INT REFERENCES item_variants(variant_id),
    unit_id          INT REFERENCES item_units(unit_id),
    reservation_id   BIGINT REFERENCES asset_reservations(reservation_id),
    qty_requested    INT NOT NULL CHECK (qty_requested > 0),
    qty_approved     INT NOT NULL DEFAULT 0,
    qty_issued       INT NOT NULL DEFAULT 0,
    qty_returned     INT NOT NULL DEFAULT 0,
    condition_before condition_grade,
    photo_before_url VARCHAR(255),
    line_status      VARCHAR(20) NOT NULL DEFAULT 'PENDING'
);

CREATE TABLE return_records (
    return_id    BIGSERIAL PRIMARY KEY,
    return_no    VARCHAR(30) NOT NULL UNIQUE,
    request_id   BIGINT NOT NULL REFERENCES borrow_requests(request_id),
    session_id   BIGINT REFERENCES class_sessions(session_id),
    return_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
    returned_by  INT REFERENCES users(user_id),
    received_by  INT NOT NULL REFERENCES users(user_id),
    is_late      BOOLEAN NOT NULL DEFAULT FALSE,
    late_days    INT NOT NULL DEFAULT 0,
    overall_note TEXT
);

CREATE TABLE return_items (
    return_item_id  BIGSERIAL PRIMARY KEY,
    return_id       BIGINT NOT NULL REFERENCES return_records(return_id) ON DELETE CASCADE,
    borrow_item_id  BIGINT NOT NULL REFERENCES borrow_items(borrow_item_id),
    unit_id         INT REFERENCES item_units(unit_id),
    qty_returned    INT NOT NULL DEFAULT 0,
    qty_damaged     INT NOT NULL DEFAULT 0,
    qty_lost        INT NOT NULL DEFAULT 0,
    condition_after return_condition NOT NULL DEFAULT 'GOOD',
    damage_note     TEXT,
    photo_after_url VARCHAR(255),
    post_action     VARCHAR(20) NOT NULL DEFAULT 'RESTOCK',  -- RESTOCK | SEND_REPAIR | DISPOSE
    penalty_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
    inspected_by    INT REFERENCES users(user_id)
);

CREATE TABLE penalties (
    penalty_id     BIGSERIAL PRIMARY KEY,
    request_id     BIGINT REFERENCES borrow_requests(request_id),
    return_item_id BIGINT REFERENCES return_items(return_item_id),
    user_id        INT NOT NULL REFERENCES users(user_id),
    penalty_type   VARCHAR(20) NOT NULL,       -- LATE | DAMAGE | LOST
    amount         NUMERIC(12,2) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
    paid_at        TIMESTAMPTZ,
    note           TEXT
);


-- =====================================================================
-- SECTION 8 : ตรวจนับประจำปี  (Inventory Count)
-- =====================================================================

CREATE TABLE inventory_counts (
    count_id              BIGSERIAL PRIMARY KEY,
    count_no              VARCHAR(30) NOT NULL UNIQUE,   -- IC-2568-01
    fiscal_year           INT NOT NULL,
    unit_id               INT NOT NULL REFERENCES organization_units(unit_id),
    count_date            DATE NOT NULL,
    responsible_user_id   INT REFERENCES users(user_id),
    responsible_signed_at TIMESTAMPTZ,
    head_user_id          INT REFERENCES users(user_id),
    head_signed_at        TIMESTAMPTZ,
    auditor_user_id       INT REFERENCES users(user_id),
    auditor_signed_at     TIMESTAMPTZ,
    status                VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_count_items (
    count_item_id  BIGSERIAL PRIMARY KEY,
    count_id       BIGINT NOT NULL REFERENCES inventory_counts(count_id) ON DELETE CASCADE,
    item_id        INT NOT NULL REFERENCES items(item_id),
    variant_id     INT REFERENCES item_variants(variant_id),
    unit_id        INT REFERENCES item_units(unit_id),
    location_id    INT REFERENCES locations(location_id),
    qty_system     INT NOT NULL DEFAULT 0,
    qty_counted    INT,
    qty_damaged    INT NOT NULL DEFAULT 0,
    qty_lost       INT NOT NULL DEFAULT 0,
    variance       INT GENERATED ALWAYS AS (COALESCE(qty_counted,0) - qty_system) STORED,
    is_checked     BOOLEAN NOT NULL DEFAULT FALSE,
    counted_by     INT REFERENCES users(user_id),
    note           TEXT
);


-- =====================================================================
-- SECTION 9 : รายงานและการแจ้งเตือน  (Reports & Notifications)
-- =====================================================================

-- เก็บผลรายงานรายเดือนที่ปิดงวดแล้ว -> ผู้บริหารเปิดดูย้อนหลังได้ทันทีโดยไม่ต้องคำนวณใหม่
CREATE TABLE monthly_report_snapshots (
    snapshot_id   BIGSERIAL PRIMARY KEY,
    report_type   report_type NOT NULL,
    period_year   INT NOT NULL,
    period_month  INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    unit_id       INT REFERENCES organization_units(unit_id),
    location_id   INT REFERENCES locations(location_id),
    payload       JSONB NOT NULL,             -- ผลสรุปทั้งก้อน
    generated_by  INT REFERENCES users(user_id),
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_final      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX uq_snapshot_period ON monthly_report_snapshots
    (report_type, period_year, period_month, COALESCE(unit_id,0), COALESCE(location_id,0));

CREATE TABLE report_exports (
    export_id     BIGSERIAL PRIMARY KEY,
    snapshot_id   BIGINT REFERENCES monthly_report_snapshots(snapshot_id),
    report_type   report_type NOT NULL,
    format        report_format NOT NULL,
    params        JSONB,
    file_url      VARCHAR(255),
    file_size     BIGINT,
    status        job_status NOT NULL DEFAULT 'QUEUED',
    error_message TEXT,
    requested_by  INT REFERENCES users(user_id),
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ
);

CREATE TABLE notifications (
    notification_id BIGSERIAL PRIMARY KEY,
    type            VARCHAR(40) NOT NULL,
    title           VARCHAR(200) NOT NULL,
    message         TEXT,
    ref_type        VARCHAR(30),
    ref_id          BIGINT,
    target_user_id  INT REFERENCES users(user_id),
    target_role_id  INT REFERENCES roles(role_id),
    target_location_id INT REFERENCES locations(location_id),
    priority        VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_target ON notifications(target_user_id, is_read, created_at DESC);


-- =====================================================================
-- SECTION 10 : FUNCTIONS & TRIGGERS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 10.1 คำนวณจำนวนที่ "ยืมได้จริง" ในช่วงเวลาหนึ่ง
--      = ยอดพร้อมใช้ - ยอดที่ถูกสำรองไว้ในช่วงเวลาที่ทับกัน
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_available_qty(
    p_item_id     INT,
    p_variant_id  INT,
    p_location_id INT,
    p_start       TIMESTAMPTZ,
    p_end         TIMESTAMPTZ,
    p_exclude_reservation BIGINT DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_stock    INT := 0;
    v_reserved INT := 0;
BEGIN
    SELECT COALESCE(qty_available, 0) INTO v_stock
    FROM stock_balances
    WHERE item_id = p_item_id
      AND location_id = p_location_id
      AND COALESCE(variant_id, 0) = COALESCE(p_variant_id, 0);

    SELECT COALESCE(SUM(qty), 0) INTO v_reserved
    FROM asset_reservations
    WHERE item_id = p_item_id
      AND location_id = p_location_id
      AND COALESCE(variant_id, 0) = COALESCE(p_variant_id, 0)
      AND status IN ('RESERVED', 'ISSUED')
      AND (p_exclude_reservation IS NULL OR reservation_id <> p_exclude_reservation)
      AND tstzrange(start_at, end_at, '[)') && tstzrange(p_start, p_end, '[)');

    RETURN GREATEST(COALESCE(v_stock,0) - v_reserved, 0);
END;
$$;


-- ---------------------------------------------------------------------
-- 10.2 สร้าง reservation แบบกันแข่งกัน (race condition safe)
--      ใช้ advisory lock ต่อ item+location เพื่อกันคนกดพร้อมกัน
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_reserve_asset(
    p_source_type  reservation_source,
    p_session_id   BIGINT,
    p_booking_id   BIGINT,
    p_item_id      INT,
    p_variant_id   INT,
    p_location_id  INT,
    p_qty          INT,
    p_start        TIMESTAMPTZ,
    p_end          TIMESTAMPTZ,
    p_user_id      INT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    v_available INT;
    v_id        BIGINT;
BEGIN
    -- ล็อกเชิงตรรกะเฉพาะคู่ item+location นี้ (ไม่ล็อกทั้งตาราง)
    PERFORM pg_advisory_xact_lock(p_item_id::BIGINT * 100000 + p_location_id);

    v_available := fn_available_qty(p_item_id, p_variant_id, p_location_id, p_start, p_end);

    IF v_available < p_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: item % ที่สถานที่ % มีพอใช้ % ชิ้น แต่ขอ % ชิ้น',
            p_item_id, p_location_id, v_available, p_qty
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO asset_reservations (
        source_type, session_id, booking_id, item_id, variant_id,
        location_id, qty, start_at, end_at, status, created_by
    ) VALUES (
        p_source_type, p_session_id, p_booking_id, p_item_id, p_variant_id,
        p_location_id, p_qty, p_start, p_end, 'RESERVED', p_user_id
    ) RETURNING reservation_id INTO v_id;

    RETURN v_id;
END;
$$;


-- ---------------------------------------------------------------------
-- 10.3 Trigger : ปรับ stock_balances อัตโนมัติจาก stock_transactions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_apply_stock_transaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_loc INT;
BEGIN
    v_loc := COALESCE(NEW.location_to_id, NEW.location_from_id);

    INSERT INTO stock_balances (item_id, variant_id, location_id, qty_total, qty_available)
    VALUES (NEW.item_id, NEW.variant_id, v_loc, 0, 0)
    ON CONFLICT (item_id, location_id, COALESCE(variant_id, 0)) DO NOTHING;

    CASE NEW.trx_type
        WHEN 'RECEIVE' THEN
            UPDATE stock_balances SET qty_total = qty_total + NEW.qty,
                                      qty_available = qty_available + NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'BORROW' THEN
            UPDATE stock_balances SET qty_available = qty_available - NEW.qty,
                                      qty_borrowed  = qty_borrowed + NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'RETURN' THEN
            UPDATE stock_balances SET qty_available = qty_available + NEW.qty,
                                      qty_borrowed  = qty_borrowed - NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'REPAIR_OUT' THEN   -- พบชำรุด -> ตัดจากพร้อมใช้ ไปเป็นชำรุด
            UPDATE stock_balances SET qty_available = qty_available - NEW.qty,
                                      qty_damaged   = qty_damaged + NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'REPAIR_IN' THEN    -- ซ่อมเสร็จ -> กลับมาพร้อมใช้
            UPDATE stock_balances SET qty_available = qty_available + NEW.qty,
                                      qty_damaged   = qty_damaged - NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'LOST' THEN
            UPDATE stock_balances SET qty_available = qty_available - NEW.qty,
                                      qty_lost      = qty_lost + NEW.qty,
                                      qty_total     = qty_total - NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'DISPOSE' THEN
            UPDATE stock_balances SET qty_damaged   = GREATEST(qty_damaged - NEW.qty, 0),
                                      qty_disposed  = qty_disposed + NEW.qty,
                                      qty_total     = qty_total - NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'ADJUST' THEN
            UPDATE stock_balances SET qty_total     = qty_total + NEW.qty,
                                      qty_available = qty_available + NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = v_loc
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

        WHEN 'TRANSFER' THEN
            UPDATE stock_balances SET qty_total = qty_total - NEW.qty,
                                      qty_available = qty_available - NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = NEW.location_from_id
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);

            INSERT INTO stock_balances (item_id, variant_id, location_id, qty_total, qty_available)
            VALUES (NEW.item_id, NEW.variant_id, NEW.location_to_id, 0, 0)
            ON CONFLICT (item_id, location_id, COALESCE(variant_id, 0)) DO NOTHING;

            UPDATE stock_balances SET qty_total = qty_total + NEW.qty,
                                      qty_available = qty_available + NEW.qty, updated_at = now()
             WHERE item_id = NEW.item_id AND location_id = NEW.location_to_id
               AND COALESCE(variant_id,0) = COALESCE(NEW.variant_id,0);
        ELSE
            NULL;
    END CASE;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_stock_transaction_apply
AFTER INSERT ON stock_transactions
FOR EACH ROW EXECUTE FUNCTION trg_apply_stock_transaction();


-- ---------------------------------------------------------------------
-- 10.4 Trigger : คาบเรียนถูกยกเลิก -> ปล่อยครุภัณฑ์ที่สำรองไว้คืนทันที
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_release_on_session_cancel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
        UPDATE asset_reservations
           SET status = 'RELEASED', released_at = now()
         WHERE session_id = NEW.session_id
           AND status = 'RESERVED';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_session_cancel_release
AFTER UPDATE OF status ON class_sessions
FOR EACH ROW EXECUTE FUNCTION trg_release_on_session_cancel();


-- ---------------------------------------------------------------------
-- 10.5 Trigger : แจ้งเตือนของใกล้หมด
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_low_stock_alert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_min  INT;
    v_name VARCHAR(200);
BEGIN
    SELECT min_stock_alert, item_name INTO v_min, v_name FROM items WHERE item_id = NEW.item_id;

    IF v_min > 0 AND NEW.qty_available <= v_min AND
       (OLD.qty_available IS NULL OR OLD.qty_available > v_min) THEN
        INSERT INTO notifications (type, title, message, ref_type, ref_id, target_location_id, priority)
        VALUES ('LOW_STOCK',
                'อุปกรณ์ใกล้หมด: ' || v_name,
                'คงเหลือ ' || NEW.qty_available || ' (เกณฑ์แจ้งเตือน ' || v_min || ')',
                'ITEM', NEW.item_id, NEW.location_id,
                CASE WHEN NEW.qty_available = 0 THEN 'HIGH' ELSE 'NORMAL' END);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_low_stock
AFTER UPDATE OF qty_available ON stock_balances
FOR EACH ROW EXECUTE FUNCTION trg_low_stock_alert();


-- =====================================================================
-- SECTION 11 : VIEWS สำหรับรายงานผู้บริหาร
-- =====================================================================

-- 11.1 สต็อกพร้อมใช้แบบ real-time แยกตามสถานที่
CREATE OR REPLACE VIEW v_live_stock AS
SELECT b.balance_id, i.item_id, i.item_code, i.item_name,
       c.category_code, c.category_name,
       v.variant_id, v.attr_1_value, v.attr_2_value,
       l.location_id, l.location_code, l.location_name,
       b.qty_total, b.qty_available, b.qty_borrowed,
       b.qty_damaged, b.qty_lost, b.qty_disposed,
       COALESCE((
           SELECT SUM(r.qty) FROM asset_reservations r
            WHERE r.item_id = b.item_id AND r.location_id = b.location_id
              AND COALESCE(r.variant_id,0) = COALESCE(b.variant_id,0)
              AND r.status IN ('RESERVED','ISSUED')
              AND tstzrange(r.start_at, r.end_at,'[)') && tstzrange(now(), now() + interval '1 day','[)')
       ), 0) AS qty_reserved_today,
       i.min_stock_alert,
       (b.qty_available <= i.min_stock_alert AND i.min_stock_alert > 0) AS is_low_stock
FROM stock_balances b
JOIN items i            ON i.item_id = b.item_id
JOIN sport_categories c ON c.category_id = i.category_id
JOIN locations l        ON l.location_id = b.location_id
LEFT JOIN item_variants v ON v.variant_id = b.variant_id;


-- 11.2 อัตราการใช้งานสถานที่รายเดือน
--      = (ชั่วโมงสอน + ชั่วโมงที่ถูกจอง) / ชั่วโมงเปิดทำการต่อเดือน
CREATE OR REPLACE VIEW v_location_utilization_monthly AS
WITH used AS (
    SELECT location_id,
           date_trunc('month', start_at) AS period,
           SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 3600.0) AS used_hours,
           COUNT(*) AS session_count
      FROM class_sessions
     WHERE status IN ('COMPLETED','IN_PROGRESS','SCHEDULED')
     GROUP BY location_id, date_trunc('month', start_at)
),
booked AS (
    SELECT location_id,
           date_trunc('month', start_at) AS period,
           SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 3600.0) AS booked_hours,
           COUNT(*) AS booking_count
      FROM location_bookings
     WHERE status IN ('APPROVED','IN_USE','COMPLETED')
     GROUP BY location_id, date_trunc('month', start_at)
),
periods AS (
    SELECT location_id, period FROM used
    UNION
    SELECT location_id, period FROM booked
),
capacity AS (
    SELECT l.location_id,
           COALESCE(SUM(EXTRACT(EPOCH FROM (oh.close_time - oh.open_time))/3600.0) * 4.3, 0) AS monthly_open_hours
      FROM locations l
      LEFT JOIN location_operating_hours oh ON oh.location_id = l.location_id
     GROUP BY l.location_id
)
SELECT l.location_id, l.location_code, l.location_name, l.location_type,
       p.period,
       COALESCE(u.used_hours, 0)   AS teaching_hours,
       COALESCE(b.booked_hours, 0) AS booking_hours,
       COALESCE(u.used_hours,0) + COALESCE(b.booked_hours,0) AS total_used_hours,
       cap.monthly_open_hours,
       ROUND(
         CASE WHEN cap.monthly_open_hours > 0
              THEN ((COALESCE(u.used_hours,0) + COALESCE(b.booked_hours,0))
                    / cap.monthly_open_hours * 100)::NUMERIC
              ELSE 0 END, 2
       ) AS utilization_rate_pct,
       COALESCE(u.session_count,0) AS session_count,
       COALESCE(b.booking_count,0) AS booking_count
FROM periods p
JOIN locations l       ON l.location_id = p.location_id
LEFT JOIN used   u     ON u.location_id = p.location_id AND u.period = p.period
LEFT JOIN booked b     ON b.location_id = p.location_id AND b.period = p.period
LEFT JOIN capacity cap ON cap.location_id = p.location_id;


-- 11.3 อัตราการใช้งานครุภัณฑ์รายเดือน (อุปกรณ์ไหนถูกใช้บ่อยที่สุด)
CREATE OR REPLACE VIEW v_asset_utilization_monthly AS
SELECT i.item_id, i.item_code, i.item_name,
       c.category_code, c.category_name,
       r.location_id, l.location_name,
       date_trunc('month', r.start_at) AS period,
       COUNT(*)                                                   AS times_used,
       SUM(r.qty)                                                 AS total_qty_used,
       SUM(EXTRACT(EPOCH FROM (r.end_at - r.start_at))/3600.0)    AS total_hours_used,
       SUM(CASE WHEN r.source_type = 'CLASS_SESSION' THEN 1 ELSE 0 END) AS used_in_classes,
       MAX(b.qty_total)                                           AS qty_on_hand,
       ROUND(
         CASE WHEN MAX(b.qty_total) > 0
              THEN AVG(r.qty)::NUMERIC / MAX(b.qty_total) * 100
              ELSE 0 END, 2
       ) AS avg_usage_pct_of_stock
FROM asset_reservations r
JOIN items i            ON i.item_id = r.item_id
JOIN sport_categories c ON c.category_id = i.category_id
JOIN locations l        ON l.location_id = r.location_id
LEFT JOIN stock_balances b ON b.item_id = r.item_id AND b.location_id = r.location_id
WHERE r.status IN ('RESERVED','ISSUED','RETURNED')
GROUP BY i.item_id, i.item_code, i.item_name, c.category_code, c.category_name,
         r.location_id, l.location_name, date_trunc('month', r.start_at);


-- 11.4 สรุปชั่วโมงสอนของครูรายเดือน
CREATE OR REPLACE VIEW v_instructor_teaching_hours_monthly AS
SELECT u.user_id, u.full_name, u.member_code,
       ou.unit_name,
       date_trunc('month', s.start_at) AS period,
       COUNT(*) FILTER (WHERE s.status = 'COMPLETED')  AS sessions_completed,
       COUNT(*) FILTER (WHERE s.status = 'CANCELLED')  AS sessions_cancelled,
       COUNT(DISTINCT s.course_id)                     AS courses_taught,
       ROUND(SUM(
         CASE WHEN s.status = 'COMPLETED'
              THEN EXTRACT(EPOCH FROM (COALESCE(s.actual_end_at, s.end_at)
                                     - COALESCE(s.actual_start_at, s.start_at)))/3600.0
              ELSE 0 END
       )::NUMERIC, 2) AS total_teaching_hours,
       SUM(COALESCE(s.attendee_count,0)) AS total_attendees
FROM class_sessions s
JOIN users u  ON u.user_id = s.instructor_id
LEFT JOIN organization_units ou ON ou.unit_id = u.unit_id
GROUP BY u.user_id, u.full_name, u.member_code, ou.unit_name, date_trunc('month', s.start_at);


-- 11.5 สรุปสถานะครุภัณฑ์ + ค่าเสื่อมราคา (เส้นตรง)
CREATE OR REPLACE VIEW v_asset_status_summary AS
SELECT i.item_id, i.item_code, i.item_name,
       c.category_code, c.category_name,
       SUM(b.qty_total)     AS qty_total,
       SUM(b.qty_available) AS qty_available,
       SUM(b.qty_borrowed)  AS qty_borrowed,
       SUM(b.qty_damaged)   AS qty_damaged,
       SUM(b.qty_lost)      AS qty_lost,
       SUM(b.qty_disposed)  AS qty_disposed,
       (SELECT COUNT(*) FROM maintenance_records m
         WHERE m.item_id = i.item_id AND m.status <> 'COMPLETED') AS open_repair_jobs,
       (SELECT COALESCE(SUM(m.cost),0) FROM maintenance_records m
         WHERE m.item_id = i.item_id)                             AS lifetime_repair_cost,
       (SELECT COALESCE(SUM(iu.purchase_price),0) FROM item_units iu
         WHERE iu.item_id = i.item_id)                            AS acquisition_value,
       (SELECT COALESCE(SUM(
            GREATEST(iu.purchase_price -
              (iu.purchase_price / NULLIF(i.useful_life_years,0))
              * LEAST(EXTRACT(YEAR FROM age(CURRENT_DATE, iu.purchase_date)), COALESCE(i.useful_life_years,0))
            , 0)), 0)
          FROM item_units iu
         WHERE iu.item_id = i.item_id AND iu.purchase_date IS NOT NULL)  AS net_book_value
FROM items i
JOIN sport_categories c    ON c.category_id = i.category_id
LEFT JOIN stock_balances b ON b.item_id = i.item_id
GROUP BY i.item_id, i.item_code, i.item_name, c.category_code, c.category_name, i.useful_life_years;


-- =====================================================================
-- SECTION 12 : SEED DATA ขั้นต่ำ
-- =====================================================================

INSERT INTO roles (role_code, role_name, description) VALUES
 ('PUBLIC',     'บุคคลทั่วไป',        'ดูตารางสอนและสถานะสนามได้ ไม่ต้องล็อกอิน'),
 ('STUDENT',    'นักเรียน',           'ดูตาราง จองคาบเรียน ยืมอุปกรณ์ตามสิทธิ์'),
 ('INSTRUCTOR', 'ครู/ผู้ฝึกสอน',      'จัดการตารางสอนตนเอง เบิก-ยืมครุภัณฑ์เพื่อการสอน'),
 ('STAFF',      'เจ้าหน้าที่ศูนย์กีฬา', 'จัดการสต็อก อนุมัติยืม-คืน เฉพาะสถานที่ที่รับผิดชอบ'),
 ('ADMIN',      'ผู้ดูแลระบบ',        'สิทธิ์เต็มทุกโมดูล'),
 ('EXECUTIVE',  'ผู้บริหาร',          'ดู Dashboard และดึงรายงานเท่านั้น (read-only)');

INSERT INTO permissions (permission_code, module, description) VALUES
 ('schedule.view.public',   'schedule', 'ดูตารางสอนสาธารณะ'),
 ('schedule.manage.own',    'schedule', 'จัดการตารางสอนของตนเอง'),
 ('schedule.manage.all',    'schedule', 'จัดการตารางสอนทั้งหมด'),
 ('asset.view',             'asset',    'ดูรายการครุภัณฑ์'),
 ('asset.manage',           'asset',    'เพิ่ม/แก้ไขครุภัณฑ์'),
 ('asset.damage.report',    'asset',    'บันทึกชำรุด'),
 ('borrow.request',         'borrow',   'ยื่นคำขอยืม'),
 ('borrow.approve',         'borrow',   'อนุมัติคำขอยืม'),
 ('borrow.issue',           'borrow',   'จ่ายของ/รับคืน'),
 ('report.executive.view',  'report',   'ดูรายงานผู้บริหาร'),
 ('report.export',          'report',   'ส่งออกรายงาน PDF/Excel'),
 ('user.manage',            'auth',     'จัดการผู้ใช้และสิทธิ์');
