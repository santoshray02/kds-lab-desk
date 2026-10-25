# KDS WhatsApp gateway (optional, for a computer helper)

> Most labs do **not** need this. KDS Lab Desk can link WhatsApp by itself: Settings → General → *Link WhatsApp* → scan the QR.
> This separate program is only for sending from a different computer or a server.

A small program that sends the lab's report PDFs on WhatsApp by itself. KDS Lab Desk talks to it with the same
three calls as Evolution API, so in the app you choose **Settings → Patients and WhatsApp → Automatic**.

* No database. The linked WhatsApp session is a folder (`auth/`). About 100 MB of RAM, almost no CPU.
* Needs a computer that is on whenever reports are sent, with internet: the lab PC itself, a spare PC, or a small cloud server.
* It uses an **unofficial** WhatsApp Web library (Baileys). WhatsApp can block numbers that behave like bots, so:
  use a number you can afford to lose, send only to patients who gave their number, and keep to the built-in limits
  (one message every 3–5 seconds, 60 per hour).

## Set up on Windows (the lab PC or a spare PC)

1. Install Node.js 20 or newer from nodejs.org (the "LTS" version).
2. Copy this `gateway` folder somewhere permanent, for example `C:\kds-gateway`.
3. Copy `.env.example` to `.env`. Replace the `API_KEY` with a long random secret (20+ letters and digits). Keep it private.
4. Double-click `start-gateway.cmd`. The first run installs what it needs (internet needed, about a minute).
5. Open `http://127.0.0.1:8080/qr?key=YOUR_API_KEY` in a browser. On the lab phone: WhatsApp → Settings →
   Linked devices → Link a device → scan the code. The page then says "WhatsApp is linked".
6. Double-click `install-autostart.cmd` once, so it starts by itself at every log-in.
7. In KDS Lab Desk: Settings → Patients and WhatsApp → *Open WhatsApp in* → **Automatic**.
   Gateway address `http://127.0.0.1:8080`, instance name `kds`, API key = your `API_KEY`. Press **Test the gateway**: it must say *Connected*.
   Save. Now "Send on WhatsApp" sends the PDF without any Ctrl+V.

If the gateway runs on another computer, use that computer's address instead of `127.0.0.1`, set `HOST=0.0.0.0` in `.env`,
and put HTTPS in front of it if the traffic crosses the internet (the API key travels with every request).

## Set up on a cloud server (Docker)

    echo "API_KEY=<long random secret>" > .env
    docker compose up -d --build

Then open `http://<server>:8080/qr?key=<API_KEY>` once to link WhatsApp (use an SSH tunnel or HTTPS proxy, do not leave it open on plain HTTP).

## What keeps it running

| If this happens | What happens |
|---|---|
| Internet drops, WhatsApp closes the link | It reconnects by itself (waits 2 s, 4 s, 8 s … up to 1 minute) |
| The link is stuck for minutes | A watchdog starts the link again |
| You unlink the device on the phone | The old session is deleted and a new QR appears at `/qr` |
| A stray error in the WhatsApp library | Logged and ignored; 5 in 5 minutes → the program restarts cleanly |
| The program stops or is killed | `run-forever.mjs` starts it again in seconds (Docker: `restart: unless-stopped`) |
| The PC restarts | `install-autostart.cmd` starts it at log-in (Docker starts with the machine) |
| A send hangs | It is cut off after 90 s and the next message is not blocked |
| The gateway is down when a report is sent | KDS Lab Desk falls back to WhatsApp Web and tells the user |

Logs: `gateway.log` (kept under 5 MB). Health check: `http://127.0.0.1:8080/health`.

## Safety

* Every call except `/health` needs the API key. Only PDF files are accepted. Requests over 25 MB are refused.
* The `auth` folder is the lab's WhatsApp login: back it up privately and never share it. Do not put it in git.
* To stop sending for good: WhatsApp → Linked devices → log out the device, and delete `auth/`.
