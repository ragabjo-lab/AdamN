'use strict';

/**
 * Forward-only migrations. `PRAGMA user_version` stores the applied version.
 * Rule: never edit an applied migration – append a new one.
 */
const migrations = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          full_name     TEXT NOT NULL,
          role          TEXT NOT NULL DEFAULT 'viewer',
          is_active     INTEGER NOT NULL DEFAULT 1,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          last_login_at TEXT,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash   TEXT NOT NULL UNIQUE,
          created_at   TEXT NOT NULL,
          expires_at   TEXT NOT NULL,
          last_seen_at TEXT,
          user_agent   TEXT,
          ip           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

        CREATE TABLE IF NOT EXISTS attachments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_type TEXT NOT NULL,
          owner_id   INTEGER,
          kind       TEXT NOT NULL DEFAULT 'document',
          file_name  TEXT NOT NULL,
          mime       TEXT NOT NULL,
          size       INTEGER NOT NULL,
          sha256     TEXT,
          data       BLOB NOT NULL,
          created_at TEXT NOT NULL,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id, kind);

        CREATE TABLE IF NOT EXISTS students (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          code          TEXT UNIQUE,
          full_name     TEXT NOT NULL,
          birth_date    TEXT NOT NULL,
          enroll_date   TEXT NOT NULL,
          guardian_name TEXT,
          guardian_phone TEXT,
          address       TEXT,
          notes         TEXT,
          monthly_fee   REAL NOT NULL DEFAULT 0,
          photo_id      INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
          status        TEXT NOT NULL DEFAULT 'active',
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL,
          created_by    INTEGER,
          updated_by    INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_students_name ON students(full_name);
        CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
        CREATE INDEX IF NOT EXISTS idx_students_phone ON students(guardian_phone);

        CREATE TABLE IF NOT EXISTS student_payments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          period     TEXT NOT NULL,
          amount     REAL NOT NULL DEFAULT 0,
          paid_at    TEXT,
          method     TEXT,
          notes      TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by INTEGER,
          UNIQUE (student_id, period)
        );
        CREATE INDEX IF NOT EXISTS idx_payments_period ON student_payments(period);

        CREATE TABLE IF NOT EXISTS staff (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          code        TEXT UNIQUE,
          full_name   TEXT NOT NULL,
          phone       TEXT,
          role        TEXT,
          hire_date   TEXT NOT NULL,
          base_salary REAL NOT NULL DEFAULT 0,
          email       TEXT,
          address     TEXT,
          notes       TEXT,
          is_active   INTEGER NOT NULL DEFAULT 1,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS staff_salary_rates (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id       INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
          effective_from TEXT NOT NULL,
          basic          REAL NOT NULL,
          note           TEXT,
          created_at     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rates_staff ON staff_salary_rates(staff_id, effective_from);

        CREATE TABLE IF NOT EXISTS staff_salaries (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
          period     TEXT NOT NULL,
          basic      REAL NOT NULL DEFAULT 0,
          bonuses    REAL NOT NULL DEFAULT 0,
          rewards    REAL NOT NULL DEFAULT 0,
          deductions REAL NOT NULL DEFAULT 0,
          net        REAL NOT NULL DEFAULT 0,
          status     TEXT NOT NULL DEFAULT 'pending',
          paid_at    TEXT,
          notes      TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (staff_id, period)
        );
        CREATE INDEX IF NOT EXISTS idx_salaries_period ON staff_salaries(period);

        CREATE TABLE IF NOT EXISTS revenues (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          date        TEXT NOT NULL,
          description TEXT NOT NULL,
          amount      REAL NOT NULL DEFAULT 0,
          category    TEXT NOT NULL DEFAULT 'other',
          notes       TEXT,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL,
          created_by  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_revenues_date ON revenues(date);

        CREATE TABLE IF NOT EXISTS expenses (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          date        TEXT NOT NULL,
          description TEXT NOT NULL,
          amount      REAL NOT NULL DEFAULT 0,
          category    TEXT NOT NULL DEFAULT 'other',
          notes       TEXT,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL,
          created_by  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

        CREATE TABLE IF NOT EXISTS notifications (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          dedupe_key  TEXT NOT NULL UNIQUE,
          type        TEXT NOT NULL,
          severity    TEXT NOT NULL DEFAULT 'info',
          title_ar    TEXT NOT NULL,
          title_en    TEXT NOT NULL,
          body_ar     TEXT,
          body_en     TEXT,
          link        TEXT,
          entity_type TEXT,
          entity_id   INTEGER,
          is_read     INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL,
          expires_on  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read, created_at);

        CREATE TABLE IF NOT EXISTS audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER,
          username   TEXT,
          action     TEXT NOT NULL,
          entity     TEXT,
          entity_id  INTEGER,
          details    TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

        CREATE TABLE IF NOT EXISTS job_runs (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          job        TEXT NOT NULL,
          run_on     TEXT NOT NULL,
          status     TEXT NOT NULL,
          message    TEXT,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
];

module.exports = { migrations, LATEST_VERSION: migrations[migrations.length - 1].version };
