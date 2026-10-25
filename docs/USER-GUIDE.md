# KDS Lab Desk — User Guide

For Dr. Manoj Kumar, Ram Vivek Kumar and the lab staff. Written in simple English; a Hindi summary is at the end.

KDS Lab Desk replaces copying an old Word file for every patient. You type only the numbers. The program fills in units, normal ranges,
the calculated values, and marks high and low results. It keeps every report, prints it, and sends it on WhatsApp.
**It works without internet.**

---

## 1. Installing

1. Copy **KDS-Lab-Desk-Setup.exe** to the lab PC (pen drive is fine).
2. Double-click it. If Windows says *"Windows protected your PC"*, click **More info**, then **Run anyway**. (The installer has no paid publisher certificate. This is normal.)
3. Wait a few seconds. The program opens by itself and puts **KDS Lab Desk** on the desktop and in the Start menu. No administrator password is needed.

Your data is saved in `C:\Users\<name>\AppData\Roaming\KDS Lab Desk`. Uninstalling the program does **not** delete it.

**First time only**
* Open **Settings → PIN & users** and set a 4-digit PIN. Write it down. The PIN protects Settings, the ranges and corrections to approved reports.
* Dr. Manoj Kumar should open **Settings → Test master & prices**, look through the tests, units and normal ranges (they start as *defaults*), change what he wants, and tick **Reviewed by Dr. Manoj Kumar**. The yellow warning on the home screen then disappears.
* Set your own prices there too, then tick *Prices are the lab's own*.
* Want to practise first? **Settings → Data & updates → Load demo patients** adds invented patients. Remove them with one click before real work.

---

## 2. Every day: three steps

### Step 1 — Register the patient  (**New patient**)
1. Type the **phone number** (optional). If other family members already use that number, their names appear. Tap the right one, or **+ New person on this number**.
2. Choose the **title** (Mr, Mrs, Miss, Master, Baby). The sex fills in by itself. For *Baby*, choose the sex.
3. Type the **name**, **age** (years; use months or days for small children), **village**, and the **doctor**. Type 2 letters and pick from the list, or write *Self*.
4. Tick the **tests**. (Type in "Find a test…" to search.)
5. Type how much was **paid**. The total and due amount are shown.
6. Press **Save & enter results**. The sample number (like `2610-047`) is given automatically.

*You can press Enter to move to the next box.* If the title and sex do not match, a yellow warning appears; check it, then press Save again.

### Step 2 — Enter the results  (opens after saving; or tap the patient on the **Today** screen)
* All boxes are empty. Type only the numbers you measured.
* The program shows the **normal range** and the **unit**, marks **H** (high) or **L** (low), and works out MCV, MCH, MCHC, globulin, A/G ratio, VLDL, LDL and indirect bilirubin by itself.
  If you type the machine's own MCV/MCH/MCHC, they are kept, and you get a warning if they are very different from the calculated ones.
* **Previous** shows this patient's last values.
* A **red box** means the value is impossible (for example Hb 105). Fix it first.
* A **red banner with !!** means a dangerous value (Hb below 7, platelets below 0.5 lakh, very low or very high sugar, very low or high potassium). Tell the doctor.
* DLC must add up to 100.
* If the numbers are **exactly the same as another patient's report**, the program stops you: *"these values are exactly the same as sample …"*. Re-read the analyser. If it really is the same, you must type a reason to continue.
* Everything is saved on the PC as you type.
* Press **Approve report** when done. After approval the report is **locked**.

### Step 3 — Print or send  (opens after approving)
* **Print** — prints on A4 (or your pre-printed letterhead, if you chose that in Settings).
* **Save PDF** — saves a PDF file you can keep or e-mail.
* **Send on WhatsApp** — see below.

---

## 3. WhatsApp

**Best way (do this once):** link the lab's WhatsApp, like WhatsApp Web.

1. Go to **Settings → General**, find **Send reports on WhatsApp**, press **Link WhatsApp**.
2. A square code (QR) appears. On the lab phone: open WhatsApp → the three dots (⋮) → **Linked devices** → **Link a device** → point the phone at the code.
3. The screen says **WhatsApp is linked**. Done. This is needed only once (again only if you press *Unlink* or remove the device on the phone).

After that, open an approved report and press **Send on WhatsApp** (green): the PDF goes to the patient by itself, with no copy and paste.
You can also tick **Send the report on WhatsApp by itself as soon as it is approved**, and then even that button is not needed.
If the internet is off, the program says so; press the green button again later.

Tips: use a number you can afford to lose (WhatsApp does not like automatic messages). The program waits a few seconds between messages on purpose.
No phone number saved for the patient? You can only print.

**If you have not linked WhatsApp:** pressing the green button opens the patient's chat in the browser. The PDF is already copied:
click the message box, press **Ctrl+V**, then **Enter**.

When the cloud is set up later (see `CLOUD-SETUP.md`) the message carries a **link and a PIN** instead, and nothing needs to be attached.

**हिंदी में:** Settings → General → *Link WhatsApp* दबाएँ, फ़ोन में WhatsApp → ⋮ → Linked devices → Link a device से QR स्कैन करें। बस एक बार। उसके बाद हरा बटन PDF अपने-आप भेज देता है।

---

## 4. Finding old reports

* **Patients & search** — type a name, village, part of a phone number or a sample number. Open the person to see **all visits**.
* **All visits by date / doctor** — pick dates, a doctor, or "With dues".
* **New visit for this person** on a patient's page starts a new visit with the details filled in.
* Old Word files can be brought in once: **Import old reports**. They appear as read-only history. Files the program cannot read are listed, never lost.

---

## 5. Correcting a mistake after approval

1. Open the report and press **Correct report**.
2. Type the PIN and the **reason**.
3. A new version opens. Change the value, and approve again.

The old version is **kept** and can be opened from the *Versions* buttons. The new printed report says "Corrected report (version 2)".

---

## 6. Tests sent to another lab (Thyroid, Vitamin D …)

The program does not make another lab's report. Tick the test (it says *sent out*). On the visit page:
1. Write **where** and **when** it was sent.
2. When the lab's PDF arrives, press **Attach received PDF**. It is kept exactly as received. Give that PDF to the patient.

**Reports → Pending** lists samples sent out and not yet received.

---

## 7. Money and the owner's reports  (**Reports**)

* **Day register** — every patient of a day, bill, paid, due.
* **Cash & dues** — today's cash, and who still owes money. Press **Receive** when someone pays later.
* **Doctor-wise (monthly)** — how many patients each doctor sent. Choose the month.
* **Pending** — registered but not reported; sent-out not received.

Press **Print this page** to print any of these.

---

## 8. Backup — please do not skip this

* The program makes a **copy every night** on this PC (the last 30 are kept).
* **Once a week** put a pen drive in the PC and press **Backup → Backup to <drive>**. The home screen reminds you.
* Keep the pen drive somewhere safe, not in the lab.

### If the PC breaks or is replaced
1. Install KDS Lab Desk on the new PC.
2. Plug in the pen drive, open **Backup → Restore from a backup → Choose backup folder…**, choose the newest folder whose name starts with `KDS-backup`.
3. Check the date and numbers shown, press **Restore now**, type the PIN. The program restarts with everything back.
(Your old data is not deleted; it is moved to a *before-restore* folder.)

---

## 9. Settings you may want

* **General** — lab name, address line, signature names, paper size, printer, *pre-printed letterhead paper* (how many mm to leave blank at top and bottom), phone number required, WhatsApp message text.
* **Test master & prices** — units, normal ranges for men / women / children, prices. A changed range applies to **new reports only**; old reports stay as printed.
* **PIN & users** — change the PIN. Optional: only the doctor, with his own PIN, can approve.
* **Cloud sync** — leave off until a helper sets it up.
* Top right: **हिन्दी / English** changes the screen language. Printed reports are always English.

---

## 10. If something goes wrong

| What you see | What to do |
|---|---|
| "Wrong PIN" | Try again. If the PIN is lost, the data is safe, but Settings stay locked: ask your helper (see below). |
| Nothing prints | Check the printer is the Windows default, or choose it in Settings → General → Printer. **Save PDF** and print from there. |
| WhatsApp does not open | Open WhatsApp yourself, paste with Ctrl+V. The PDF is in `…\KDS Lab Desk\pdf`. |
| The program closes at once | Start it again. Your data is saved after every change. |
| PC is dead | See section 8. |

**Lost PIN:** your data is safe. Right-click the **KDS Lab Desk** desktop shortcut → *Properties*. At the end of the *Target* box add a space and `--reset-pin`, press OK, and start the program once. The PIN is removed (reports are not touched). Then remove `--reset-pin` from the shortcut again and set a new PIN in Settings.

---

# हिन्दी सारांश

**KDS Lab Desk** पुरानी Word फ़ाइल कॉपी करने की जगह लेता है। आप सिर्फ़ नाप के आँकड़े लिखते हैं; इकाई, सामान्य सीमा, MCV/MCH/MCHC जैसी गणनाएँ और H/L के निशान प्रोग्राम खुद लगाता है। इंटरनेट के बिना भी चलता है।

**रोज़ के तीन काम**
1. **नया मरीज़** — फ़ोन नंबर लिखें (ज़रूरी नहीं); उस नंबर के परिवार के लोग दिखेंगे, सही नाम चुनें या “+ इस नंबर पर नया व्यक्ति” दबाएँ। संबोधन (Mr/Mrs/Miss/Master/Baby), नाम, उम्र, डॉक्टर लिखें, जाँचें चुनें, जमा रकम लिखें, फिर **सेव करें और रिज़ल्ट भरें** दबाएँ। सैंपल नंबर अपने-आप बनता है।
2. **रिज़ल्ट भरें** — सिर्फ़ नाप के आँकड़े लिखें। लाल डिब्बा = असंभव मान (जैसे Hb 105)। लाल पट्टी “!!” = खतरनाक मान, डॉक्टर को बताएँ। DLC का जोड़ 100 होना चाहिए। अगर आँकड़े किसी दूसरे मरीज़ के जैसे ही हैं तो प्रोग्राम रोकेगा; मशीन से दोबारा पढ़ें, सही हो तभी कारण लिखकर आगे बढ़ें। अंत में **रिपोर्ट स्वीकृत करें** — इसके बाद रिपोर्ट लॉक हो जाती है।
3. **प्रिंट या WhatsApp** — **प्रिंट** से A4 पर छपेगी। **WhatsApp पर भेजें** दबाएँ: मरीज़ की चैट खुलेगी और PDF कॉपी हो चुकी होगी; बस **Ctrl+V** फिर **Enter** दबाएँ।

**गलती सुधारना** — रिपोर्ट खोलकर **रिपोर्ट सुधारें** दबाएँ, पिन और कारण लिखें। नया संस्करण बनेगा, पुराना सुरक्षित रहेगा।

**बैकअप (ज़रूरी)** — हर रात PC पर अपने-आप कॉपी बनती है। **हफ़्ते में एक बार** पेन-ड्राइव लगाकर **बैकअप → पेन-ड्राइव में बैकअप** दबाएँ। पेन-ड्राइव लैब के बाहर सुरक्षित रखें।

**PC ख़राब हो जाए तो** — नए PC पर प्रोग्राम लगाएँ, पेन-ड्राइव लगाकर **बैकअप → बैकअप से वापस लाएँ** में सबसे नया `KDS-backup…` फ़ोल्डर चुनें, **अभी वापस लाएँ** दबाएँ और पिन डालें। सारा डेटा लौट आएगा।

**पहली बार** — सेटिंग में 4 अंकों का पिन डालें और लिखकर रखें। डॉ. मनोज कुमार **सेटिंग → जाँच सूची और दाम** में सारी जाँचें और सामान्य सीमाएँ देखकर “जाँच हो गई” पर टिक करें।

**भाषा** — ऊपर दाईं ओर **हिन्दी / English** बटन से स्क्रीन की भाषा बदलती है। छपी हुई रिपोर्ट हमेशा अंग्रेज़ी में होती है।

---

## Licence (free plan)

The program is **free for up to 100 approved reports each month**. Settings → **Licence** shows how many are used.
At the limit you can still open, print, search and send old reports; only approving a *new* report waits until the 1st of the next month or until you enter a licence code.
To get a licence code, contact K.D.S. Pathology (rayskumar02@gmail.com). Paste the code in Settings → Licence → **Save licence**.

**हिंदी में:** हर महीने 100 रिपोर्ट मुफ़्त हैं। सीमा पूरी होने पर पुरानी रिपोर्ट खुलती और छपती रहती हैं, सिर्फ़ नई रिपोर्ट मंज़ूर करना रुकता है। लाइसेंस कोड के लिए संपर्क करें और उसे Settings → Licence में चिपकाएँ।
