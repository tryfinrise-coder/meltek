-- MELTEK - LT CT core design system
-- MySQL 8 schema.
-- Applied idempotently at boot when MYSQL_URL is set.

/* ═══ Reference (admin-maintained, versioned) ═══ */

CREATE TABLE IF NOT EXISTS steel_grade (
  id              CHAR(36) PRIMARY KEY,
  code            VARCHAR(50) NOT NULL UNIQUE,
  label           VARCHAR(200) NOT NULL,
  note            TEXT,
  supplier        VARCHAR(200),
  density_g_cm3   DECIMAL(10,4) DEFAULT 7.65,
  stacking_factor DECIMAL(6,4) DEFAULT 0.95,
  is_available    TINYINT(1) NOT NULL DEFAULT 1,
  datasheet_url   TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bh_point (
  id                CHAR(36) PRIMARY KEY,
  grade_id          CHAR(36) NOT NULL,
  flux_density_t    DECIMAL(12,6) NOT NULL,
  magnetising_at_cm DECIMAL(12,6),
  UNIQUE KEY uq_bh (grade_id, flux_density_t),
  FOREIGN KEY (grade_id) REFERENCES steel_grade(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wire_gauge (
  swg           INT PRIMARY KEY,
  dia_mm        DECIMAL(10,4) NOT NULL,
  area_sqmm     DECIMAL(10,4) NOT NULL,
  ohm_per_m_20c DECIMAL(12,8) NOT NULL,
  ohm_per_m_75c DECIMAL(12,8),
  gram_per_m    DECIMAL(10,4) NOT NULL,
  is_available  TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accuracy_class (
  code               VARCHAR(20) PRIMARY KEY,
  percent            DECIMAL(6,2) NOT NULL,
  per_is             TINYINT(1) NOT NULL,
  note               TEXT NOT NULL,
  max_flux_density_t DECIMAL(10,4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS die (
  id           CHAR(36) PRIMARY KEY,
  die_no       VARCHAR(50) NOT NULL,
  min_od_mm    DECIMAL(10,2) NOT NULL,
  max_od_mm    DECIMAL(10,2) NOT NULL,
  max_width_mm DECIMAL(10,2) NOT NULL,
  quantity     INT NOT NULL DEFAULT 0,
  location     VARCHAR(200),
  is_available TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS slit_width (
  width_mm   DECIMAL(10,2) PRIMARY KEY,
  is_stocked TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_rate (
  id             CHAR(36) PRIMARY KEY,
  material_type  VARCHAR(20) NOT NULL,
  grade_id       CHAR(36),
  rate_per_kg    DECIMAL(12,2) NOT NULL,
  effective_from DATE NOT NULL DEFAULT (CURRENT_DATE),
  effective_to   DATE,
  FOREIGN KEY (grade_id) REFERENCES steel_grade(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS process_setting (
  `key`        VARCHAR(100) PRIMARY KEY,
  value        DECIMAL(20,6) NOT NULL,
  unit         VARCHAR(50) NOT NULL DEFAULT '',
  label        VARCHAR(200) NOT NULL DEFAULT '',
  is_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  source_note  TEXT NOT NULL,
  updated_by   VARCHAR(200),
  updated_at   DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ═══ Accounts ═══ */

CREATE TABLE IF NOT EXISTS app_user (
  id              CHAR(36) PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  email           VARCHAR(320) NOT NULL,
  password_hash   TEXT NOT NULL,
  role            VARCHAR(20) NOT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  is_protected    TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_sign_in_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Case-insensitive unique on email. The collation handles case folding.
CREATE UNIQUE INDEX app_user_email_idx ON app_user (email);

CREATE TABLE IF NOT EXISTS user_session (
  token_hash VARCHAR(128) PRIMARY KEY,
  user_id    CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  user_agent TEXT,
  ip         VARCHAR(45),
  FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX user_session_user_idx    ON user_session (user_id);
CREATE INDEX user_session_expires_idx ON user_session (expires_at);

/* ═══ Transactional ═══ */

CREATE TABLE IF NOT EXISTS customer (
  id            CHAR(36) PRIMARY KEY,
  name          VARCHAR(300) NOT NULL,
  gstin         VARCHAR(20),
  contact_name  VARCHAR(200),
  contact_email VARCHAR(320),
  phone         VARCHAR(30),
  default_specs JSON,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX customer_name_idx ON customer (name);

CREATE TABLE IF NOT EXISTS design (
  id                 CHAR(36) PRIMARY KEY,
  design_no          VARCHAR(50) NOT NULL UNIQUE,
  revision           INT NOT NULL DEFAULT 1,
  customer_id        CHAR(36),
  customer_name      VARCHAR(300) NOT NULL,
  enquiry_no         VARCHAR(100),
  po_no              VARCHAR(100),
  prd_no             VARCHAR(100),
  quantity           INT,
  required_by        DATE,
  ct_type            VARCHAR(20) NOT NULL DEFAULT 'ring',
  primary_current    DECIMAL(12,2) NOT NULL,
  secondary_current  DECIMAL(12,2) NOT NULL,
  burden_va          DECIMAL(12,2) NOT NULL,
  accuracy_class     VARCHAR(20) NOT NULL,
  finished_id_mm     DECIMAL(10,2) NOT NULL,
  finished_od_mm     DECIMAL(10,2) NOT NULL,
  max_width_mm       DECIMAL(10,2),
  insulation_type    VARCHAR(100),
  settings_snapshot  JSON,
  reference_snapshot JSON,
  status             VARCHAR(20) NOT NULL DEFAULT 'draft',
  selected_option_id CHAR(36),
  created_by         VARCHAR(200) NOT NULL DEFAULT 'system',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  approved_by        VARCHAR(200),
  approved_at        DATETIME,
  superseded_by      CHAR(36),
  supersedes         CHAR(36),
  FOREIGN KEY (customer_id) REFERENCES customer(id),
  FOREIGN KEY (accuracy_class) REFERENCES accuracy_class(code),
  FOREIGN KEY (superseded_by) REFERENCES design(id),
  FOREIGN KEY (supersedes) REFERENCES design(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX design_status_idx   ON design (status);
CREATE INDEX design_customer_idx ON design (customer_id);

CREATE TABLE IF NOT EXISTS design_option (
  id                CHAR(36) PRIMARY KEY,
  design_id         CHAR(36) NOT NULL,
  grade_code        VARCHAR(50) NOT NULL,
  swg               INT NOT NULL,
  b_raw_t           DECIMAL(12,6),
  b_used_t          DECIMAL(12,6),
  was_capped        TINYINT(1) NOT NULL DEFAULT 0,
  core_area_cm2     DECIMAL(12,6),
  core_width_mm     DECIMAL(10,2),
  ordered_width_mm  DECIMAL(10,2),
  wire_length_m     DECIMAL(12,4),
  resistance_ohm    DECIMAL(12,6),
  v_drop            DECIMAL(12,6),
  v_total           DECIMAL(12,6),
  core_weight_kg    DECIMAL(12,4),
  copper_weight_kg  DECIMAL(12,4),
  core_cost         DECIMAL(12,2),
  copper_cost       DECIMAL(12,2),
  total_cost        DECIMAL(12,2),
  die_id            CHAR(36),
  is_feasible       TINYINT(1) NOT NULL DEFAULT 1,
  infeasible_reason TEXT,
  is_selected       TINYINT(1) NOT NULL DEFAULT 0,
  is_provisional    TINYINT(1) NOT NULL DEFAULT 1,
  `rank`            INT,
  iterations        JSON,
  payload           JSON NOT NULL,
  FOREIGN KEY (design_id) REFERENCES design(id) ON DELETE CASCADE,
  FOREIGN KEY (die_id) REFERENCES die(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX design_option_design_idx ON design_option (design_id);

CREATE TABLE IF NOT EXISTS design_bom (
  id          CHAR(36) PRIMARY KEY,
  design_id   CHAR(36) NOT NULL,
  item_type   VARCHAR(20) NOT NULL,
  item_ref    VARCHAR(100),
  description TEXT NOT NULL,
  quantity    DECIMAL(12,4) NOT NULL,
  unit        VARCHAR(20) NOT NULL,
  FOREIGN KEY (design_id) REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX design_bom_design_idx ON design_bom (design_id);

/* ═══ Manufacturing results ═══ */

CREATE TABLE IF NOT EXISTS manufactured_result (
  id                       CHAR(36) PRIMARY KEY,
  design_id                CHAR(36) NOT NULL,
  batch_no                 VARCHAR(100) NOT NULL,
  manufactured_on          DATE,
  actual_core_grade        VARCHAR(50),
  actual_core_width_mm     DECIMAL(10,2),
  actual_core_weight_kg    DECIMAL(12,4),
  actual_copper_weight_kg  DECIMAL(12,4),
  measured_ratio_error_pct DECIMAL(10,4),
  measured_phase_error_min DECIMAL(10,4),
  measured_resistance_ohm  DECIMAL(12,6),
  test_lab                 VARCHAR(200),
  passed                   TINYINT(1) NOT NULL,
  notes                    TEXT,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (design_id) REFERENCES design(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX manufactured_result_design_idx ON manufactured_result (design_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id        CHAR(36) PRIMARY KEY,
  entity    VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  action    VARCHAR(100) NOT NULL,
  actor     VARCHAR(200) NOT NULL,
  `before`  JSON,
  `after`   JSON,
  at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX audit_log_entity_idx ON audit_log (entity_id);

ALTER TABLE design ADD COLUMN engineering_spec JSON;
INSERT IGNORE INTO accuracy_class (code, percent, per_is, note) VALUES
 ('5P',5,0,'Engineering protection workflow only'), ('10P',10,0,'Engineering protection workflow only'),
 ('PS',0,0,'Client-defined special protection specification'), ('PX',0,0,'Special protection specification; confirm applicable standard');
