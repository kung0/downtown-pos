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

This installs all dependencies for server, client, and shared packages.

## Development

```
npm run dev
```

This starts both the backend (port 3000) and the frontend (port 5173) in one terminal.

Open a browser and go to: **http://localhost:5173**

To access from tablets/phones on the same WiFi, use the PC's local IP instead of `localhost`.  
The IP is shown in the terminal output when Vite starts (look for `Network: http://192.168.x.x:5173`).

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
