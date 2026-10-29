# AdamN — Architecture Notes

## Request lifecycle
```
Browser → Express (app.js)
  ├─ security headers
  ├─ body parsers (json / raw for uploads)
  ├─ cookieParser → req.user (session lookup, rolling expiry)
  ├─ CSRF guard (x-adamn-client header on mutations)
  ├─ route (auth.requirePerm) → service (business rules) → store (SQLite)
  └─ error handler → JSON { error, message }
```

## Layering rules
* **routes/** only handle HTTP: parse ids, call services, log audit, shape responses.
* **services/** own business rules and SQL. They never touch `req`/`res`.
* **db/connection.js** is the only place that talks to the driver, so the whole app can switch data files at runtime (`relinkDataFile`) without restarting.
* **lib/time.js** is the single source of truth for every civil-date computation.

## Data model (v1)
| Table | Purpose |
|---|---|
| `meta` | file identity (`file_uuid`), signature, schema version, daily-run marker |
| `settings` | key/value business settings (timezone, currency, categories…) |
| `users`, `sessions` | authentication & server-side sessions |
| `students`, `student_payments` | students + one row per month subscription |
| `staff`, `staff_salary_rates`, `staff_salaries` | employees, effective-dated base salary, monthly snapshots |
| `revenues`, `expenses` | other income and expenses (date-based) |
| `attachments` | photos & documents as BLOBs (single-file portability) |
| `notifications` | generated alerts with dedupe keys and read state |
| `audit_log`, `job_runs` | traceability |

## Why monthly rows instead of a "paid" flag
A subscription is recorded per `(student_id, period)` row with an amount. Therefore:
* the current month is unpaid unless a row with `amount > 0` exists → **automatic reset every month**, no cron required;
* past months keep their own amounts forever (historical accuracy);
* the students table renders the whole year with one query (`SELECT ... WHERE period LIKE 'YYYY-%'`).

## Why effective-dated salary rates
`staff_salary_rates(staff_id, effective_from, basic)` is append-only. Any payroll month derives the basic salary in force at the end of that month, so raising a salary in July cannot rewrite January's report. Once a month is saved it becomes an immutable snapshot in `staff_salaries`.

## Data-file (HDANA) lifecycle
1. `connectDataFile()` opens `app-config.json → dataFile`.
2. Missing? → scan discovery roots, compare `meta.file_uuid`, prefer non-backup files, attach automatically.
3. Still missing? → create a fresh `storage/data/HDANA.db`.
4. Backups are copies of the file; they keep the same UUID, so they are explicitly excluded from auto-attach and only used via an explicit restore.

## Timezone model
* Civil dates: `TEXT 'YYYY-MM-DD'` (never converted).
* Instants: `ISO-8601 UTC` strings (only converted for display).
* "Today": computed with `Intl.DateTimeFormat` in `settings.timezone`.
* The daily job stores `last_daily_run` as a civil date in that timezone, so it runs once per local calendar day.

## Frontend
* No build step: `public/js/**` are ES modules served directly.
* `app.js` = shell + router (`#/students`, `#/staff`, …) + notification polling.
* Views return `{ destroy }`; module-level state is reset on each mount.
* `ui.js` provides DOM helpers, toasts, modals, formatting and validation; `i18n.js` holds the AR/EN dictionary and direction switching.
