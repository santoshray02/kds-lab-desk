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
    phone: string
    email: string
    timings: string
    /** registration / licence line, only printed when filled in */
    regNo: string
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
  waTarget: 'web' | 'app' | 'evolution'
  /** send the PDF on WhatsApp by itself when a report is approved (needs the automatic gateway) */
  waAutoSend: boolean
  /** WhatsApp is linked inside this program (Settings → Link WhatsApp) */
  waBuiltin: boolean
  /** small graphs of the patient's earlier results on the printed report */
  reportTrends: boolean
  /** how out-of-range results look on the printed report: standard = red values, pink rows and a summary box; gentle = bold with H/L, red only for critical; plain = bold with H/L, no colour */
  abnormalStyle: 'standard' | 'gentle' | 'plain'
  /** the bill / receipt printed for the patient */
  receipt: {
    /** 'a4' prints the receipt on the top of a normal sheet; 'thermal' fits a narrow roll printer */
    style: 'a4' | 'thermal'
    thermalWidthMm: number
    footer: string
    /** blank = the printer chosen under Paper and printing */
    printerName: string
    /** print the receipt by itself when a new patient is saved */
    autoPrint: boolean
  }
  /** sticker labels for sample tubes */
  labels: {
    enabled: boolean
    widthMm: number
    heightMm: number
    /** stickers per visit (one per tube) */
    copies: number
    code: 'barcode' | 'qr'
    showAge: boolean
    showTests: boolean
    /** blank = the printer chosen under Paper and printing */
    printerName: string
    autoPrint: boolean
  }
  /** a UPI QR so patients can pay by scanning (the lab's own UPI ID; nothing is sent anywhere) */
  payQr: {
    enabled: boolean
    upiId: string
    /** name shown in the payer's UPI app; blank = the lab name */
    payeeName: string
    /** QR on the printed receipt: only when something is due, always, or never */
    onReceipt: 'whenDue' | 'always' | 'never'
    /** put the amount due into the QR (otherwise the payer types it) */
    withAmount: boolean
  }
  /** owner's money tools */
  money: {
    /** referral commission for doctors */
    commission: boolean
    /** commission on the bill amount, or only on money actually received */
    commissionBasis: 'billed' | 'collected'
    /** expenses and daily cash closing */
    expenses: boolean
    expenseCategories: string[]
  }
  /** one-click health packages on the registration screen */
  packages: boolean
  /** print the height, weight, blood pressure etc. on the report when they were taken */
  reportVitals: boolean
  /** Evolution API (self-hosted WhatsApp gateway): sends the PDF by itself */
  evolution: { url: string; instance: string; apiKey: string }
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
  /** nightly password-locked copy in the owner's own Google Drive (the sign-in token and password are not kept here) */
  driveBackup: { connected: boolean; account: string; lastBackup: string; lastError: string }
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
    footer: 'Not valid for medico legal purpose. Use only for treatment.',
    phone: '',
    email: '',
    timings: 'Open daily 7:00 am – 8:00 pm',
    regNo: ''
  },
  paper: 'A4',
  letterhead: false,
  letterheadTopMm: 45,
  letterheadBottomMm: 25,
  phoneRequired: false,
  waMessageEn: 'Namaste {name}, your K.D.S. Pathology report ({sample}) is ready.',
  waMessageHi: 'नमस्ते {name} जी, आपकी K.D.S. Pathology की रिपोर्ट ({sample}) तैयार है।',
  waTarget: 'web',
  waAutoSend: false,
  waBuiltin: false,
  reportTrends: true,
  abnormalStyle: 'gentle',
  receipt: { style: 'a4', thermalWidthMm: 80, footer: 'Thank you. Get well soon.', printerName: '', autoPrint: false },
  labels: { enabled: true, widthMm: 50, heightMm: 25, copies: 2, code: 'barcode', showAge: true, showTests: false, printerName: '', autoPrint: false },
  payQr: { enabled: false, upiId: '', payeeName: '', onReceipt: 'whenDue', withAmount: true },
  money: { commission: true, commissionBasis: 'billed', expenses: true, expenseCategories: ['Reagents & kits', 'Salary', 'Rent', 'Electricity', 'Transport', 'Other'] },
  packages: true,
  reportVitals: false,
  evolution: { url: '', instance: '', apiKey: '' },
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
  driveBackup: { connected: false, account: '', lastBackup: '', lastError: '' },
  updates: { enabled: true, url: 'https://github.com/santoshray02/kds-lab-desk/releases/latest/download' },
  demoMode: false,
  consentLine: 'Patient consents to the storage of this report for treatment and record purposes.'
}
