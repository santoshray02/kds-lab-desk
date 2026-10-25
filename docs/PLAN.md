# KDS Lab Desk — build plan

Offline-first reporting software for K.D.S. Pathology: one Windows PC, one non-technical owner.
The approved design is `docs/design.html`; the brief is `CLAUDE.md`. This file lists how the build was ordered.
What was actually delivered, and how it was checked, is in `docs/STATUS.md`. Every judgement call is in `docs/DECISIONS.md`.

## Architecture in one picture

```
 React screens (renderer)  ──IPC──►  main process (Electron, Node 24)
   src/renderer                         src/main
   - English / Hindi labels             - SQLite (node:sqlite) in %APPDATA%/KDS Lab Desk/kds.db
   - instant checks while typing        - services: patients, visits, results, approve/correct, owner reports
        ▲                               - report HTML → PDF (printToPDF) / print / WhatsApp helper
        │ same pure code                - backups, import of old reports, cloud sync (outbox)
   src/shared  (calculations, ranges, flags, checks, report template, test master)
```

* `src/shared` has no Electron or Node dependency, so the checks that run on screen are the same code the
  server runs again when a report is approved, and Vitest tests them directly.
* `src/main/*` services take a database handle, so tests run them on an in-memory SQLite.
* The cloud side lives in `cloud/` (SQL, Edge Function, static report page, local mock server for tests).

## Milestones (each one built, tested and committed)

| # | Milestone | Main files |
|---|-----------|-----------|
| 1 | Skeleton, database with migrations, test master (panels, parameters, versioned ranges) | `src/main/db.ts`, `master.ts`, `src/shared/masterData.ts` |
| 2 | Register patient, result entry, calculations and checks | `patients.ts`, `visits.ts`, `results.ts`, `src/shared/{calc,ranges,checks,age}.ts`, `screens/NewPatient.tsx`, `Visit.tsx` |
| 3 | Approve and lock, corrections as new versions, report template, PDF and print | `results.ts`, `src/shared/reportHtml.ts`, `reportsvc.ts`, `electronBits.ts` |
| 4 | Search, patient history, owner reports | `owner.ts`, `screens/Patients.tsx`, `Owner.tsx`, `Today.tsx` |
| 5 | WhatsApp (levels A and B), backups and restore | `whatsapp.ts`, `backup.ts`, `screens/Backup.tsx` |
| 6 | Import of the old Word/PDF reports, in TypeScript | `src/main/importer/*` |
| 7 | Cloud sync, SQL, report page with PIN | `sync.ts`, `cloud/*` |
| 8 | Installer and documentation | `electron-builder.yml`, `docs/*` |

## Quality gates

* `npm test` — Vitest: calculations, range selection, flags, DLC, duplicate detection, sample IDs, import parsers,
  sync with a mock server, backups, Hindi label coverage.
* `npm run e2e` — Playwright driving the real Electron app: register → enter → approve → PDF, duplicate guard,
  corrections, family phone numbers, search, owner reports, PIN/settings, range versioning, import and backup.
* `npm run build` and `npm run dist` — produces `release/KDS-Lab-Desk-Setup.exe`.
