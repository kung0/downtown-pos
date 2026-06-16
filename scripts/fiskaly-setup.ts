/**
 * Run once to initialize the TSS and create a client.
 * Usage: npx tsx scripts/fiskaly-setup.ts
 *
 * Reads from .env: FISKALY_API_KEY, FISKALY_API_SECRET, FISKALY_TSS_ID, FISKALY_ADMIN_PUK
 * Prints FISKALY_CLIENT_ID to add to .env when done.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';

const BASE = 'https://kassensichv-middleware.fiskaly.com/api/v2';

const API_KEY    = process.env.FISKALY_API_KEY;
const API_SECRET = process.env.FISKALY_API_SECRET;
const TSS_ID     = process.env.FISKALY_TSS_ID;
const ADMIN_PUK  = process.env.FISKALY_ADMIN_PUK;

if (!API_KEY || !API_SECRET || !TSS_ID || !ADMIN_PUK) {
  console.error('missing env vars — set FISKALY_API_KEY, FISKALY_API_SECRET, FISKALY_TSS_ID, FISKALY_ADMIN_PUK in .env');
  process.exit(1);
}

// Change this to whatever PIN you want to set
const ADMIN_PIN = '123456';

async function getToken(): Promise<string> {
  const resp = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY, api_secret: API_SECRET }),
  });
  if (!resp.ok) throw new Error(`auth failed (${resp.status}): ${await resp.text()}`);
  return (await resp.json() as { access_token: string }).access_token;
}

async function main() {
  console.log('authenticating…');
  const token = await getToken();
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. Check TSS state
  console.log('checking TSS state…');
  const tssResp = await fetch(`${BASE}/tss/${TSS_ID}`, { headers: h });
  if (!tssResp.ok) throw new Error(`get TSS failed (${tssResp.status}): ${await tssResp.text()}`);
  const tss = await tssResp.json() as { state: string };
  console.log(`  state: ${tss.state}`);

  if (tss.state === 'CREATED') {
    console.log('transitioning to UNINITIALIZED…');
    const r = await fetch(`${BASE}/tss/${TSS_ID}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ state: 'UNINITIALIZED' }),
    });
    if (!r.ok) throw new Error(`transition failed (${r.status}): ${await r.text()}`);
    console.log('  done');
  }

  if (tss.state === 'CREATED' || tss.state === 'UNINITIALIZED') {
    // Set admin PIN using PUK (per Fiskaly docs: admin_puk + new_admin_pin)
    console.log('setting admin PIN…');
    const pinResp = await fetch(`${BASE}/tss/${TSS_ID}/admin`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ admin_puk: ADMIN_PUK, new_admin_pin: ADMIN_PIN }),
    });
    if (!pinResp.ok) throw new Error(`set PIN failed (${pinResp.status}): ${await pinResp.text()}`);
    console.log('  done');

    // Authenticate as admin (per Fiskaly docs: POST /admin/auth)
    console.log('authenticating as admin…');
    const authResp = await fetch(`${BASE}/tss/${TSS_ID}/admin/auth`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ admin_pin: ADMIN_PIN }),
    });
    if (!authResp.ok) throw new Error(`admin auth failed (${authResp.status}): ${await authResp.text()}`);
    const authData = await authResp.json() as any;
    if (authData.access_token) h['Authorization'] = `Bearer ${authData.access_token}`;
    console.log('  done');

    // Initialize TSS
    console.log('initializing TSS…');
    const initResp = await fetch(`${BASE}/tss/${TSS_ID}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ state: 'INITIALIZED' }),
    });
    if (!initResp.ok) throw new Error(`TSS init failed (${initResp.status}): ${await initResp.text()}`);
    console.log('  TSS initialized ✓');
  } else if (tss.state === 'INITIALIZED' || tss.state === 'UNBOUND') {
    console.log('  TSS already initialized, skipping');
  }

  // Create client
  const clientId = randomUUID();
  console.log('creating client…');
  const freshToken = await getToken();
  const fh: Record<string, string> = { Authorization: `Bearer ${freshToken}`, 'Content-Type': 'application/json' };
  const clientResp = await fetch(`${BASE}/tss/${TSS_ID}/client/${clientId}`, {
    method: 'PUT', headers: fh,
    body: JSON.stringify({ serial_number: 'downtown-pos-1' }),
  });
  if (!clientResp.ok) throw new Error(`client create failed (${clientResp.status}): ${await clientResp.text()}`);
  const client = await clientResp.json() as { _id: string; state: string };
  console.log(`  client state: ${client.state}`);

  console.log('\n✓ done! add this to your .env:\n');
  console.log(`FISKALY_CLIENT_ID=${clientId}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
