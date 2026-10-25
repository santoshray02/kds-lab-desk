export interface Settings {
  language: 'en' | 'hi'
  lab: {
    name: string
    tagline: string
    address: string
    doctorName: string
    doctorQual: string
    techName: string
    techQual: string
    footer: string
  }
  paper: 'A4' | 'Letter'
  /** pre-printed letterhead mode: leave top/bottom blank */
  letterhead: boolean
  letterheadTopMm: number
  letterheadBottomMm: number
  phoneRequired: boolean
  waMessageEn: string
  waMessageHi: string
  /** where "Send on WhatsApp" opens the chat */
  waTarget: 'web' | 'app'
  analyzer: 'manual' | string
  silentPrint: boolean
  printerName: string
  masterReviewed: boolean
  masterReviewedAt: string
  pricesReviewed: boolean
  rolesEnabled: boolean
  /** 'single' = one shared account; with roles, only the doctor can approve */
  backupDir: string
  lastPenDriveBackup: string
  lastNightlyBackup: string
  penDriveReminderDays: number
  cloud: {
    enabled: boolean
    url: string
    key: string
    /** public base URL of the report page, e.g. https://kds-lab.example/r */
    reportBase: string
  }
  updates: { enabled: boolean; url: string }
  demoMode: boolean
  consentLine: string
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  lab: {
    name: 'K.D.S. PATHOLOGY',
    tagline: 'Computerised Janch Ghar',
    address: 'Sardarganj, Vidyapati Road, Dalsingsarai (Samastipur) PIN-848114',
    doctorName: 'Dr. Manoj Kumar',
    doctorQual: 'MBBS',
    techName: 'Ram Vivek Kumar',
    techQual: 'DMLT',
    footer: 'Not valid for medico legal purpose. Use only for treatment.'
  },
  paper: 'A4',
  letterhead: false,
  letterheadTopMm: 45,
  letterheadBottomMm: 25,
  phoneRequired: false,
  waMessageEn: 'Namaste {name}, your K.D.S. Pathology report ({sample}) is ready.',
  waMessageHi: 'नमस्ते {name} जी, आपकी K.D.S. Pathology की रिपोर्ट ({sample}) तैयार है।',
  waTarget: 'web',
  analyzer: 'manual',
  silentPrint: false,
  printerName: '',
  masterReviewed: false,
  masterReviewedAt: '',
  pricesReviewed: false,
  rolesEnabled: false,
  backupDir: '',
  lastPenDriveBackup: '',
  lastNightlyBackup: '',
  penDriveReminderDays: 7,
  cloud: { enabled: false, url: '', key: '', reportBase: '' },
  updates: { enabled: true, url: 'https://github.com/santoshray02/kds-lab-desk-releases/releases/latest/download' },
  demoMode: false,
  consentLine: 'Patient consents to the storage of this report for treatment and record purposes.'
}
