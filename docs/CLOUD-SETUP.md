# Cloud setup (for the family helper)

Cloud sync is **optional** and **off** until you finish this page. The lab works fully without it.
With it on:

* every approved report is copied (with its PDF) to a private online store within a minute of the internet being available;
* the printed QR code opens a **"genuine report"** page;
* the WhatsApp message carries a **link + 4-digit PIN** so no attachment is needed.

Time needed: about 45 minutes. Cost: the free tier is enough to start; expect a few hundred rupees a month at this lab's volume if it grows.
You need: a Google/GitHub/e-mail account for the cloud sign-up, and Node.js on **your** laptop (not necessarily the lab PC).

> **Privacy:** this stores patient names, phone numbers and reports online. Put a consent line on the bill (text is in Settings → `consentLine`)
> and use the Mumbai region so data stays in India (DPDP Act). Never share the **service key** below; whoever has it can read everything.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> → **Start your project** → sign in.
2. **New project**. Name: `kds-lab`. Choose a strong **database password** and save it in a password manager.
   **Region: South Asia (Mumbai)**. Plan: Free. Create.
3. Wait until the project says it is ready.

## 2. Create the tables

1. Left menu → **SQL Editor** → **New query**.
2. Open the file `cloud/supabase/migrations/0001_init.sql` from this project, copy everything, paste, press **Run**.
   You should see "Success. No rows returned".
3. Left menu → **Storage**: a bucket called **reports** now exists and is **private** (no "public" tag). Do not make it public.

## 3. Copy the two values for the lab PC

Left menu → **Project Settings → API**:

* **Project URL** — like `https://abcdefgh.supabase.co`
* **service_role key** (click *Reveal*) — a very long secret key. **Not** the `anon` key.

## 4. Publish the PIN check (Edge Function)

On your laptop, in the project folder:

```powershell
cd C:\path\to\kds-lab-desk\cloud
npx supabase login                          # opens the browser once
npx supabase link --project-ref abcdefgh    # the part before .supabase.co; asks for the database password
npx supabase functions deploy get-report --no-verify-jwt
```

(`--no-verify-jwt` is needed because patients open the page without an account; the function itself checks the PIN, limits wrong tries to 5 per 15 minutes, and only ever returns a 10-minute PDF link.
The folder `cloud` already contains the `supabase` project layout, so no `supabase init` is needed.)

Test it (replace the values):

```powershell
curl -X POST https://abcdefgh.supabase.co/functions/v1/get-report `
  -H "Content-Type: application/json" -H "apikey: <anon key>" `
  -d '{"code":"NOSUCH"}'
# → {"found":false}
```

## 5. Publish the report page

The page is the single file `cloud/report-page/index.html`.

1. Open it in a text editor. Near the bottom set:
   * `SUPABASE_URL` → your Project URL
   * `SUPABASE_ANON_KEY` → the **anon public** key (Project Settings → API). This one is meant to be public.
2. Put the folder `cloud/report-page` online with any free static host. Easiest:
   * **Netlify**: <https://app.netlify.com/drop> → drag the `report-page` folder in. (`_redirects` makes `/r/ABC123` work.)
   * or **Cloudflare Pages / Vercel** (a `vercel.json` is included).
3. You get an address like `https://kds-reports.netlify.app`. Optionally attach your own short domain (about ₹1,000 a year).
4. Open `https://kds-reports.netlify.app/r/TEST12` — it should say "report was not found" (not an error page).

## 6. Switch it on in the lab program

On the lab PC: **Settings** (PIN) → **Cloud sync**:

1. **Project URL** — paste.
2. **Service key** — paste the `service_role` key.
3. **Report page address** — `https://kds-reports.netlify.app` (no trailing slash).
4. Tick **Turn cloud sync on** → **Save**.
5. Press **Test connection**. It must say *Connection works.*
6. Press **Sync now**. The status shows *Waiting to upload* going down to 0 and a time for *Last successful sync*.

Everything already in the program (since the day it was installed) is queued and uploads by itself; use **Send everything again** if you ever need to re-send all of it.

## 7. Check the whole chain once

1. Register a test patient with **your own phone number**, enter a value, approve.
2. Wait a minute, press **Sync now**. In Supabase → **Table Editor → reports** the row appears; **Storage → reports** has `CODE/v1.pdf`.
3. Press **Send on WhatsApp**. The message now shows the link and the PIN (last 4 digits of the phone).
4. Open the link on a phone, type the PIN: the PDF opens. Type a wrong PIN five times: it locks for 15 minutes.
5. Scan the QR code on the printed report: the page says *Genuine report*.
6. Correct the report in the program: the old link now says it was *replaced by a corrected version* until the new PDF is synced, and then shows the new one.

## What if the internet is down?

Nothing stops. Reports are saved, printed and sent on WhatsApp (as an attached PDF) as usual. Changes wait in a queue and upload with growing waits between tries (30 s, 1 min, 2 min … up to 1 hour).
Settings → Cloud sync shows how many are waiting and the last error.

## Good to know

* The lab PC is the **only writer**. The cloud copy is never edited by hand and the PC never reads it back.
* **The cloud is not yet a way to rebuild a lost PC.** Keep the pen-drive backups (see the User Guide). A restore-from-cloud tool is on the "later" list.
* To change the **service key** (for example if a laptop with it was lost): Supabase → Project Settings → API → *Roll* the key, paste the new one in the program.
* To stop sync: untick **Turn cloud sync on**. Nothing is deleted online.
* **Costs:** the free plan includes a 500 MB database and 1 GB file storage. A PDF is about 50–100 KB; ten thousand reports are about 1 GB. Check **Settings → Usage** in Supabase every few months.
