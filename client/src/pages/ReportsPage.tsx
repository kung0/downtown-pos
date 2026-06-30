import { useState, useEffect, useCallback } from 'react';
import type { Session, ShiftSummary, Tab, WSMessage } from '@downtown/shared';
import { sessionsApi, exportApi } from '../api';
import { useSession } from '../context/SessionContext';
import { subscribe, subscribeResync } from '../lib/liveUpdates';
import { formatTime } from '../utils/time';
import SummaryBody from '../components/ShiftSummaryView';

// Tab events that change a shift's numbers and so require the summary to refetch.
const TRACKED_TAB_EVENTS = new Set<WSMessage['type']>(['tab:closed', 'tab:voided', 'tab:updated', 'tab:deleted']);

function sessionLabel(s: Session, index: number, total: number): string {
  const num = total - index;
  const start = formatTime(s.opened_at);
  const end = s.closed_at ? formatTime(s.closed_at) : 'open';
  const date = new Date(s.opened_at).toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  return `Schicht #${num} · ${date} · ${start} → ${end}`;
}

export default function ReportsPage() {
  const { session } = useSession();
  const [sessions, setSessions]   = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [summary, setSummary]     = useState<ShiftSummary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [sumLoading, setSumLoading] = useState(false);

  // DSFinV-K export state — default to previous calendar month
  const [exportFrom, setExportFrom] = useState(() => {
    const now = new Date();
    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const m = now.getMonth() === 0 ? 12 : now.getMonth();
    return `${y}-${String(m).padStart(2, '0')}-01`;
  });
  const [exportTo, setExportTo] = useState(() => {
    const now = new Date();
    // last day of previous month = day 0 of current month
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  });
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');

  useEffect(() => {
    setLoading(true);
    sessionsApi.list()
      .then(list => {
        setSessions(list);
        setSelectedId(prev => {
          // keep current selection if it still exists in the refreshed list
          if (prev !== null && list.some(s => s.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session?.id, session?.status]);

  const loadSummary = useCallback((id: number | null, showSpinner = false) => {
    if (!id) { setSummary(null); return; }
    if (showSpinner) setSumLoading(true);
    sessionsApi.summary(id)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setSumLoading(false));
  }, []);

  useEffect(() => { loadSummary(selectedId, true); }, [selectedId, loadSummary]);

  // Keep the summary live: refetch when a tab in the selected shift changes,
  // and after a socket reconnect (which may have missed events while offline).
  useEffect(() => subscribeResync(() => loadSummary(selectedId)), [selectedId, loadSummary]);

  useEffect(() => {
    return subscribe((msg: WSMessage) => {
      if (!selectedId || !TRACKED_TAB_EVENTS.has(msg.type)) return;
      if ((msg.data as Tab)?.session_id === selectedId) loadSummary(selectedId);
    });
  }, [selectedId, loadSummary]);

  if (loading) return <div className="page"><div className="placeholder">Loading…</div></div>;

  if (sessions.length === 0) {
    return (
      <div className="page">
        <div className="page__header"><h1 className="page__title">Reports</h1></div>
        <div className="placeholder">No shifts recorded yet</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Reports</h1>
        <select
          className="field__input"
          style={{ width: 'auto' }}
          value={selectedId ?? ''}
          onChange={e => setSelectedId(Number(e.target.value))}
        >
          {sessions.map((s, i) => (
            <option key={s.id} value={s.id}>
              {sessionLabel(s, i, sessions.length)}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-section" style={{ marginTop: '24px' }}>
        <div className="settings-section__title">DSFinV-K Export</div>
        <div className="settings-section__fields" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
          <div className="field">
            <label className="field__label">Von</label>
            <input
              type="date"
              className="price-input__field"
              style={{ padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '14px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
              value={exportFrom}
              onChange={e => { setExportFrom(e.target.value); setExportErr(''); }}
            />
          </div>
          <div className="field">
            <label className="field__label">Bis</label>
            <input
              type="date"
              className="price-input__field"
              style={{ padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '14px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
              value={exportTo}
              onChange={e => { setExportTo(e.target.value); setExportErr(''); }}
            />
          </div>
        </div>
        <div className="settings-section__footer">
          {exportErr && (
            <span style={{ fontSize: '13px', color: 'var(--danger)' }}>{exportErr}</span>
          )}
          {!exportErr && (
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              ZIP mit Kassenabschluss, Bonkopf, Bonpos u.a.
            </span>
          )}
          <button
            className="btn btn--primary"
            disabled={exporting || !exportFrom || !exportTo}
            onClick={async () => {
              setExporting(true);
              setExportErr('');
              try {
                await exportApi.dsfinvk(exportFrom, exportTo);
              } catch (e) {
                setExportErr((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? 'Exportieren…' : 'Exportieren'}
          </button>
        </div>
      </div>

      {sumLoading ? (
        <div className="placeholder">Loading…</div>
      ) : !summary || summary.tab_count === 0 ? (
        <div className="placeholder">No closed tabs this shift</div>
      ) : (
        <SummaryBody summary={summary} />
      )}
    </div>
  );
}
