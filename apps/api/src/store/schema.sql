-- MELTEK - LT CT core design system
-- PostgreSQL 16 schema, per §7 of the build specification.
-- Applied idempotently at boot when DATABASE_URL is set.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ═══ Reference (admin-maintained, versioned) ═══ */

CREATE TABLE IF NOT EXISTS steel_grade (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,
  label           text NOT NULL,
  note            text,
  supplier        text,
  density_g_cm3   numeric DEFAULT 7.65,
  stacking_factor numeric DEFAULT 0.95,
  is_available    boolean NOT NULL DEFAULT true,
  datasheet_url   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bh_point (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id          uuid NOT NULL REFERENCES steel_grade(id) ON DELETE CASCADE,
  flux_density_t    numeric NOT NULL,
  -- null = this grade is not characterised at that flux density (§6.1)
  magnetising_at_cm numeric,
  UNIQUE (grade_id, flux_density_t)
);

CREATE TABLE IF NOT EXISTS wire_gauge (
  swg           integer PRIMARY KEY,
  dia_mm        numeric NOT NULL,
  area_sqmm     numeric NOT NULL,
  ohm_per_m_20c numeric NOT NULL,
  -- §12.10 - standards reference the hot value; the data does not exist yet
  ohm_per_m_75c numeric,
  gram_per_m    numeric NOT NULL,
  is_available  boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS accuracy_class (
  code               text PRIMARY KEY,
  percent            numeric NOT NULL,
  -- false ⇒ a Meltek in-house figure, not statutory. The UI must show `note` (§5.4)
  per_is             boolean NOT NULL,
  note               text NOT NULL DEFAULT '',
  max_flux_density_t numeric
);

CREATE TABLE IF NOT EXISTS die (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  die_no       text NOT NULL,
  min_od_mm    numeric NOT NULL,
  max_od_mm    numeric NOT NULL,
  max_width_mm numeric NOT NULL,
  quantity     integer NOT NULL DEFAULT 0,
  location     text,
  is_available boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS slit_width (
  width_mm   numeric PRIMARY KEY,
  is_stocked boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS material_rate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type  text NOT NULL CHECK (material_type IN ('steel', 'copper')),
  grade_id       uuid REFERENCES steel_grade(id) ON DELETE CASCADE,
  rate_per_kg    numeric NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date
);

CREATE TABLE IF NOT EXISTS process_setting (
  key          text PRIMARY KEY,
  value        numeric NOT NULL,
  unit         text NOT NULL DEFAULT '',
  label        text NOT NULL DEFAULT '',
  -- drives the "unconfirmed" badge in the admin UI (§12)
  is_confirmed boolean NOT NULL DEFAULT false,
  source_note  text NOT NULL DEFAULT '',
  updated_by   text,
  updated_at   timestamptz
);

/* ═══ Accounts ═══ */

CREATE TABLE IF NOT EXISTS app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  email          text NOT NULL,
  -- scrypt$N$r$p$salt$hash - never a plaintext or reversible value
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('viewer','engineer','approver','admin')),
  is_active      boolean NOT NULL DEFAULT true,
  -- the built-in administrator: cannot be deleted, demoted or disabled
  is_protected   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_idx ON app_user (lower(email));
-- Tolerate an app_user table created before the flag existed.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_session (
  -- SHA-256 of the session token. The token itself is never stored, so a dump of this
  -- table cannot be replayed as a login.
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text,
  ip         text
);
CREATE INDEX IF NOT EXISTS user_session_user_idx    ON user_session (user_id);
CREATE INDEX IF NOT EXISTS user_session_expires_idx ON user_session (expires_at);

/* ═══ Transactional ═══ */

CREATE TABLE IF NOT EXISTS customer (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  gstin         text,
  contact_name  text,
  contact_email text,
  phone         text,
  default_specs jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_name_lower_idx ON customer (lower(name));

CREATE TABLE IF NOT EXISTS design (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_no          text UNIQUE NOT NULL,
  revision           integer NOT NULL DEFAULT 1,
  customer_id        uuid REFERENCES customer(id),
  customer_name      text NOT NULL,
  enquiry_no         text,
  po_no              text,
  prd_no             text,
  quantity           integer,
  required_by        date,
  ct_type            text NOT NULL DEFAULT 'ring' CHECK (ct_type IN ('ring', 'wound-primary')),
  primary_current    numeric NOT NULL,
  secondary_current  numeric NOT NULL,
  burden_va          numeric NOT NULL,
  accuracy_class     text NOT NULL REFERENCES accuracy_class(code),
  finished_id_mm     numeric NOT NULL,
  finished_od_mm     numeric NOT NULL,
  max_width_mm       numeric,
  insulation_type    text,
  -- §3.3 - frozen on approval, so last quarter's costings never silently change
  settings_snapshot  jsonb,
  reference_snapshot jsonb,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','calculated','approved','in_production','superseded','archived')),
  selected_option_id uuid,
  created_by         text NOT NULL DEFAULT 'system',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  approved_by        text,
  approved_at        timestamptz,
  superseded_by      uuid REFERENCES design(id),
  supersedes         uuid REFERENCES design(id)
);
CREATE INDEX IF NOT EXISTS design_status_idx   ON design (status);
CREATE INDEX IF NOT EXISTS design_customer_idx ON design (customer_id);

CREATE TABLE IF NOT EXISTS design_option (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id         uuid NOT NULL REFERENCES design(id) ON DELETE CASCADE,
  grade_code        text NOT NULL,
  swg               integer NOT NULL,
  b_raw_t           numeric,
  b_used_t          numeric,
  was_capped        boolean NOT NULL DEFAULT false,
  core_area_cm2     numeric,
  core_width_mm     numeric,
  ordered_width_mm  numeric,
  wire_length_m     numeric,
  resistance_ohm    numeric,
  v_drop            numeric,
  v_total           numeric,
  core_weight_kg    numeric,
  copper_weight_kg  numeric,
  core_cost         numeric,
  copper_cost       numeric,
  total_cost        numeric,
  die_id            uuid REFERENCES die(id),
  is_feasible       boolean NOT NULL DEFAULT true,
  infeasible_reason text,
  is_selected       boolean NOT NULL DEFAULT false,
  -- §5.9 - everything past spreadsheet cell C93 is a reconstruction
  is_provisional    boolean NOT NULL DEFAULT true,
  rank              integer,
  iterations        jsonb,
  payload           jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS design_option_design_idx ON design_option (design_id);

CREATE TABLE IF NOT EXISTS design_bom (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id   uuid NOT NULL REFERENCES design(id) ON DELETE CASCADE,
  item_type   text NOT NULL CHECK (item_type IN ('core','copper','insulation','resin','other')),
  item_ref    text,
  description text NOT NULL,
  quantity    numeric NOT NULL,
  unit        text NOT NULL
);
CREATE INDEX IF NOT EXISTS design_bom_design_idx ON design_bom (design_id);

/* ═══ Phase 3 - the data that makes calibration possible (§14) ═══ */

CREATE TABLE IF NOT EXISTS manufactured_result (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id                uuid NOT NULL REFERENCES design(id) ON DELETE CASCADE,
  batch_no                 text NOT NULL,
  manufactured_on          date,
  actual_core_grade        text,
  actual_core_width_mm     numeric,
  actual_core_weight_kg    numeric,
  actual_copper_weight_kg  numeric,
  measured_ratio_error_pct numeric,
  measured_phase_error_min numeric,
  measured_resistance_ohm  numeric,
  test_lab                 text,
  passed                   boolean NOT NULL,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufactured_result_design_idx ON manufactured_result (design_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity    text NOT NULL,
  entity_id text NOT NULL,
  action    text NOT NULL,
  actor     text NOT NULL,
  before    jsonb,
  after     jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_id);

ALTER TABLE design ADD COLUMN IF NOT EXISTS engineering_spec jsonb;
INSERT INTO accuracy_class (code, percent, per_is, note) VALUES
 ('5P',5,false,'Engineering protection workflow only'), ('10P',10,false,'Engineering protection workflow only'),
 ('PS',0,false,'Client-defined special protection specification'), ('PX',0,false,'Special protection specification; confirm applicable standard')
ON CONFLICT (code) DO NOTHING;
