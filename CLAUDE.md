# KDS Lab Desk

Offline-first reporting software for **K.D.S. Pathology** (Computerised Janch Ghar, Sardarganj, Vidyapati Road, Dalsingsarai, Samastipur, PIN 848114). One Windows PC, one non-technical owner. Replaces copying old MS Word files.

You are building this **autonomously, end to end**. Don't stop to ask questions; make sensible choices, write them down in `docs/DECISIONS.md`, and keep going. Finish with a working Windows installer.

## Read first
- `docs/design.html`: approved plan and screen designs (open it, read every section). Follow it; the only deviation is the desktop shell (Electron instead of Tauri; see below).
- `docs/reference/current-layout-samples.txt` (gitignored: real patient data, never commit or copy into fixtures): text of real current reports (2025–26 "Layout B"). The printed report must keep this structure and wording: header block, patient block, section titles HAEMATOLOGY / BIOCHEMISTRY / SEROLOGY, Tests · Result · Unit · Limitations columns, signatures "Dr. Manoj Kumar, MBBS" (left) and "Ram Vivek Kumar, DMLT" (right), footer "Not valid for medico legal purpose. Use only for treatment."
- `tools/import/doctext.py`, `tools/import/all.py`: working extractors for the old .doc/.docx/.pdf reports (pure Python, no Word needed).

## Hard rules
- The original reports at `C:\Users\Santosh\projects\experiments\DATE WISE PATHOLOGY` are **read-only**. Never write, move or rename anything there.
- Work only inside this folder. Use git; commit after each working milestone with clear messages.
- Never generate, imitate or template another lab's report (e.g. Thyrocare). Outsourced tests are logged as "sent out" and the received original PDF is attached as-is.
- Every new report starts with **empty result fields**. Never prefill results from another patient or a previous report.
- No real patient data in tests, fixtures, screenshots or the repo. Use invented names. Keep imported data in the app's data directory only (outside git); add it to `.gitignore`.

## Environment (checked)
Windows 11, Node 26.5, npm 11, git, Python 3.12, winget. **No Rust, no MSVC build tools**, so no Tauri and avoid native modules that need compiling. 31 GB RAM, plenty of disk.

## Stack
- Electron + Vite + React + TypeScript. Package with electron-builder → NSIS installer (`KDS Lab Desk Setup.exe`), desktop + start-menu shortcut, per-user install, no admin needed.
- Database: SQLite in the user data dir (`%APPDATA%/KDS Lab Desk/kds.db`). Prefer `better-sqlite3` with Electron prebuilt binaries; if no prebuild is available for the Electron version, pin an Electron version that has one, or fall back to `node:sqlite` / sql.js persisted to disk. Record the choice in DECISIONS.md. Use WAL mode and a migration system.
- PDF: render the report HTML in a hidden BrowserWindow and `printToPDF`; printing via `webContents.print` to the default printer (silent option in settings).
- UI must work in English and Hindi (labels only; reports print in English). Big click targets, large readable fonts, keyboard flow (Enter → next field), works at 1366×768.

## Features (all required)
1. **Register patient**: phone (optional) → list every person using that number (family members share phones) → pick or "+ New person on this number". Title (Mr/Mrs/Miss/Master/Baby) auto-sets sex. Age in years/months/days. Referring doctor with autocomplete (+ "Self"). Tick tests/panels. Auto sample ID `YYMM-NNN`. Bill total + paid/due. Search without phone by name/village.
2. **Test master**: panels and parameters built from his current formats: CBC (Hb, TLC, DLC N/L/E/M/B/Band, RBC, PCV, MCV, MCH, MCHC, Platelets), ESR, BT/CT, ABO + Rh, Blood sugar F/PP/R, LFT, KFT (urea, creatinine, uric acid, electrolytes Na/K/Cl), Lipid profile, Widal (slide; O/H/AH/BH titres 1:20–1:320 grid), MP, Dengue NS1/IgG/IgM, CRP, ASO, RA, HIV 1&2, HBsAg, HCV, VDRL, Urine R/E, HbA1c, Sputum AFB, Semen, plus "Sent out" (Thyroid etc.). Parameter types: numeric, qualitative pick-list (Positive/Negative, Reactive/Non-reactive), text, titre grid. Ranges per sex and age band (child/adult). Units correct (g/dL, U/L, etc.). Default ranges: his 2025–26 ranges with known errors fixed (MCH 27–32; SGPT/SGOT U/L; protein/albumin g/dL; ALP U/L). Mark the whole master as **"Defaults — to be reviewed by Dr. Manoj Kumar"** in the UI until he ticks "Reviewed". Range changes are versioned and apply to new reports only.
3. **Result entry**: only measured values typed. Auto-calc MCV/MCH/MCHC (or if analyzer values typed, warn when >10% off the calculated value), globulin, A/G ratio, VLDL, LDL (Friedewald), indirect bilirubin. Checks: DLC must total 100; out-of-range → H/L flag; critical values (e.g. Hb < 7, platelets < 0.5 lakh, glucose < 50 or > 400, K < 2.8 or > 6.2) → red warning; **identical result set to any other patient's report → block approve until confirmed with a reason**; title/sex mismatch warning; implausible values (e.g. Hb 105) rejected.
4. **Approve & lock**: approved reports are immutable; corrections create a new version with timestamp + reason; old version kept and viewable.
5. **Print/PDF**: one A4 template (settings: Letter; pre-printed letterhead mode with blank top/bottom mm; header text editable). Abnormal values bold with H/L. QR code on every report (encodes verification URL when cloud configured; otherwise sample ID). Multi-page with header repeated per page.
6. **WhatsApp**: Level A (offline): save PDF, put the PDF file on the Windows clipboard (CF_HDROP via a small PowerShell helper is fine), open `whatsapp://send?phone=91XXXXXXXXXX&text=...` (fallback `https://wa.me/...`), show a toast "Press Ctrl+V then Enter". Message names the patient. Level B when cloud configured: message carries report link + PIN, no attachment needed.
7. **Search & history**: by name, phone, sample ID, date range, doctor. Patient page shows all visits; result entry shows previous values beside current.
8. **Reports for the owner**: today's register, cash/dues, doctor-wise monthly referral counts, pending (registered not reported; sent-out not received).
9. **Backups**: automatic nightly copy (keep 30), one-click "Backup to pen drive", restore wizard. Weekly pen-drive reminder.
10. **Cloud sync (code complete, off until configured)**: outbox table of changes; background sync with retry/backoff when online; single writer (PC). Backend: Supabase (Postgres + Storage). Provide SQL migrations, a settings screen to paste URL + key, and test sync against a local mock server. Report link page: tiny static/serverless page that asks for PIN and shows the PDF. Write `docs/CLOUD-SETUP.md` with step-by-step setup for the owner's family helper.
11. **Import old reports**: a menu item "Import old Word reports" that runs the Python extractors (bundle a portable approach or port the parsers to TypeScript, preferred, so no Python is needed on his PC) over a chosen folder, parses Layout A, Layout B and the old 2016–23 layout, and imports patients + results as read-only "imported" history. Unparseable files are listed, never silently dropped. Skip files containing "Thyrocare" (log them as sent-out).
12. **Settings** with the defaults from the "Default settings" table in design.html (plain A4, manual entry, optional phone, starter prices marked as examples, single user with 4-digit PIN for Settings/ranges/corrections; optional roles doctor/technician).
13. Auto-update hook (electron-updater configured but disabled until a release URL is set).

## Quality bar
- Unit tests (Vitest) for calculations, range selection, flags, duplicate detection, sample ID, import parsers (use invented sample text in the same formats). E2E smoke test (Playwright for Electron) for register → enter → approve → PDF.
- `npm run build` and `npm run dist` must succeed; produce the installer in `release/`.
- Seed a demo mode with invented patients so it can be shown without real data.
- Write `docs/USER-GUIDE.md` in simple English with a Hindi summary: install, daily use (3 steps), WhatsApp, backup, what to do if the PC breaks.
- Finish with `docs/STATUS.md`: what's done, how it was verified, known gaps.

## Working style
Plan in `docs/PLAN.md` first, then build in milestones: (1) skeleton + DB + test master, (2) register + results + checks, (3) approve + PDF/print, (4) search/history/owner reports, (5) WhatsApp + backups, (6) import, (7) cloud sync, (8) installer + docs. Run tests after each milestone and commit. If something is blocked (e.g. a native module), choose the fallback and continue.
