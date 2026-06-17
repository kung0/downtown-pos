# Downtown POS

Point-of-sale system for Downtown bar/café, Darmstadt.

## Requirements

- Node.js 20+ — download from https://nodejs.org
- npm 10+ (bundled with Node 20)

## First-time setup

Open a terminal in this folder (shift+right-click → "Open in Terminal" on Windows):

```
npm install
```

Copy the environment file:

```
copy .env.example .env
```

(Leave all values empty for now — the app runs in mock mode without Fiskaly credentials.)

## Running in the bar (production)

Build the app and start it with PM2 (process manager that keeps it alive and restarts it on boot):

```
npm run build
npm install -g pm2
pm2 start server/dist/index.js --name downtown-pos
pm2 save
```

Register auto-start on Windows boot (run once):

```
npm install -g pm2-windows-startup
pm2-startup install
```

Open the firewall so tablets can reach the server (run in PowerShell **as Administrator**):

```powershell
netsh advfirewall firewall add rule name="Downtown POS" dir=in action=allow protocol=TCP localport=3000
```

Find the PC's local IP:

```
ipconfig
```

Look for `IPv4 Address` under your WiFi adapter. Tablets and phones open:  
**http://[that-ip]:3000**

Tip: assign a static local IP to this PC in your router settings so the address never changes.

### Updating after code changes

```
npm run build
pm2 restart downtown-pos
```

## Development (local only)

```
npm run dev
```

Starts backend (port 3000) and frontend (port 5173) together. Open **http://localhost:5173**.

## Verify the backend is running

```
http://localhost:3000/api/health
```

Should return something like:
```json
{ "ok": true, "db": "connected", "product_count": 22, "time": "..." }
```

## Data

The SQLite database lives at `server/data/downtown.db`.  
It is created automatically on first run and is gitignored.  
Seed data (22 products, 5 pool tables, default settings) is inserted on first run if the tables are empty.

## Project structure

```
shared/     TypeScript types shared by server and client
server/     Express + WebSocket + SQLite backend (port 3000)
client/     React + Vite frontend (port 5173 in dev)
```

## Phase 2 (not yet)

Phase 2 will add Fiskaly TSE integration for German fiscal law compliance  
and Epson TM-M30 receipt printing. The data model already has placeholder  
fields for TSE (nullable on closed tabs).
