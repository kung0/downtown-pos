import { useState, useEffect, useCallback } from 'react';
import type { Tab, TabEvent, WSMessage } from '@downtown/shared';
import { tabsApi, printerApi } from '../api';
import { subscribe } from '../lib/liveUpdates';
import { formatDateTime, formatTime } from '../utils/time';
import { formatMoney } from '../utils/money';
import { useSession } from '../context/SessionContext';

const TRACKED_TAB_EVENTS = new Set<WSMessage['type']>(['tab:opened', 'tab:updated', 'tab:closed', 'tab:voided', 'tab:deleted']);

export default function HistoryPage() {
  const { session }               = useSession();
  const [tabs, setTabs]           = useState<Tab[]>([]);
  const [search, setSearch]       = useState('');
  const [expandedId, setExpanded] = useState<number | null>(null);
  const [loading, setLoading]     = useState(false);

  const sessionId = session?.id;

  const load = useCallback(async (sid: number | undefined) => {
    setLoading(true);
    try {
      setTabs(await tabsApi.history(sid));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(sessionId); }, [sessionId, load]);

  useEffect(() => {
    return subscribe((msg: WSMessage) => {
      if (TRACKED_TAB_EVENTS.has(msg.type)) {
        const incoming = msg.data as Tab;
        if (sessionId == null || incoming.session_id === sessionId) {
          setTabs(prev => {
            const exists = prev.find(t => t.id === incoming.id);
            if (exists) return prev.map(t => t.id === incoming.id ? incoming : t);
            return [incoming, ...prev];
          });
        }
      }
    });
  }, [sessionId]);

  const filtered = tabs.filter(t =>
    t.customer_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">History</h1>
        <input
          type="search"
          placeholder="Search name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '7px 10px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: '14px',
            background: 'var(--surface)',
            color: 'var(--text)',
            width: '180px',
          }}
        />
      </div>

      <div style={{ padding: '16px 24px', maxWidth: 720 }}>
        {loading && (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            {search ? 'No tabs match that name.' : 'No closed tabs this shift.'}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(tab => (
            <HistoryCard
              key={tab.id}
              tab={tab}
              expanded={expandedId === tab.id}
              onToggle={() => setExpanded(prev => prev === tab.id ? null : tab.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function describeEvent(e: TabEvent): string {
  const p = e.payload;
  switch (e.event_type) {
    case 'tab_opened':  return `Tab geöffnet`;
    case 'item_added':  return `+${(p.qty as number) ?? 1}× ${p.name as string}  ·  ${formatMoney((p.price_cents as number) * ((p.qty as number) ?? 1))}`;
    case 'item_removed': return `−${(p.quantity_removed as number) ?? 1}× ${p.name as string}`;
    case 'tab_updated': return `Notiz geändert`;
    case 'tab_closed':  return `Bezahlt · ${p.payment_method as string} · ${formatMoney(p.total as number)}`;
    case 'tab_deleted': return `Gelöscht`;
    case 'split_paid':  return `Split bezahlt`;
    default:            return e.event_type;
  }
}

function ActivityDot({ type }: { type: string }) {
  const color = type === 'item_added' ? 'var(--primary)' : type === 'item_removed' ? 'var(--danger, #e53e3e)' : 'var(--text-muted)';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 4 }} />;
}

function HistoryCard({ tab, expanded, onToggle }: { tab: Tab; expanded: boolean; onToggle: () => void }) {
  const closedAt = tab.closed_at ?? tab.voided_at ?? tab.deleted_at;
  const displayTime = closedAt ?? tab.opened_at;
  const runningTotal = tab.total_cents ?? (tab.items?.reduce((s, i) => s + i.price_snapshot_cents * i.quantity, 0) ?? 0);
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState('');
  const [showActivity, setShowActivity] = useState(false);
  const [events, setEvents] = useState<TabEvent[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);

  async function toggleActivity(e: React.MouseEvent) {
    e.stopPropagation();
    if (showActivity) { setShowActivity(false); return; }
    setShowActivity(true);
    if (events !== null) return;
    setEventsLoading(true);
    try {
      setEvents(await tabsApi.events(tab.id));
    } finally {
      setEventsLoading(false);
    }
  }

  async function handlePrint(e: React.MouseEvent, bewirtung = false) {
    e.stopPropagation();
    setPrinting(true);
    setPrintMsg('');
    try {
      await printerApi.printReceipt(tab.id, { bewirtung });
      setPrintMsg('Sent!');
    } catch (err) {
      setPrintMsg((err as Error).message);
    } finally {
      setPrinting(false);
      setTimeout(() => setPrintMsg(''), 3000);
    }
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1.5px solid ${expanded ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          padding: '12px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tab.customer_name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {formatDateTime(displayTime)}
          </div>
        </div>
        <span className={`badge ${tab.status === 'closed' ? 'badge--green' : tab.status === 'open' ? 'badge--blue' : 'badge--gray'}`}>
          {tab.status}
        </span>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>
            {formatMoney(runningTotal)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {tab.payment_method ?? ''}
          </div>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '4px' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px' }}>
          {tab.items && tab.items.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '12px' }}>
              <tbody>
                {tab.items.map(item => (
                  <tr key={item.id}>
                    <td style={{ padding: '3px 0', color: 'var(--text)' }}>
                      {item.quantity}× {item.name_snapshot}
                      {item.note && <span style={{ color: 'var(--text-muted)' }}> · {item.note}</span>}
                    </td>
                    <td style={{ padding: '3px 0', textAlign: 'right', color: 'var(--text)' }}>
                      {formatMoney(item.price_snapshot_cents * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>No items.</p>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
            {tab.subtotal_cents != null && (
              <Row label="Subtotal" value={formatMoney(tab.subtotal_cents)} />
            )}
            {tab.tip_cents > 0 && (
              <Row label="Tip" value={formatMoney(tab.tip_cents)} />
            )}
            {tab.status === 'open'
              ? <Row label="Laufend" value={formatMoney(runningTotal)} bold />
              : tab.total_cents != null && <Row label="Total" value={formatMoney(tab.total_cents)} bold />
            }
            {(tab.tax_standard_cents != null && tab.tax_standard_cents > 0) && (
              <Row label="MwSt. 19 %" value={formatMoney(tab.tax_standard_cents)} muted />
            )}
            {(tab.tax_reduced_cents != null && tab.tax_reduced_cents > 0) && (
              <Row label="MwSt. 7 %" value={formatMoney(tab.tax_reduced_cents)} muted />
            )}
            {tab.payment_method && (
              <Row label="Payment" value={tab.payment_method} muted />
            )}
            {tab.card_masked_pan && (
              <Row label="Card" value={tab.card_masked_pan} muted />
            )}
          </div>

          {tab.notes && (
            <p style={{ marginTop: '10px', fontSize: '13px', color: 'var(--text-muted)' }}>
              Note: {tab.notes}
            </p>
          )}
          {tab.status === 'voided' && tab.void_reason && (
            <p style={{ marginTop: '10px', fontSize: '13px', color: 'var(--danger)' }}>
              Void reason: {tab.void_reason}
            </p>
          )}
          {tab.original_tab_id && (
            <p style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
              Voided from tab #{tab.original_tab_id}
            </p>
          )}

          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {tab.status === 'closed' && (<>
              <button className="btn" style={{ fontSize: '13px', padding: '5px 12px' }} onClick={handlePrint} disabled={printing}>
                {printing ? 'Printing…' : 'Print receipt'}
              </button>
              <button className="btn" style={{ fontSize: '13px', padding: '5px 12px' }} onClick={e => handlePrint(e, true)} disabled={printing}>
                {printing ? 'Printing…' : 'Print + Bewirtung'}
              </button>
              {printMsg && (
                <span style={{ fontSize: '13px', color: printMsg === 'Sent!' ? '#22c55e' : 'var(--danger)' }}>{printMsg}</span>
              )}
            </>)}
            <button
              className="btn btn--ghost"
              style={{ fontSize: '13px', padding: '5px 12px', marginLeft: 'auto' }}
              onClick={toggleActivity}
            >
              {showActivity ? 'Bestellung' : 'Verlauf'}
            </button>
          </div>

          {showActivity && (
            <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              {eventsLoading && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Laden…</p>}
              {events && events.length === 0 && (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Keine Ereignisse.</p>
              )}
              {events && events.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {events.map(e => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px' }}>
                      <ActivityDot type={e.event_type} />
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(e.created_at)}
                      </span>
                      <span style={{ color: 'var(--text)' }}>{describeEvent(e)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: muted ? 'var(--text-muted)' : 'var(--text)', fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
