import net from 'net';

const PORT = 9100;
const TIMEOUT_MS = 5000;

// Send raw bytes to an Epson printer over TCP (RAW/port 9100).
// Resolves when the data has been flushed; rejects on connect error or timeout.
export function sendToPrinter(ip: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    function done(err?: Error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    }

    socket.setTimeout(TIMEOUT_MS);
    socket.on('timeout', () => done(new Error(`printer at ${ip} timed out`)));
    socket.on('error', (err) => done(err));

    socket.connect(PORT, ip, () => {
      socket.write(data, (err) => {
        if (err) done(err);
        else done();
      });
    });
  });
}

// Quick reachability check: open + immediately close the TCP connection.
export function pingPrinter(ip: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(PORT, ip);
  });
}
