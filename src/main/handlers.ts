import { app, BrowserWindow, clipboard, dialog, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { Settings } from '../shared/settings'
import type { Sex } from '../shared/types'
import type { AgeInput } from '../shared/types'
import { createBackup, listBackups, listRemovableDrives, pruneBackups, restoreBackup, validateBackup } from './backup'
import { audit, type Db } from './db'
import { renderLetterheadHtml } from '../shared/reportHtml'
import { htmlToPdf, listPrinters, printHtml } from './electronBits'
import { editParam, loadMaster, rangeHistory, setPanelActive, setPanelPrice, setPanelSentOut, type ParamEdit } from './master'
import { dayReport, insights, doctorMonthly, duesReport, pendingReport } from './owner'
import { updatePatient, getPatient, peopleByPhone, searchPeople, suggestDoctors, type PatientInput } from './patients'
import { ensurePdf, reportHtml, reportLink } from './reportsvc'
import {
  AppError, approveReport, discardCorrection, getEntry, listVersions, saveDraft, startCorrection
} from './results'
import { checkPin, getSettings, hasPin, setPin, setSettings } from './settings'
import {
  addPayment, attachSentOutPdf, cancelVisit, createVisit, getVisit, listVisits, markSentOut, removeTest, updateBill,
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
      }
    },

    visits: {
      create: (input: NewVisitInput) => createVisit(db, input),
      list: (f: VisitFilter) => listVisits(db, f),
      get: (id: number) => getVisit(db, id),
      addPayment: (visitId: number, amount: number, note?: string) => addPayment(db, visitId, amount, note),
      updateBill: (visitId: number, total: number, discount: number, pin?: string) => { requirePin(db, pin); updateBill(db, visitId, total, discount) },
      cancel: (visitId: number, reason: string, pin?: string) => {
        requirePin(db, pin)
        cancelVisit(db, visitId, reason)
      },
      removeTest: (visitTestId: number) => removeTest(db, visitTestId),
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
