# Status

**KDS Lab Desk 1.0.0 is built, tested and packaged.** The installer is `release/KDS Lab Desk Setup.exe` (≈130 MB, unsigned, per-user, no admin needed).
`release/` is git-ignored; rebuild it with `npm run dist` (about 40 seconds).

## What is done

| # | Feature (from the brief) | State | Where / how it was checked |
|---|---|---|---|
| 1 | Register patient: phone → family list → pick or "+ New person"; title sets sex; age Y/M/D; doctor autocomplete + Self; tick tests; sample ID `YYMM-NNN`; bill/paid/due; search without phone | Done | `NewPatient.tsx`, `visits.ts`, `patients.ts`; unit tests (sample ID, family phone, title/sex, age validation); E2E "family members share a phone number" |
| 2 | Test master: 33 panels (28 with results, 4 sent-out, 1 bundle) / 93 parameters from his formats (CBC, ESR, BT/CT, ABO+Rh, sugar F/PP/R, LFT, KFT, electrolytes, lipid, Widal grid, MP card + slide, dengue, CRP, ASO, RA, HIV, HBsAg, HCV, VDRL, UPT, urine R/E, HbA1c, AFB, semen, sent-out); numeric / pick-list / text / titre grid / duration types; ranges by sex and child/adult; corrected units; "Defaults — to be reviewed by Dr. Manoj Kumar" until ticked; versioned range edits that affect new reports only | Done | `masterData.ts`, `master.ts`, `Settings.tsx`; unit tests (range selection, units, versioning); E2E "range edit applies to new reports only", "test master review" |
| 3 | Result entry: only measured values; auto MCV/MCH/MCHC (+10 % warning when typed), globulin, A/G, VLDL, LDL, indirect bilirubin; DLC = 100; H/L flags; critical banner; duplicate result-set block with reason; title/sex warning; implausible values rejected; previous values beside current | Done | `shared/checks.ts`, `calc.ts`, `ranges.ts`, `results.ts`, `Visit.tsx`; 40+ unit tests; E2E smoke ("Hb 105 refused", flags, auto values) and duplicate-guard test |
| 4 | Approve & lock; corrections as new version with time + reason; old version kept and viewable | Done | `results.ts`; unit tests and E2E (v1/v2 both viewable, v2 prints "Corrected report (version 2)") |
| 5 | One A4 template (Letter option, pre-printed letterhead mode with blank mm, editable header), abnormal bold with H/L, QR on every report, header and footer repeated on every page | Done | `shared/reportHtml.ts`; unit tests of the HTML; real PDFs were rendered and looked at (3-page report with repeated header/footer); E2E checks the PDF header bytes |
| 6 | WhatsApp level A (save PDF, file on the clipboard, `whatsapp://` then `wa.me`, toast) and level B (link + PIN) | Done, see gap 1 | `whatsapp.ts`; test that really puts a file on the Windows clipboard and reads it back; message tests for level A/B |
| 7 | Search & history: name, phone, sample ID, village, date range, doctor, dues; patient page with all visits | Done | `Patients.tsx`; E2E |
| 8 | Owner reports: day register, cash and dues (receive later payments), doctor-wise monthly counts, pending (unreported, sent-out not received) | Done | `owner.ts`, `Owner.tsx`; unit tests and E2E |
| 9 | Backups: nightly (keep 30), one-click pen-drive backup, restore wizard with validation + PIN + safety copy, weekly reminder | Done | `backup.ts`, `Backup.tsx`; unit test (create, validate, prune, restore into a live-style folder); E2E pen-drive backup |
| 10 | Cloud sync, off until configured: outbox, retry/backoff, single writer, Supabase SQL, settings screen, mock-server tests, PIN report page (Edge Function + static page), `CLOUD-SETUP.md` | Code complete; **not run against a real Supabase project** (no account) | `sync.ts`, `cloud/`; 16 tests against a local mock server (outage, 503s, wrong key, corrections, QR/link/WhatsApp level) and pure-logic tests of the Edge Function |
| 11 | Import old reports in TypeScript (`.doc`, `.docx`, `.pdf`); read-only history; unparseable listed; Thyrocare logged as sent-out | Done | `src/main/importer/*`; unit tests with invented text for each format; **real folder dry-run (in memory only):** 1 442 files → 1 398 imported (1 457 visits, 1 120 people, ~19 600 result rows of which 97 % mapped to the master), 13 Thyrocare logged, 31 listed as "could not be read" with a reason (bills, school notes, one corrupt file, a date typed as `12102/024`…) in 7 s |
| 12 | Settings with the design's defaults (plain A4, typed values, optional phone, example prices, one PIN, optional doctor PIN) | Done | `Settings.tsx`; E2E |
| 13 | Auto-update hook (`electron-updater`) | Wired, off until an address is set | `index.ts`, Settings → Data & updates |
| – | English / Hindi screens (reports stay English), keyboard flow, 1366×768 | Done | `i18n.ts` + test that every screen string has Hindi; screenshots at 1366×768 checked by eye |
| – | Demo mode with invented patients | Done | Settings → Data; `KDS_DEMO=1` |
| – | Docs: PLAN, DECISIONS, USER-GUIDE (+ Hindi summary), CLOUD-SETUP, README | Done | `docs/` |

## How it was verified

* `npm test` — **88 tests in 8 files pass** (calculations, ranges, flags, DLC, duplicate detection, sample IDs, workflow on an in-memory database, importer, cloud sync, backups, Hindi coverage, Windows clipboard).
* `npm run e2e` — **6 Playwright tests pass** against the real Electron app (register → enter → approve → PDF; duplicate guard and corrections; families, search and owner reports; PIN, review banner, language; range versioning; import and pen-drive backup).
* `npm run build` and `npm run dist` succeed. The installer was **installed silently, started, used (register → approve → PDF) and uninstalled** on this PC: shortcuts appeared and disappeared, nothing was left behind, and no data was written outside a temporary folder.
* The packaged app (inside the asar archive) was also used to generate a PDF and to re-import that PDF with the PDF reader.
* `npx tsc --noEmit` is clean.
* A search of every tracked file for the real names found in the old reports (full names, 8+ characters) found only the two staff names that belong on the letterhead.

## Known gaps and things not verified

1. **Physical printing and WhatsApp Desktop were not exercised** (no printer or WhatsApp account here). Printing goes through Electron's standard `print()`; if the print window misbehaves on his printer, *Save PDF* and print from the PDF viewer works. The clipboard step is verified; whether `whatsapp://` opens depends on WhatsApp Desktop being installed.
2. **Cloud sync has never talked to a real Supabase project.** The protocol (PostgREST upserts, Storage upload, Edge Function) follows the documented API and is tested against a mock; expect to fix small details during the first real setup (see `CLOUD-SETUP.md`, step 7 "check the whole chain").
3. **Restoring a lost PC from the cloud** (mentioned in the design) is not built; the pen-drive and nightly backups are the way. No owner phone dashboard or doctor login either (read policies exist for a signed-in owner).
4. **WhatsApp level C** (automatic business API) and **analyzer USB link** are the design's "later" items and are not built (the settings screen says so).
5. **Installer is unsigned**: Windows SmartScreen shows a warning once. A code-signing certificate would remove it.
6. **Imported history is best-effort.** About 3 % of files could not be read (listed with the reason). Patients without a phone are matched by name, sex and age, so one person can appear twice. Test labels the parser does not know are stored under their own name without a normal range.
7. **The test master is a first draft for the doctor to review**, including the corrections listed in `DECISIONS.md` (for example creatinine for women, sodium 135–145, uric acid for men). The ranges I changed are a medical judgement; he must confirm them.
8. The Windows font used for the printed report is "Segoe UI" (falls back to Arial). If the lab's old letterhead uses a special font, the layout will differ slightly.
9. Hindi labels were written without a native-speaker proofread.
10. `node:sqlite` still prints an "experimental" warning on the console (not shown to the user); it has been stable in practice, but if Electron later removes it the fallback is `better-sqlite3` or `sql.js` (the `Db` helper in `src/main/db.ts` is the only place that touches it).

## Independent review

A separate read-only review of the approval, backup, import and sync code found nine issues. Fixed: duplicate guard now ignores unfinished drafts and compares imported reports the same way as live ones; DLC 99/101 is now blocked; renaming a patient refreshes PDFs and the cloud copy, and the sex cannot change after a report is issued; restore stages the copy first and rolls back if it fails; attachment path check; PIN needed for bill edits and discarding a correction.
Not fixed (documented): the same report saved as both `.doc` and `.pdf` imports twice (dedupe is by file content); name+sex+age matching can merge two different people without a phone; the 4-digit link PIN is only as strong as the Edge Function's rate limit; owner-PIN guesses in the app are not rate-limited.

## Where to start if something needs changing

| To change… | Edit |
|---|---|
| a normal range, unit or price (permanently, for everyone) | the doctor does it in Settings → Test master & prices; defaults for a fresh install are in `src/shared/masterData.ts` |
| the printed layout | `src/shared/reportHtml.ts` (one template for screen, PDF and print) |
| a check (critical limits, plausibility, DLC tolerance) | limits are per parameter in `masterData.ts`; rules in `src/shared/checks.ts` |
| the old-report parser | `src/main/importer/parse.ts` and `aliases.ts` (add the spelling to the alias list) |
| screen text / Hindi | `src/renderer/screens/*.tsx` and `src/renderer/i18n.ts` |
