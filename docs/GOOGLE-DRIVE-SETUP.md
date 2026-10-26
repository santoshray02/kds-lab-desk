# Google Drive backup: one-time setup (for the developer, not for labs)

Labs never see any of this. You do it once, paste two values into the code, and release a new version.
Until then the Backup screen says "Google Drive backup is not set up in this version yet".

## What the feature does
* The lab owner presses **Connect Google Drive**, signs in with Google in the browser, and chooses a backup password.
* Every night (when the PC is on and online) the program makes a normal backup, locks it with the password (AES-256-GCM, key from scrypt), uploads that one file, and keeps the newest 30.
* The only permission asked is **drive.appdata**: a hidden folder that belongs to this program inside the owner's Drive. It cannot see or change any other file. The sign-in also asks for the **e-mail address**, only to show "Connected as …".
* Google and you can only ever see locked bytes. You do not receive anything: no list of labs, no e-mail addresses, no files.
* The refresh token and the backup password are stored in `drive-secret.bin` beside the database, encrypted by Windows for that user. They are not in the database, so backups never carry them.

## Steps (about 15 minutes, free)
1. Open https://console.cloud.google.com and sign in with the Google account you want to own the project (use your business account for santoshray.in).
2. **New project**, named "KDS Lab Desk".
3. **APIs & Services → Library**, search "Google Drive API", **Enable**.
4. **APIs & Services → OAuth consent screen** (now called *Google Auth Platform*):
   * App name: KDS Lab Desk. User support e-mail and developer contact: your e-mail.
   * Audience: **External**.
   * Branding: homepage `https://santoshray.in`, and a privacy-policy page (see below).
   * Data access / Scopes: add `.../auth/drive.appdata` and `.../auth/userinfo.email` (with `openid`). Nothing else.
5. **Publish the app** (Audience → *Publish app* → *In production*). **This matters:** in "Testing" mode Google expires every sign-in after 7 days and the nightly backup would silently stop.
   With only these low-risk scopes Google should not ask for a security review. If it shows "Needs verification", follow its prompts (a homepage and a privacy page are what it checks).
6. **Clients → Create client**, type **Desktop app**, name "KDS Lab Desk Windows". Copy the **Client ID** and **Client secret**.
   (For installed desktop apps Google says the secret is not confidential, so it may sit in open-source code.)
7. Put the Client ID in `src/shared/googleConfig.ts` (it is public) and the secret in `src/shared/google.local.json` (copy `google.local.example.json`; this file is git-ignored so GitHub's secret scanner stays quiet, and is bundled into the installer when you build). Run the tests, build, and release. The privacy and terms pages for the consent screen are `https://santoshray.in/privacy` and `https://santoshray.in/terms`.
8. Test with your own Google account: Backup → Connect → press "Back up now" → Restore from Google Drive shows the copy → restore on a second PC.

## Privacy-policy page (needed for step 4)
Put a short page on santoshray.in saying: the program stores nothing about labs on any server run by the developer; backups go to the user's own Google Drive, locked with a password only the lab knows; the only Google permissions are the hidden app folder and the e-mail address, used to show which account is connected; disconnecting in the program removes the sign-in.

## If something goes wrong
* *"Google did not accept the sign-in"*: the client ID or secret is wrong, or the client type is not Desktop app.
* *"Access blocked: app not verified"*: the app is still in Testing mode, or the signed-in account is not a listed test user. Publish it (step 5).
* *Backups stop after a week*: the app is still in Testing mode.
* The owner can also remove access at https://myaccount.google.com/permissions; the program then shows "Google Drive was disconnected from the Google account. Connect it again."
