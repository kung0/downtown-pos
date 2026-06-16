import { v4 as uuidv4 } from 'uuid';

export interface TseInput {
  payment_method: 'cash' | 'card';
  subtotal_standard_cents: number;
  subtotal_reduced_cents: number;
  tip_cents: number;
  total_cents: number;
}

export interface TseResult {
  tse_signature: string;
  tse_timestamp: string;
  tse_transaction_number: string;
}

const FISKALY_BASE = 'https://kassensichv-middleware.fiskaly.com/api/v2';

const MOCK_MODE = !(
  process.env.FISKALY_API_KEY &&
  process.env.FISKALY_API_SECRET &&
  process.env.FISKALY_TSS_ID &&
  process.env.FISKALY_CLIENT_ID
);

if (MOCK_MODE) {
  console.log('[tse] mock mode — no Fiskaly credentials configured');
}

// fetch() throws TypeError with message "fetch failed" on network errors (ECONNREFUSED, ETIMEDOUT, etc.)
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && (err as TypeError).message === 'fetch failed';
}

// Signs a transaction, tolerating a TSE outage: on a network error the sale
// proceeds unsigned (tse: null, picked up later by the retry loop). Any other
// failure returns an error string for the caller to surface as a 502.
export async function signOrOffline(
  input: TseInput,
): Promise<{ tse: TseResult | null; error?: string }> {
  try {
    return { tse: await signTransaction(input) };
  } catch (e: any) {
    if (isNetworkError(e)) {
      console.warn('[tse] network offline — closing sale without signature, will retry');
      return { tse: null };
    }
    console.error('[tse] signTransaction failed:', e.message);
    return { tse: null, error: e.message };
  }
}

let _accessToken: string | null = null;
let _tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _accessToken;
  }
  const resp = await fetch(`${FISKALY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.FISKALY_API_KEY,
      api_secret: process.env.FISKALY_API_SECRET,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Fiskaly auth failed (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json() as { access_token: string };
  _accessToken = data.access_token;
  const payload = JSON.parse(
    Buffer.from(data.access_token.split('.')[1], 'base64').toString('utf8')
  ) as { exp: number };
  _tokenExpiresAt = payload.exp * 1000;
  return _accessToken;
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function signTransaction(input: TseInput): Promise<TseResult> {
  if (MOCK_MODE) {
    return {
      tse_signature: `MOCK-SIG-${uuidv4()}`,
      tse_timestamp: new Date().toISOString(),
      tse_transaction_number: String(Math.floor(Math.random() * 900_000) + 100_000),
    };
  }

  const tssId = process.env.FISKALY_TSS_ID!;
  const clientId = process.env.FISKALY_CLIENT_ID!;
  const token = await getAccessToken();
  const txId = uuidv4();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const activeResp = await fetch(`${FISKALY_BASE}/tss/${tssId}/tx/${txId}?tx_revision=1`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ state: 'ACTIVE', client_id: clientId }),
  });
  if (!activeResp.ok) {
    throw new Error(`Fiskaly tx ACTIVE failed (${activeResp.status}): ${await activeResp.text()}`);
  }

  const amountsPerVatRate: Array<{ vat_rate: string; amount: string }> = [];
  if (input.subtotal_standard_cents > 0) {
    amountsPerVatRate.push({ vat_rate: 'NORMAL', amount: centsToDecimal(input.subtotal_standard_cents) });
  }
  if (input.subtotal_reduced_cents > 0) {
    amountsPerVatRate.push({ vat_rate: 'REDUCED_1', amount: centsToDecimal(input.subtotal_reduced_cents) });
  }
  // Tips are VAT-exempt (§3 Abs. 11 UStG)
  if (input.tip_cents > 0) {
    amountsPerVatRate.push({ vat_rate: 'NULL', amount: centsToDecimal(input.tip_cents) });
  }

  const finishedResp = await fetch(`${FISKALY_BASE}/tss/${tssId}/tx/${txId}?tx_revision=2`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      state: 'FINISHED',
      client_id: clientId,
      schema: {
        standard_v1: {
          receipt: {
            receipt_type: 'RECEIPT',
            amounts_per_vat_rate: amountsPerVatRate,
            amounts_per_payment_type: [{
              payment_type: input.payment_method === 'cash' ? 'CASH' : 'NON_CASH',
              amount: centsToDecimal(input.total_cents),
            }],
          },
        },
      },
    }),
  });
  if (!finishedResp.ok) {
    throw new Error(`Fiskaly tx FINISHED failed (${finishedResp.status}): ${await finishedResp.text()}`);
  }

  const result = await finishedResp.json() as {
    number: number;
    time_end: number;
    signature: { value: string };
  };

  return {
    tse_signature: result.signature.value,
    tse_timestamp: new Date(result.time_end * 1000).toISOString(),
    tse_transaction_number: String(result.number),
  };
}
