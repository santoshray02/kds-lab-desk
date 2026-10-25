# Decisions

The brief asked for the build to go ahead without questions. Each choice that was not dictated by the brief is written down here,
with the reason, so the doctor or a helper can change it later.

## Platform and tooling

1. **Electron 45 + Vite + React + TypeScript** (the brief's one deviation from the design: Electron instead of Tauri, because this PC has no Rust or MSVC).
   Built with `electron-vite`. Main process is CommonJS, renderer is a normal Vite bundle.
2. **Database: `node:sqlite`, not `better-sqlite3`.** Electron 45 ships Node 24, which has SQLite built in, so there is **no native module at all**:
   nothing to compile, no Electron/Node ABI mismatch between the app and the tests, and the same API in both. I tested both: `better-sqlite3` also loaded,
   but would need two different binaries (app and Vitest). WAL mode and `synchronous=NORMAL` are on; schema changes go through a numbered migration list in `src/main/db.ts`
   (`schema_migrations` table). The experimental-API warning from `node:sqlite` is harmless.
3. **PDF** is made by loading the report HTML in a hidden window and `printToPDF` (A4 or Letter from Settings). Printing uses `webContents.print`
   (silent only if the setting is on). The PDF text is real text, so it can be searched and re-imported.
4. **Installer:** NSIS one-click, per-user (no admin), desktop and start-menu shortcut, output `release/KDS Lab Desk Setup.exe`. It is **not code-signed** (no certificate);
   Windows SmartScreen will say "unknown publisher" once: *More info → Run anyway*.
5. **No Python on his PC.** The `.doc`/`.docx`/`.pdf` readers from `tools/import/*.py` were ported to TypeScript
   (`cfb` for the Word 97 container, `fflate` for `.docx`, `pdfjs-dist` for PDF). The Python tools stay in the repo only as the reference.

## Report content (printed output)

6. **Structure and wording follow "Layout B"**: header block, patient block, section titles HAEMATOLOGY / BIOCHEMISTRY / SEROLOGY, columns *Tests · Result · Unit · Limitations*,
   signatures *Dr. Manoj Kumar, MBBS* (left) and *Ram Vivek Kumar, DMLT* (right), footer *Not valid for medico legal purpose. Use only for treatment.*
7. **Small spelling fixes in the header text:** "Computrised Janch Ghar" is printed as "Computerised Janch Ghar" (as written in the brief). Editable in Settings.
8. **Extra section titles** for tests that Layout B puts under odd headings: urine is "URINE EXAMINATION" (old files say "Urology"), semen is "CLINICAL PATHOLOGY",
   sputum AFB is "MICROBIOLOGY". Sent-out tests have no printed result block: the report lists them in a small note ("sent to …, report attached separately").
9. **Abnormal values** print in heavy bold with `H` or `L`; normal values are regular weight so abnormal ones stand out on a black-and-white printer. Qualitative abnormal results (e.g. Positive) print bold without a letter.
10. **Layout:** one HTML table with a repeating `thead` (letterhead + patient block) and `tfoot` (signatures, QR, footer), so every page of a multi-page report carries the header and footer.
    Panels of eight rows or fewer are kept together; headings never stay alone at the bottom of a page.
11. **Pre-printed letterhead mode:** the printed lab header is dropped and `@page` top/bottom margins are set from Settings (default 45 mm / 25 mm). The patient block still prints.
12. **QR code** on every report: the verification URL when cloud is configured, otherwise the sample ID.

## Test master defaults

13. Source: the 2025–26 report formats in `docs/reference/current-layout-samples.txt` plus the design mock-up. **Everything is a default to be reviewed by Dr. Manoj Kumar**:
    the UI shows "Defaults — to be reviewed by Dr. Manoj Kumar" on the home screen and in the master until he ticks "Reviewed" (Settings → Test master & prices).
14. **Errors fixed from his files:** MCH 27–32 (his files printed "27 – 321"); SGPT/SGOT/ALP in **U/L** (his: IU/DL); total protein, albumin, globulin in **g/dL** (his: mg/dl);
    MCHC in g/dL (his: %); lipid ratios have **no unit** (his: mg/dl); calcium in mg/dL 8.5–10.5 and not mEq/L; sodium 135–145 (his 130–145); creatinine **men 0.7–1.3, women 0.6–1.1**
    (his file had women's upper limit above men's); uric acid men 3.4–7.0 (his "2.4 – 7.0" looks like a typo of 3.4); total cholesterol 130–200 (his 130–250), triglycerides 40–150.
15. **Sex and age bands:** Hb, RBC, PCV, ESR, creatinine and uric acid have separate ranges for men, women and children (under 12 years). TLC, neutrophils, lymphocytes, MCV, ALP and a few more have an adult and a child band.
    Child = under 12 years (4 380 days). If the sex is unknown the first sex-specific range is used.
16. **Range versions:** editing a parameter's ranges closes the old rows (`valid_to`) and writes a new version. Result rows keep the unit, range text and flag as they were when saved, so approved and imported reports never change.
17. **Widal** uses a titre grid (1:20 … 1:320) with a Nil option, stored as the highest reactive dilution; values of 1:80 or more are flagged.
18. **Prices** are the starter examples from the design (CBC ₹200, Sugar ₹50, LFT ₹400, KFT ₹400, Lipid ₹400, Widal ₹150, MP ₹100, Urine R/E ₹100) and invented ones for the rest. The registration screen says "Prices are example rates" until the owner ticks "Prices are the lab's own".

## Result checks

19. **Auto-calculated:** MCV = PCV/RBC×10, MCH = Hb/RBC×10, MCHC = Hb/PCV×100, globulin, A/G ratio, VLDL = TG/5, LDL (Friedewald, left blank when TG > 400 mg/dL), indirect bilirubin, TC/HDL and LDL/HDL ratios.
    If a value is typed (from an analyzer) instead, it is kept and a warning shows when it is more than **10 %** away from the calculated one.
20. **DLC** must total exactly 100 (five main cells plus band forms); any other total blocks approval, because a review found that allowing 99/101 let wrong reports through. All five cells must be filled once any is typed.
21. **Implausible values are rejected** with fixed per-test limits (e.g. Hb outside 1–25 g/dL, so 105 is refused). They stay in the box (red) so the typist can fix them, but approval is blocked.
22. **Critical values** (Hb < 7, platelets < 0.5 lakh, glucose < 50 or > 400, K < 2.8 or > 6.2, plus TLC, Na, creatinine, calcium limits I added) show a red banner and a `!!` mark; they ask for acknowledgement in the approve dialog but do not block.
23. **Duplicate guard:** for every panel with at least three typed numeric values, a signature of those numbers is stored. If another patient's current report (approved or imported only, never someone's unfinished draft) has the same signature; imported reports are signed with the same rule as live ones, so auto-calculated indices are ignored on both sides, approval is blocked until a reason of at least three characters is typed; the reason is stored with the report.
    The same patient repeating a test is not a duplicate. Auto-calculated values and qualitative results do not count.
24. **Title and sex:** Mr/Master set Male, Mrs/Miss set Female, Baby leaves the choice open. Mismatches, "Master" over 17 and "Mrs" under 14 give a yellow warning that needs a second click on *Save*.
25. **Sample ID** `YYMM-NNN`, counted per month (`2610-047`). Imported old reports get `I` + `YYMM-NNN` so the two never collide.
26. **Phone numbers** are stored as 10 digits (country code and spaces removed). Many patients can share one phone: the phone groups a household and never identifies one patient.
    Ages carried forward from the last visit are advanced by the time since then.

## Approval, corrections and security

27. **Approved = immutable.** Saving to an approved report is refused by the service. A correction (PIN + reason) creates the next version as a draft; the previous version stays the valid one until the new one is approved, then it is marked superseded. Old versions stay viewable and print as "Corrected report (version n)".
28. **PIN:** one owner PIN (4 digits, scrypt-hashed in the local database) protects Settings, range edits, corrections, restore and demo removal. Until a PIN is set, those are open and a banner says so.
    Optional roles: a separate *doctor PIN*; when "only the doctor can approve" is on, approval asks for it.
29. **The PIN checks happen in the main process**, not only on screen. The renderer keeps the PIN in memory only while Settings is open.
30. **Report link PIN:** by default the last 4 digits of the patient's phone (as in the design); with no phone, a random 4 digits. Only a salted, repeatedly hashed value is uploaded; five wrong tries lock the link for 15 minutes.

## WhatsApp

31. **Level A:** the PDF is saved, copied to the Windows clipboard as a file (`CF_HDROP` through a hidden PowerShell with `-STA`; verified by reading the clipboard back in a test), and `whatsapp://send?phone=91XXXXXXXXXX&text=…` is opened; if the app does not handle it, `https://wa.me/…` opens. A toast says *Press Ctrl+V then Enter*. The program cannot know whether WhatsApp Desktop is installed, so the user may need *Open in browser*.
32. **Level B** (cloud configured): the message carries the report link and PIN and no attachment is needed. The message text is a template in Settings (English and Hindi); the patient's name and sample ID are filled in.
33. Level C (automatic business-API sending) is not built; the design lists it as "later".

## Backups

34. A backup is a folder: `kds.db` made with `VACUUM INTO` (a consistent copy even while the app runs), the `attachments` folder, and `backup.json`.
35. **Nightly:** checked every 20 minutes; runs after 21:00, or at once if more than 26 hours have passed (PC was off at night). Stored under `%APPDATA%/KDS Lab Desk/backups`; the newest 30 are kept.
36. **Pen drive:** one click per detected removable drive, or any folder. The home screen reminds weekly (setting).
37. **Restore:** validated first (integrity check), needs the PIN, the current data is moved to `before-restore-<time>` (never deleted), then the app restarts.

## Importing the old reports

38. **Formats handled** (all by one tolerant line-based parser, `src/main/importer/parse.ts`): (a) the current "Name : / Ref .By :" layout with the header split over lines and tabs (Word `.doc`);
    (b) the same layout exported as `.docx`, where header cells are joined; (c) the 2016–24 "Name of The Patient: … Received on:" layout, in `.doc`, `.docx` and `.pdf`, including the "BLOOD GLUCOSE EXAMINATION REPORT" and "SEROLOGICAL TEST REPORT" sub-layouts.
    The brief mentioned a "Layout A" and "Layout B" without defining A; both variants of the Name/Ref.By family are covered by (a) and (b).
39. Labels are mapped to the test master by ordered name rules (`aliases.ts`), so imported values appear as "previous" results and take part in the duplicate guard. Rows that cannot be mapped are still imported with their own label.
40. **Imported = read-only history.** The status is `imported`; the screen shows them but offers no editing or correction. Printed-range flags H/L are *derived* from the range printed on the old file (the old reports never marked anything).
41. **Patients without a phone** are merged by exact name + sex + an age that fits the date gap (±2.5 years); otherwise a new person is created. This is a heuristic and can split one person into two.
42. A title/sex contradiction in an old file (e.g. "MR." with FEMALE) is kept as written and noted on the visit.
43. **Thyrocare:** any file whose text contains "Thyrocare" is logged as *sent-out* and **not** imported. Files that cannot be understood are listed with a reason (never dropped); re-running skips files already imported (by content hash) and does not duplicate the "could not be read" list.
44. The original folder is only ever opened for reading.

## Cloud sync

45. **Single writer.** Every change is written to the `outbox` table in the same transaction as the change. A background loop (every minute, plus a first try 15 s after start) uploads what is due; failures wait 30 s, 1 min, 2 min … up to 1 h.
    The PC never reads from the cloud, so there is nothing to merge.
46. **Backend:** Supabase REST (`on_conflict=id`, merge-duplicates) for `patients`, `visits`, `reports` (results as JSON) and Storage for the PDFs; row-level security is on with no public policy.
    The PC uses the **service_role key**, which is stored in the local database. That key is powerful: treat the PC like the key's safe. Anyone with the key can read all patient data.
47. The public **report page** is a static HTML file plus one Edge Function (`get-report`). The function checks the PIN (with rate limiting) and returns a 10-minute signed PDF link. Scanning the QR first shows only "genuine / replaced by a corrected version".
48. **Not built:** restoring a new PC *from the cloud* (the design mentions it). Use the pen-drive/nightly backups for that. Also not built: the owner's phone dashboard and a doctor login; the table `owner reads …` policies are there so a viewer can be added.
49. Sync is **off** until URL, key and "turn on" are set (Settings → Cloud sync). Tested against a local mock server that can fail on demand.

## Interface

50. **Languages:** screens switch between English and Hindi (labels only); reports always print English. Hindi text is keyed by the English phrase; a test fails if a screen string has no Hindi.
51. **Keyboard:** Enter moves to the next field on the forms; the last field saves. Minimum control height 48 px, base font 17 px, usable at 1366×768.
52. **Auto-update:** `electron-updater` is wired (generic provider) but does nothing until an update address is typed in Settings → Data & updates.
53. **Demo mode:** *Settings → Data → Load demo patients* adds twelve invented visits (marked `demo`, with phone numbers starting 98000…); one click removes only those. `KDS_DEMO=1` seeds them on first start (used for screenshots).
54. `KDS_DATA_DIR` overrides the data folder (used by the tests); normal installs use `%APPDATA%/KDS Lab Desk`.

## Privacy rules followed

* No real patient data in the repository, tests, fixtures or screenshots. The reference file `docs/reference/` and the data folders are in `.gitignore`.
  All test names are invented; test phone numbers are `98000…`.
* The original reports folder was only read. Imports were tried on the real folder only in memory (outside git) to measure the parser; nothing from them was written into the repository.
* Every new report starts with empty result fields; nothing is prefilled from a previous report.
* No other lab's report is generated or imitated; sent-out tests are logged and the received PDF is attached as is.

## Auto-update via GitHub Releases
* Updates come from the **public** repo `santoshray02/kds-lab-desk-releases` (installers only, no code or patient data). The app uses electron-updater's generic provider on `https://github.com/santoshray02/kds-lab-desk-releases/releases/latest/download`, so no token is needed. Updates are on by default and can be changed in Settings → Data & updates.
* The installer is now named `KDS-Lab-Desk-Setup.exe` (hyphens): GitHub turns spaces in asset names into dots, which would break the file name in `latest.yml`. The shortcut is still called "KDS Lab Desk". This changes the name given in CLAUDE.md on purpose.
* Publishing stays manual (no token on the PC): see `docs/RELEASING.md`.

## In-house vs sent-out tests, Overview charts, WhatsApp gateway, memory
* Thyroid (T3/T4/TSH), Vitamin D and B12 are done in the lab by default (with first-draft ranges for the doctor to review). Settings → Test master has a per-test switch "Done in this lab / Sent to another lab" (affects new visits only). Older databases are upgraded automatically at start (`upgradeMaster`), keeping the price.
* Reports → Overview: charts are plain SVG/HTML (no chart library, so no extra RAM). One hue for money, teal for cash, hover tooltips, comparison with the previous period.
* WhatsApp: a web link cannot attach a file. Options: WhatsApp Web (default), Desktop app, or **Evolution API** (self-hosted gateway, sends the PDF by itself; if it fails the app falls back to WhatsApp Web). Evolution's unofficial mode can get a number banned by WhatsApp; use a spare lab number or its official Cloud API mode.
* Memory/CPU: hardware acceleration off, renderer heap capped at 192 MB, PDF windows destroyed after use. Measured: ≈85–135 MB private memory, back to ≈90 MB after 15 PDFs in 2.5 s; idle CPU ≈ 0.

## Own WhatsApp gateway (`gateway/`)
* Built instead of running Evolution API (which needs PostgreSQL/Redis and ~1 GB): a ~300-line Node program on Baileys, session kept in a folder, ≈100 MB RAM. It exposes the same three calls (`sendText`, `sendMedia`, `connectionState`), so the app's "Automatic" option works with it or with Evolution.
* Reliability: reconnect with back-off, one socket at a time, watchdog, auto re-link page after being unlinked from the phone, stray errors logged (5 in 5 min → clean restart), self-health-check, 90 s send timeout, and `run-forever.mjs` (Docker: `restart: unless-stopped`; Windows: `install-autostart.cmd`) restarts it if the process dies.
* Safety: API key on every call but `/health`, PDFs only, 25 MB cap, one message per 3–5 s and 60 per hour, binds to 127.0.0.1 unless told otherwise.
* Verified: HTTP/limit/auth logic by tests (the app's real sender against the real server with a fake WhatsApp); the real Baileys link was started and produced a genuine QR; kill → restart verified. **Not verified: an actual send to a real WhatsApp number** (needs a phone to link).

## Delta checks, trend graphs, auto-send
* **Delta check** (`src/shared/delta.ts`): a warning (never blocking) when a result differs from the same patient's last result (within 90 days, other visits, includes imported history) by more than a per-test limit, e.g. Hb 25 %, K 20 %, Na 5 %, creatinine 50 %. The limits are first-draft values for Dr. Manoj Kumar to review; tests not listed are not checked.
* **Trend graph**: on the printed report, a tiny line (up to 5 earlier results + today) beside numeric results; hidden when nothing changed or there is no history. Switch: Settings → General.
* **Auto-send**: off by default. When on (and the automatic gateway is set up) approval sends the PDF in the background; approval never waits for WhatsApp. Outcome (sent / failed) is in the audit log and shown on the report; a report is never auto-sent twice; failed sends are retried by pressing the green button. Corrected versions say they replace the earlier report.

## WhatsApp linked inside the app (non-technical default)
* The owner asked for software usable by non-technical people. The separate gateway (address, instance, key) is now only an "Advanced (for the computer helper)" option. The default is **Settings → Link WhatsApp**: the app runs the same Baileys code in-process (loaded only when linked), shows the QR, shows the linked number, reconnects by itself and sends the PDF directly. Sends are spaced (3–5 s) and capped (60/h).
* The WhatsApp login (`whatsapp-auth/`) lives in the app data folder and is deliberately **not** in backups or the cloud (it is a credential). After restoring on a new PC, link again.
* Verified: unit tests with a fake WhatsApp; the **packaged** app starts the link and shows a real QR from WhatsApp's servers. Not verified: scanning it with a phone and sending to a real number.

## Free plan and licence codes
* **Free up to 100 approved reports a month** (calendar month, first approvals only: corrections, demo and imported data are never counted). More needs a licence code. K.D.S. Pathology holds an unlimited licence. Contact shown to users: rayskumar02@gmail.com.
* **At the limit only approving NEW reports pauses.** Opening, printing, searching, sending, correcting and backing up stay available: patient data is never held hostage.
* **Licence = one line of text** `KDS1.<details>.<signature>`, Ed25519-signed, checked offline with the public key in `src/main/licensing.ts`. Details: id, licensee, plan (`unlimited` or `monthly` + limit), optional expiry (an expired licence falls back to the free plan), issue date.
* **The private key lives outside the project** (`C:\Users\Santosh\KDS-licence-keys\private.pem`; `*.pem` is git-ignored). It must be backed up and never shared or committed: losing it means new keys and re-issued licences; leaking it means anyone can make licences. Make codes with `node tools/license-tool.mjs issue --licensee "Lab" --plan monthly --limit 500 [--expires 2027-10-31]`.
* **The counter is a deterrent, not a vault.** It is kept in the database and in a signed `usage.dat` file, so deleting only one does not reset it. A determined person who deletes the whole data folder or patches the program can bypass it.
* `LICENSE` file updated with the free-tier terms; it is a plain draft that needs a lawyer's review before other labs use it or money is charged.
