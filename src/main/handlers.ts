import { app, BrowserWindow, clipboard, dialog, safeStorage, shell } from 'electron'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { Settings } from '../shared/settings'
import type { Sex } from '../shared/types'
import type { AgeInput } from '../shared/types'
import { connectDrive, disconnectDrive, driveStatus, fetchDriveBackup, listDriveBackups, runDriveBackup, type CloudDeps } from './cloudBackup'
import { DriveClient, fileSecretStore } from './gdrive'
import { GOOGLE } from '../shared/googleConfig'
import { createBackup, listBackups, listRemovableDrives, pruneBackups, restoreBackup, validateBackup } from './backup'
import { audit, type Db } from './db'
import { renderLetterheadHtml } from '../shared/reportHtml'
import { renderHomeListHtml } from '../shared/billHtml'
import { htmlToPdf, listPrinters, printHtml, type PaperSize } from './electronBits'
import { labelsHtml, payQrFor, receiptHtml } from './bill'
import { findDuplicates, mergePatients } from './dedupe'
import { exportXlsx, EXPORT_SHEETS, type ExportOptions } from './exporter'
import { addExpense, addPayout, cashDay, closeDay, commissionReport, deleteExpense, deletePayout, doctorRates, listExpenses, listPayouts, setDoctorCommission } from './money'
import { listPackages, removePackage, savePackage } from './packages'
import { editParam, loadMaster, rangeHistory, setPanelActive, setPanelPrice, setPanelSentOut, type ParamEdit } from './master'
import { dayReport, insights, doctorMonthly, duesReport, pendingReport } from './owner'
import type { Vitals } from '../shared/vitals'
import { updatePatient, getPatient, peopleByPhone, searchPeople, suggestDoctors, type PatientInput } from './patients'
import { ensurePdf, reportHtml, reportLink } from './reportsvc'
import {
  AppError, approveReport, discardCorrection, getEntry, listVersions, saveDraft, startCorrection
} from './results'
import { checkPin, getSettings, hasPin, setPin, setSettings } from './settings'
import {
  addPayment, attachSentOutPdf, cancelVisit, createVisit, getVisit, homePending, listVisits, markCollected, markSentOut, refundPayment, removeTest, saveVitals, updateBill,
  type NewVisitInput, type VisitFilter
} from './visits'
import { builtinLink, builtinResume, builtinStatus, builtinUnlink, initBuiltin, sendAutomatically } from './whatsapp'
import { autoSendIfEnabled, autoSendStatus, buildWaPlan, copyFileToClipboard, sendViaEvolution, testEvolution } from './whatsapp'
import { seedDemo, clearDemo } from './demo'
import { runImport, importLog, type ImportProgress } from './importer/run'
import { syncStatus, syncNow, testConnection, enqueueEverything, setPdfProvider } from './sync'

export interface Ctx {
  db: Db
  dataDir: string
  win: () => BrowserWindow | null
  version: string
}

function requirePin(db: Db, pin: string | undefined) {
  if (hasPin(db, 'owner') && !checkPin(db, pin, 'owner')) throw new AppError('PIN', 'Wrong PIN')
}

let driveDeps: CloudDeps | null = null
/** Google Drive client with its secrets file, encrypted by Windows (DPAPI) for the signed-in user. */
export function getDriveDeps(dataDir: string): CloudDeps {
  if (!driveDeps) {
    const enc = (t: string) => {
      if (!safeStorage.isEncryptionAvailable()) throw new AppError('DRIVE', 'Windows cannot protect the saved password on this PC, so Google Drive backup is switched off.')
      return safeStorage.encryptString(t)
    }
    const secrets = fileSecretStore(join(dataDir, 'drive-secret.bin'), enc, (b) => safeStorage.decryptString(b))
    driveDeps = { secrets, drive: new DriveClient({ clientId: GOOGLE.clientId, clientSecret: GOOGLE.clientSecret }, secrets) }
  }
  return driveDeps
}

/** The receipt as a sheet size: a narrow roll that grows with the bill, or the usual page. */
const receiptPaper = (s: Settings): PaperSize => (s.receipt.style === 'thermal' ? { widthMm: s.receipt.thermalWidthMm, heightMm: 'auto' } : s.paper)

export const nightlyDir = (dataDir: string) => join(dataDir, 'backups')

export function runNightlyIfDue(ctx: Ctx, now = new Date()): string | null {
  const s = getSettings(ctx.db)
  const last = s.lastNightlyBackup ? new Date(s.lastNightlyBackup) : null
  const sameDay = last && last.toDateString() === now.toDateString()
  if (sameDay) return null
  // after 9 pm, or if more than a day has passed since the last one (PC was off at night)
  const overdue = !last || now.getTime() - last.getTime() > 26 * 3600 * 1000
  if (now.getHours() < 21 && !overdue) return null
  const dest = s.backupDir && existsSync(s.backupDir) ? s.backupDir : nightlyDir(ctx.dataDir)
  const path = createBackup(ctx.db, ctx.dataDir, dest, now, 'KDS-nightly')
  pruneBackups(dest, 30, 'KDS-nightly')
  setSettings(ctx.db, { lastNightlyBackup: now.toISOString() })
  audit(ctx.db, 'backup.nightly', 'backup', null, path)
  return path
}

export function makeHandlers(ctx: Ctx) {
  const { db } = ctx
  const homeListHtml = () => {
    const rows = homePending(db).map((j) => ({ sampleId: j.sampleId, patient: j.patient, age: j.age, phone: j.phone, address: j.address, time: j.time, collector: j.collector, tests: j.tests, due: j.due }))
    return renderHomeListHtml(getSettings(db).lab, rows, new Date().toLocaleDateString('en-IN', { dateStyle: 'full' }))
  }
  const pdfWriter = (p: string, b: Buffer) => writeFileSync(p, b)
  const pdfOf = (reportId: number) => ensurePdf(db, ctx.dataDir, reportId, htmlToPdf, pdfWriter)
  setPdfProvider(pdfOf)
  initBuiltin(ctx.dataDir)
  setTimeout(() => builtinResume(db), 8000) // reconnect a linked WhatsApp a few seconds after start
  /** Level A: copy the PDF to the clipboard; then open the chat in the browser or in the desktop app. */
  const openChat = async (plan: ReturnType<typeof buildWaPlan>, pdf: string, target: 'web' | 'app' | 'evolution') => {
    let copied = false
    if (plan.level === 'A') {
      try {
        await copyFileToClipboard(pdf)
        copied = true
      } catch {
        copied = false
      }
    }
    let opened: 'app' | 'web' = target === 'app' ? 'app' : 'web'
    if (opened === 'web') {
      await shell.openExternal(plan.webUrl)
    } else {
      try {
        await shell.openExternal(plan.appUrl)
      } catch {
        opened = 'web'
        await shell.openExternal(plan.webUrl)
      }
    }
    audit(db, 'whatsapp.send', 'reports', plan.reportId, `${plan.level}/${opened}`)
    return { level: plan.level, copied, opened: opened as 'app' | 'web' | 'evolution', pdf }
  }

  return {
    app: {
      info: () => ({
        version: ctx.version, dataDir: ctx.dataDir, platform: process.platform,
        reportsCount: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reports')!.n
      }),
      openFolder: (p: string) => shell.openPath(p),
      printers: async () => (ctx.win() ? listPrinters(ctx.win()!) : [])
    },

    settings: {
      get: (): Settings => getSettings(db),
      set: (patch: Partial<Settings>, pin?: string) => {
        // everyday preferences (language, nothing sensitive) need no PIN
        const open = Object.keys(patch).every((k) => k === 'language' || k === 'lastPenDriveBackup')
        if (!open) requirePin(db, pin)
        return setSettings(db, patch)
      },
      pinStatus: () => ({ ownerSet: hasPin(db, 'owner'), doctorSet: hasPin(db, 'doctor') }),
      checkPin: (pin: string) => checkPin(db, pin, 'owner'),
      setPin: (newPin: string, oldPin?: string, role: 'owner' | 'doctor' = 'owner') => {
        if (role === 'owner') requirePin(db, oldPin)
        else if (hasPin(db, 'owner') && !checkPin(db, oldPin, 'owner')) throw new AppError('PIN', 'Wrong PIN')
        setPin(db, newPin, role)
        return true
      }
    },

    master: {
      list: () => loadMaster(db, { includeInactive: true }),
      editParam: (e: ParamEdit, pin?: string) => {
        requirePin(db, pin)
        editParam(db, e)
        return loadMaster(db, { includeInactive: true })
      },
      setPrice: (panelId: number, price: number, pin?: string) => {
        requirePin(db, pin)
        setPanelPrice(db, panelId, Math.max(0, price))
      },
      setActive: (panelId: number, active: boolean, pin?: string) => {
        requirePin(db, pin)
        setPanelActive(db, panelId, active)
      },
      setSentOut: (panelId: number, sentOut: boolean, pin?: string) => {
        requirePin(db, pin)
        setPanelSentOut(db, panelId, sentOut)
      },
      setReviewed: (reviewed: boolean, pin?: string) => {
        requirePin(db, pin)
        return setSettings(db, { masterReviewed: reviewed, masterReviewedAt: reviewed ? new Date().toISOString() : '' })
      },
      setPricesReviewed: (reviewed: boolean, pin?: string) => {
        requirePin(db, pin)
        return setSettings(db, { pricesReviewed: reviewed })
      },
      history: (paramId: number) => rangeHistory(db, paramId)
    },

    patients: {
      byPhone: (phone: string) => peopleByPhone(db, phone),
      search: (q: string) => searchPeople(db, q),
      doctors: (prefix: string) => suggestDoctors(db, prefix),
      get: (id: number) => getPatient(db, id),
      update: (p: PatientInput, pin?: string) => {
        requirePin(db, pin)
        return updatePatient(db, p)
      },
      /** People who may be registered twice. */
      duplicates: () => findDuplicates(db),
      /** Join two records of one person (all visits go to `keepId`). */
      merge: (keepId: number, dropId: number, pin?: string) => {
        requirePin(db, pin)
        return mergePatients(db, keepId, dropId)
      }
    },

    /** Samples to be collected at patients' homes. */
    home: {
      pending: () => homePending(db),
      markCollected: (visitId: number, collected?: boolean, collector?: string) => {
        markCollected(db, visitId, collected ?? true, collector)
        return true
      },
      listHtml: () => homeListHtml(),
      printList: async () => {
        const s = getSettings(db)
        await printHtml(homeListHtml(), { silent: s.silentPrint, printerName: s.printerName, paper: s.paper })
        audit(db, 'home.print_list', 'visits', null)
        return true
      }
    },

    packages: {
      list: () => listPackages(db),
      listAll: () => listPackages(db, { includeInactive: true }),
      save: (p: { id?: number; name: string; price: number; panelCodes: string[]; active?: boolean }, pin?: string) => {
        requirePin(db, pin)
        return savePackage(db, p)
      },
      remove: (id: number, pin?: string) => {
        requirePin(db, pin)
        removePackage(db, id)
        return true
      }
    },

    /** Bill and sample stickers. */
    bill: {
      receiptHtml: (visitId: number) => receiptHtml(db, visitId),
      /** The UPI QR to show the patient (amount = what is due unless another amount is given). */
      payQr: (visitId: number, amount?: number) => payQrFor(db, visitId, amount),
      printReceipt: async (visitId: number) => {
        const s = getSettings(db)
        await printHtml(receiptHtml(db, visitId), { silent: s.silentPrint, printerName: s.receipt.printerName || s.printerName, paper: receiptPaper(s) })
        audit(db, 'receipt.print', 'visits', visitId)
        return true
      },
      openReceiptPdf: async (visitId: number) => {
        const s = getSettings(db)
        const file = join(tmpdir(), `KDS-receipt-${visitId}.pdf`)
        writeFileSync(file, await htmlToPdf(receiptHtml(db, visitId), receiptPaper(s)))
        await shell.openPath(file)
        return file
      },
      labelsHtml: (visitId: number, copies?: number) => labelsHtml(db, visitId, copies),
      printLabels: async (visitId: number, copies?: number) => {
        const s = getSettings(db)
        await printHtml(await labelsHtml(db, visitId, copies), { silent: s.silentPrint, printerName: s.labels.printerName || s.printerName, paper: { widthMm: s.labels.widthMm, heightMm: s.labels.heightMm } })
        audit(db, 'labels.print', 'visits', visitId)
        return true
      }
    },

    /** The owner's money: doctor commission, expenses, daily cash. */
    money: {
      rates: () => doctorRates(db),
      setRate: (doctor: string, pct: number, pin?: string) => {
        requirePin(db, pin)
        setDoctorCommission(db, doctor, pct)
        return true
      },
      commission: (month?: string) => commissionReport(db, month),
      payouts: (month: string) => listPayouts(db, month),
      addPayout: (p: { doctor: string; month: string; amount: number; note?: string }, pin?: string) => {
        requirePin(db, pin)
        return addPayout(db, p)
      },
      deletePayout: (id: number, pin?: string) => {
        requirePin(db, pin)
        deletePayout(db, id)
        return true
      },
      expenses: (from: string, to: string) => listExpenses(db, from, to),
      addExpense: (e: { date?: string; category: string; amount: number; note?: string }) => addExpense(db, e),
      deleteExpense: (id: number, pin?: string) => {
        requirePin(db, pin)
        deleteExpense(db, id)
        return true
      },
      cashDay: (date?: string) => cashDay(db, date),
      closeDay: (date: string, counted: number, note?: string) => closeDay(db, date, counted, note ?? '')
    },

    /** Everything the owner or accountant may want in Excel. */
    export: {
      sheets: () => [...EXPORT_SHEETS],
      xlsx: async (o: ExportOptions, pin?: string) => {
        requirePin(db, pin)
        const buf = exportXlsx(db, o)
        const r = await dialog.showSaveDialog(ctx.win()!, { title: 'Save the Excel file', defaultPath: `KDS-records-${o.from}-to-${o.to}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
        if (r.canceled || !r.filePath) return null
        writeFileSync(r.filePath, buf)
        shell.showItemInFolder(r.filePath)
        audit(db, 'export.xlsx', 'export', null, `${o.from}..${o.to}`)
        return r.filePath
      }
    },

    visits: {
      create: (input: NewVisitInput) => createVisit(db, input),
      list: (f: VisitFilter) => listVisits(db, f),
      get: (id: number) => getVisit(db, id),
      addPayment: (visitId: number, amount: number, note?: string, method?: string) => { addPayment(db, visitId, amount, note, method); return true },
      updateBill: (visitId: number, total: number, discount: number, pin?: string) => { requirePin(db, pin); updateBill(db, visitId, total, discount) },
      cancel: (visitId: number, reason: string, pin?: string) => {
        requirePin(db, pin)
        cancelVisit(db, visitId, reason)
      },
      /** Give money back (needs the owner PIN). `lowerBill` also takes the amount off the bill. */
      refund: (visitId: number, o: { amount: number; method?: string; reason: string; lowerBill?: boolean }, pin?: string) => {
        requirePin(db, pin)
        refundPayment(db, visitId, o)
        return true
      },
      removeTest: (visitTestId: number) => removeTest(db, visitTestId),
      saveVitals: (visitId: number, v: Vitals) => { saveVitals(db, visitId, v); return true },
      markSentOut: (id: number, data: { sentTo?: string; sentAt?: string; receivedAt?: string | null }) => markSentOut(db, id, data),
      attachSentOut: async (visitTestId: number) => {
        const r = await dialog.showOpenDialog(ctx.win()!, { title: 'Choose the report received from the other lab', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] })
        if (r.canceled || !r.filePaths[0]) return null
        return attachSentOutPdf(db, visitTestId, r.filePaths[0], ctx.dataDir)
      },
      openAttachment: (path: string) => {
        // only files this program stored itself
        if (!resolve(path).startsWith(join(resolve(ctx.dataDir), 'attachments') + sep)) throw new AppError('INVALID', 'Not an attachment of this program')
        return shell.openPath(path)
      }
    },

    results: {
      entry: (visitId: number) => getEntry(db, visitId),
      save: (reportId: number, typed: Record<string, string>) => saveDraft(db, reportId, typed),
      approve: async (reportId: number, opts: { pin?: string; dupReason?: string }) => {
        const r = approveReport(db, reportId, opts)
        const pdf = await pdfOf(reportId).catch(() => null) // PDF is made again on demand if this fails
        // sent in the background: approval never waits for WhatsApp, the result shows on the report afterwards
        void autoSendIfEnabled(db, reportId, pdf)
        return { ...r, autoSend: getSettings(db).waAutoSend && getSettings(db).waTarget === 'evolution' }
      },
      startCorrection: (visitId: number, reason: string, pin?: string) => startCorrection(db, visitId, { reason, pin }),
      discardCorrection: (reportId: number, pin?: string) => { requirePin(db, pin); discardCorrection(db, reportId) },
      versions: (visitId: number) => listVersions(db, visitId)
    },

    report: {
      html: (reportId: number) => reportHtml(db, reportId),
      pdf: (reportId: number) => pdfOf(reportId),
      openPdf: async (reportId: number) => shell.openPath(await pdfOf(reportId)),
      saveAs: async (reportId: number) => {
        const src = await pdfOf(reportId)
        const r = await dialog.showSaveDialog(ctx.win()!, { title: 'Save report PDF', defaultPath: src.split(/[\\/]/).pop() })
        if (r.canceled || !r.filePath) return null
        writeFileSync(r.filePath, (await import('node:fs')).readFileSync(src))
        return r.filePath
      },
      /** Save a blank letterhead (logo, name, address, contact) as a PDF for printing on plain paper. */
      saveLetterhead: async () => {
        const s = getSettings(db)
        const buf = await htmlToPdf(renderLetterheadHtml(s.lab, s.paper), s.paper)
        const r = await dialog.showSaveDialog(ctx.win()!, { title: 'Save letterhead PDF', defaultPath: 'KDS-letterhead.pdf' })
        if (r.canceled || !r.filePath) return null
        writeFileSync(r.filePath, buf)
        shell.showItemInFolder(r.filePath)
        return r.filePath
      },
      print: async (reportId: number) => {
        const s = getSettings(db)
        await printHtml(await reportHtml(db, reportId), { silent: s.silentPrint, printerName: s.printerName, paper: s.paper })
        audit(db, 'report.print', 'reports', reportId)
        return true
      },
      link: (reportId: number) => reportLink(db, reportId)
    },

    whatsapp: {
      plan: (reportId: number) => buildWaPlan(db, reportId),
      /** Level A: save the PDF, copy it to the clipboard and open the chat. Level B: only open the chat with the link. */
      send: async (reportId: number) => {
        const plan = buildWaPlan(db, reportId)
        const pdf = await pdfOf(reportId)
        if (plan.target === 'evolution' || plan.target === 'builtin') {
          try {
            await sendAutomatically(db, reportId, pdf)
            audit(db, 'whatsapp.send', 'reports', reportId, `${plan.level}/${plan.target}`)
            return { level: plan.level, copied: false, opened: plan.target, pdf, error: '' }
          } catch (e) {
            // the gateway is down or not linked: carry on with WhatsApp Web so the report still gets out
            audit(db, 'whatsapp.auto_failed_manual', 'reports', reportId, (e as Error).message)
            const r = await openChat(plan, pdf, 'web')
            return { ...r, error: (e as Error).message }
          }
        }
        return { ...(await openChat(plan, pdf, plan.target)), error: '' }
      },
      copyPdf: async (reportId: number) => {
        await copyFileToClipboard(await pdfOf(reportId))
        return true
      },
      showPdf: async (reportId: number) => {
        shell.showItemInFolder(await pdfOf(reportId))
      },
      testEvolution: (url: string, instance: string, apiKey: string) => testEvolution(url, instance, apiKey),
      autoStatus: (reportId: number) => autoSendStatus(db, reportId),
      linkStatus: () => builtinStatus(db),
      link: async (pin?: string) => { requirePin(db, pin); await builtinLink(db) },
      unlink: async (pin?: string) => { requirePin(db, pin); await builtinUnlink(db) },
      openWeb: async (reportId: number) => {
        const plan = buildWaPlan(db, reportId)
        await shell.openExternal(plan.webUrl)
      },
      copyText: (reportId: number) => clipboard.writeText(buildWaPlan(db, reportId).text)
    },

    owner: {
      day: (date?: string) => dayReport(db, date),
      dues: () => duesReport(db),
      doctors: (ym?: string) => doctorMonthly(db, ym),
      pending: () => pendingReport(db),
      insights: (days?: number) => insights(db, days)
    },

    backup: {
      list: () => ({
        nightly: listBackups(nightlyDir(ctx.dataDir), 'KDS-nightly'),
        nightlyDir: nightlyDir(ctx.dataDir),
        manual: listBackups(nightlyDir(ctx.dataDir), 'KDS-manual')
      }),
      run: () => {
        const path = createBackup(db, ctx.dataDir, nightlyDir(ctx.dataDir), new Date(), 'KDS-manual')
        pruneBackups(nightlyDir(ctx.dataDir), 30, 'KDS-manual')
        audit(db, 'backup.manual', 'backup', null, path)
        return path
      },
      drives: () => listRemovableDrives(),
      toFolder: (dest: string) => {
        const path = createBackup(db, ctx.dataDir, dest, new Date(), 'KDS-backup')
        setSettings(db, { lastPenDriveBackup: new Date().toISOString() })
        audit(db, 'backup.pendrive', 'backup', null, path)
        return path
      },
      chooseFolder: async () => {
        const r = await dialog.showOpenDialog(ctx.win()!, { title: 'Choose a folder or pen drive', properties: ['openDirectory', 'createDirectory'] })
        return r.canceled ? null : r.filePaths[0]
      },
      chooseBackup: async () => {
        const r = await dialog.showOpenDialog(ctx.win()!, { title: 'Choose the backup folder (KDS-backup-…)', properties: ['openDirectory'] })
        if (r.canceled || !r.filePaths[0]) return null
        return validateBackup(r.filePaths[0])
      },
      validate: (path: string) => validateBackup(path),
      listIn: (dir: string) => listBackups(dir),
      /** Closes the database, swaps in the backup, restarts the app. The old data is kept aside. */
      restore: (path: string, pin?: string) => {
        requirePin(db, pin)
        const v = validateBackup(path)
        if (!v.ok) throw new AppError('INVALID', v.error ?? 'Invalid backup')
        db.close()
        const kept = restoreBackup(path, ctx.dataDir)
        app.relaunch()
        setTimeout(() => app.exit(0), 300)
        return kept
      }
    },

    drive: {
      status: () => driveStatus(db, getDriveDeps(ctx.dataDir)),
      connect: (password: string, pin?: string) => {
        requirePin(db, pin)
        return connectDrive(db, getDriveDeps(ctx.dataDir), password, (url) => void shell.openExternal(url))
      },
      disconnect: (pin?: string) => {
        requirePin(db, pin)
        return disconnectDrive(db, getDriveDeps(ctx.dataDir))
      },
      backupNow: async () => {
        const d = getDriveDeps(ctx.dataDir)
        await runDriveBackup(db, ctx.dataDir, d)
        return driveStatus(db, d)
      },
      list: () => listDriveBackups(getDriveDeps(ctx.dataDir)),
      /** Downloads, unlocks and restores one Drive backup, then restarts. Needs the owner PIN; the password defaults to the saved one. */
      restore: async (id: string, password?: string, pin?: string) => {
        requirePin(db, pin)
        const { path, tmp } = await fetchDriveBackup(getDriveDeps(ctx.dataDir), id, password || undefined)
        db.close()
        try {
          const kept = restoreBackup(path, ctx.dataDir)
          app.relaunch()
          setTimeout(() => app.exit(0), 300)
          return kept
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
      }
    },

    importer: {
      chooseFolder: async () => {
        const r = await dialog.showOpenDialog(ctx.win()!, { title: 'Choose the folder with old Word reports', properties: ['openDirectory'] })
        return r.canceled ? null : r.filePaths[0]
      },
      run: (folder: string) =>
        runImport(db, folder, (p: ImportProgress) => ctx.win()?.webContents.send('import:progress', p)),
      log: (status?: string) => importLog(db, status)
    },

    sync: {
      status: () => syncStatus(db),
      now: () => syncNow(db, ctx.dataDir),
      resendAll: () => enqueueEverything(db),
      test: (url: string, key: string) => testConnection(url, key)
    },

    demo: {
      seed: () => seedDemo(db),
      clear: (pin?: string) => {
        requirePin(db, pin)
        return clearDemo(db)
      }
    }
  }
}

export type Handlers = ReturnType<typeof makeHandlers>
export type { AgeInput }
