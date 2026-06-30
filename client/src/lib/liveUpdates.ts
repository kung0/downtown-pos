import type { WSMessage } from '@downtown/shared';

// A single shared WebSocket for the whole app, with automatic reconnect.
// Pages subscribe with subscribe(handler); the connection is opened on the
// first subscriber and kept alive (with reconnect) for the life of the tab.
//
// Pages also register a resync callback with subscribeResync(handler) to
// re-fetch their data whenever the socket reconnects after a drop. The live
// stream only delivers *new* events — anything broadcast while a device was
// disconnected (e.g. a phone with a locked screen) is lost, so a reconnect
// must be followed by a fresh fetch or the UI stays stale until manual reload.

type Handler = (msg: WSMessage) => void;
type ResyncHandler = () => void;

const handlers = new Set<Handler>();
const resyncHandlers = new Set<ResyncHandler>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let hasEverConnected = false;
let visibilityBound = false;

function connect(): void {
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    // On any reconnect (not the very first connect), pages must re-fetch to
    // pick up whatever changed while this device was offline.
    if (hasEverConnected) {
      for (const r of resyncHandlers) r();
    }
    hasEverConnected = true;
  };

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

// Mobile browsers suspend background tabs: the socket dies and the reconnect
// timer is frozen. When the tab becomes visible again, reconnect immediately
// instead of waiting out the (possibly suspended) timer.
function ensureVisibilityListener(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || handlers.size === 0) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!ws) connect();
  });
}

export function subscribe(handler: Handler): () => void {
  handlers.add(handler);
  ensureVisibilityListener();
  if (!ws) connect();
  return () => {
    handlers.delete(handler);
  };
}

export function subscribeResync(handler: ResyncHandler): () => void {
  resyncHandlers.add(handler);
  return () => {
    resyncHandlers.delete(handler);
  };
}
