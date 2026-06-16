import type { WSMessage } from '@downtown/shared';

// A single shared WebSocket for the whole app, with automatic reconnect.
// Pages subscribe with subscribe(handler); the connection is opened on the
// first subscriber and kept alive (with reconnect) for the life of the tab.

type Handler = (msg: WSMessage) => void;

const handlers = new Set<Handler>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onmessage = (e) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return; // ignore malformed frames rather than killing the socket
    }
    for (const h of handlers) h(msg);
  };

  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close(); // triggers onclose → reconnect
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer || handlers.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (handlers.size > 0) connect();
  }, 2000);
}

export function subscribe(handler: Handler): () => void {
  handlers.add(handler);
  if (!ws) connect();
  return () => {
    handlers.delete(handler);
  };
}
