# Releasing an update

Installed copies check `https://github.com/santoshray02/kds-lab-desk-releases/releases/latest/download` when they start,
download a newer version in the background and install it when the program is closed.

1. Raise `version` in `package.json` (for example 1.1.0 → 1.2.0). The number must go up or nobody updates.
2. `npm test`, then `npm run dist`.
3. On GitHub open `santoshray02/kds-lab-desk-releases` → Releases → Draft a new release.
   Tag `v1.2.0` (same number), then drag in these three files from `release/`:
   * `KDS-Lab-Desk-Setup.exe`
   * `KDS-Lab-Desk-Setup.exe.blockmap`
   * `latest.yml`
4. Publish the release (not a draft, not a pre-release).

Notes: the repo must stay public and hold installers only. The installer is unsigned, so Windows may warn once.
Copies installed before 1.1.0 have no update address; install 1.1.0 by hand once.
