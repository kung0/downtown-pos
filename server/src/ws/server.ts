import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { WSMessage } from '@downtown/shared';

let wss: WebSocketServer;

export function initWSServer(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', () => {
    console.log('ws client connected');
  });

  console.log('  websocket ready on /ws');
}

export function broadcast(msg: WSMessage): void {
  if (!wss) return;
  const raw = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}
