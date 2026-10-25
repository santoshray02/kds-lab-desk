# KDS Lab Desk

Offline-first reporting software for **K.D.S. Pathology** (Computerised Janch Ghar, Dalsingsarai).
One Windows PC, one owner. Register a patient → type the numbers → approve → print or send on WhatsApp.

| Read | For |
|------|-----|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | the lab staff (English, Hindi summary at the end) |
| [docs/CLOUD-SETUP.md](docs/CLOUD-SETUP.md) | the family helper setting up optional cloud sync |
| [docs/STATUS.md](docs/STATUS.md) | what is done, how it was verified, known gaps |
| [docs/DECISIONS.md](docs/DECISIONS.md) | every judgement call (ranges, checks, formats, security) |
| [docs/PLAN.md](docs/PLAN.md) · [docs/design.html](docs/design.html) | architecture, milestones, approved design |

## Install (for the lab)

Run `release/KDS-Lab-Desk-Setup.exe`. Per-user install, no administrator needed.

## Develop

Needs Node 24+ and npm (Windows 11). No Rust, no compiler: the database is Node's built-in SQLite.

```powershell
npm install
npm run dev          # app with hot reload
npm test             # unit + integration tests (Vitest)
npm run e2e          # builds, then drives the real Electron app (Playwright)
npm run build        # out/
npm run dist         # release/KDS-Lab-Desk-Setup.exe
```

Useful environment variables: `KDS_DATA_DIR` (use another data folder), `KDS_DEMO=1` (seed invented demo patients on first start).
`--reset-pin` on the command line removes a forgotten PIN.

## Layout

```
src/shared     pure logic used by screens, main process and tests (ranges, flags, checks, report template, test master)
src/main       Electron main process: SQLite services, approve/lock, PDF, backups, import, cloud sync
src/renderer   React screens (English / Hindi)
cloud/         Supabase SQL, report-page Edge Function, static report page, local mock server
tests/ e2e/    Vitest and Playwright tests (invented data only)
tools/import   the original Python extractors (reference; the app uses the TypeScript port in src/main/importer)
```

**No real patient data is kept in this repository.** `docs/reference/` and all data folders are git-ignored.
