/**
 * Google sign-in for "Backup to Google Drive". These values identify the program, not the lab.
 * The client ID is public. The client secret of a Desktop app is not confidential by Google's own rules, but it is kept
 * out of git (so secret scanners stay quiet) in src/shared/google.local.json, which is bundled into the installer at build time.
 * Copy google.local.example.json to google.local.json and paste your own secret to build with Drive backup (see docs/GOOGLE-DRIVE-SETUP.md).
 * Without that file the Backup screen says the feature is not set up.
 */
/// <reference types="vite/client" />
const local = import.meta.glob('./google.local.json', { eager: true, import: 'default' }) as Record<string, { clientSecret?: string }>
const secret = Object.values(local)[0]?.clientSecret ?? ''

export const GOOGLE = {
  clientId: '681132519462-8erpo2juo32q016bm08pp1ggsdsaipaj.apps.googleusercontent.com',
  clientSecret: secret.startsWith('paste') ? '' : secret
}
