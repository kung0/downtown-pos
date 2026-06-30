import { useState, useEffect, useCallback, useRef } from 'react';
import type { PoolTable, Tab, WaitlistEntry, WSMessage, TableType, BilliardHistoryItem } from '@downtown/shared';
import { poolApi, tabsApi, waitlistApi } from '../api';
import { subscribe, subscribeResync } from '../lib/liveUpdates';
import { formatMoney } from '../utils/money';
import { formatTime } from '../utils/time';

interface Tick { elapsed: number; cost: number; }
interface UndoAction { label: string; undo: () => Promise<void>; redo: () => Promise<void>; }

function fmtElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return 'just started';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface Props { onOpenTab?: (tabId: number) => void; }

export default function PoolPage({ onOpenTab }: Props = {}) {
  const [tables, setTables]       = useState<PoolTable[]>([]);
  const [ticks, setTicks]         = useState<Map<number, Tick>>(new Map());
  const [waitlist, setWaitlist]   = useState<WaitlistEntry[]>([]);
  const [openTabs, setOpenTabs]   = useState<Tab[]>([]);
  const [startingId, setStartingId]   = useState<number | null>(null);
  const [newTabName, setNewTabName]   = useState('');
  const [showNewTab, setShowNewTab]   = useState(false);
  const [creatingTab, setCreatingTab] = useState(false);
  const [stopping, setStopping]       = useState<number | null>(null);
  const [addType, setAddType]                   = useState<TableType>('billiard');
  const [showAdd, setShowAdd]                   = useState(false);
  const [addStep, setAddStep]                   = useState<'tab' | 'pager'>('tab');
  const [addTabId, setAddTabId]                 = useState<number | null>(null);
  const [addTabLabel, setAddTabLabel]           = useState('');
  const [showNewTabForAdd, setShowNewTabForAdd] = useState(false);
  const [newTabNameForAdd, setNewTabNameForAdd] = useState('');
  const [creatingTabForAdd, setCreatingTabForAdd] = useState(false);
  const [pagerInput, setPagerInput]             = useState('');
  const [notesInput, setNotesInput]             = useState('');

  const [tableHistories, setTableHistories]   = useState<Map<number, BilliardHistoryItem[]>>(new Map());
  const [editingStartId, setEditingStartId]   = useState<number | null>(null);
  const [editStartValue, setEditStartValue]   = useState('');

  const undoStack = useRef<UndoAction[]>([]);
  const redoStack = useRef<UndoAction[]>([]);
  const [historyLen, setHistoryLen] = useState({ undo: 0, redo: 0 });

  function pushUndo(action: UndoAction) {
    undoStack.current = [...undoStack.current, action];
    redoStack.current = [];
    setHistoryLen({ undo: undoStack.current.length, redo: 0 });
  }

  const doUndo = useCallback(async () => {
    const action = undoStack.current.at(-1);
    if (!action) return;
    undoStack.current = undoStack.current.slice(0, -1);
    setHistoryLen(h => ({ undo: h.undo - 1, redo: h.redo }));
    try {
      await action.undo();
      redoStack.current = [...redoStack.current, action];
      setHistoryLen(h => ({ undo: h.undo, redo: redoStack.current.length }));
    } catch (e) { alert(`Undo failed: ${(e as Error).message}`); }
  }, []);

  const doRedo = useCallback(async () => {
    const action = redoStack.current.at(-1);
    if (!action) return;
    redoStack.current = redoStack.current.slice(0, -1);
    setHistoryLen(h => ({ undo: h.undo, redo: h.redo - 1 }));
    try {
      await action.redo();
      undoStack.current = [...undoStack.current, action];
      setHistoryLen(h => ({ undo: undoStack.current.length, redo: h.redo }));
    } catch (e) { alert(`Redo failed: ${(e as Error).message}`); }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); doUndo(); }
      else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); doRedo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  const loadTables = useCallback(async () => {
    try {
      const data = await poolApi.list();
      setTables(data);
      data.forEach(t => {
        poolApi.history(t.id)
          .then(h => setTableHistories(prev => new Map(prev).set(t.id, h)))
          .catch(console.error);
      });
    } catch (e) { console.error(e); }
  }, []);

  const loadWaitlist = useCallback(async () => {
    try { setWaitlist(await waitlistApi.list()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadTables(); loadWaitlist(); }, [loadTables, loadWaitlist]);

  useEffect(() => subscribeResync(() => { loadTables(); loadWaitlist(); }), [loadTables, loadWaitlist]);

  useEffect(() => {
    return subscribe((msg: WSMessage) => {
      if (msg.type === 'pool:tick') {
        const d = msg.data as { table_id: number; elapsed_seconds: number; running_cost_cents: number };
        setTicks(prev => new Map(prev).set(d.table_id, { elapsed: d.elapsed_seconds, cost: d.running_cost_cents }));
      } else if (msg.type === 'pool:session_started' || msg.type === 'pool:session_stopped') {
        loadTables();
        if (msg.type === 'pool:session_stopped') {
          const d = msg.data as PoolTable;
          setTicks(prev => { const m = new Map(prev); m.delete(d.id); return m; });
          refreshHistory(d.id);
        }
      } else if (msg.type === 'waitlist:updated') {
        setWaitlist(msg.data as WaitlistEntry[]);
      }
    });
  }, [loadTables]);

  async function handleAdjustStart(tableId: number) {
    try {
      const updated = await poolApi.adjustStart(tableId, editStartValue);
      setTables(prev => prev.map(t => t.id === updated.id ? updated : t));
      setEditingStartId(null);
      if (updated.active_session) {
        const elapsedSecs = Math.max(0, Math.floor(
          (Date.now() - new Date(updated.active_session.started_at).getTime()) / 1000
        ));
        const rate = updated.active_session.hourly_rate_snapshot_cents;
        const cost = Math.ceil((elapsedSecs / 3600) * rate / 50) * 50;
        setTicks(prev => new Map(prev).set(tableId, { elapsed: elapsedSecs, cost }));
      }
    } catch (e) { alert((e as Error).message); }
  }

  function refreshHistory(tableId: number) {
    poolApi.history(tableId)
      .then(data => setTableHistories(prev => new Map(prev).set(tableId, data)))
      .catch(console.error);
  }

  async function openStartModal(tableId: number) {
    try {
      setOpenTabs(await tabsApi.list());
      setNewTabName(''); setShowNewTab(false);
      setStartingId(tableId);
    } catch (e) { console.error(e); }
  }

  async function handleStart(tabId: number) {
    if (startingId === null) return;
    const tableId = startingId;
    try {
      const updated = await poolApi.start(tableId, tabId);
      setTables(prev => prev.map(t => t.id === updated.id ? updated : t));
      setStartingId(null);
      pushUndo({
        label: `Start · ${updated.label}`,
        undo: async () => {
          const r = await poolApi.cancel(tableId);
          setTables(prev => prev.map(t => t.id === r.id ? r : t));
          setTicks(prev => { const m = new Map(prev); m.delete(tableId); return m; });
        },
        redo: async () => {
          const r = await poolApi.start(tableId, tabId);
          setTables(prev => prev.map(t => t.id === r.id ? r : t));
        },
      });
    } catch (e) { alert((e as Error).message); }
  }

  async function handleCreateAndStart() {
    if (!newTabName.trim() || startingId === null || creatingTab) return;
    setCreatingTab(true);
    const tableId = startingId;
    try {
      const tab = await tabsApi.create(newTabName.trim());
      const updated = await poolApi.start(tableId, tab.id);
      setTables(prev => prev.map(t => t.id === updated.id ? updated : t));
      setStartingId(null);
      pushUndo({
        label: `Start · ${updated.label}`,
        undo: async () => {
          const r = await poolApi.cancel(tableId);
          setTables(prev => prev.map(t => t.id === r.id ? r : t));
          setTicks(prev => { const m = new Map(prev); m.delete(tableId); return m; });
        },
        redo: async () => {
          const r = await poolApi.start(tableId, tab.id);
          setTables(prev => prev.map(t => t.id === r.id ? r : t));
        },
      });
    } catch (e) {
      alert((e as Error).message);
    } finally { setCreatingTab(false); }
  }

  async function handleStop(tableId: number) {
    setStopping(tableId);
    const currentTable = tables.find(t => t.id === tableId);
    const tableLabel = currentTable?.label ?? String(tableId);
    try {
      const updated = await poolApi.stop(tableId);
      setTables(prev => prev.map(t => t.id === updated.id ? updated : t));
      setTicks(prev => { const m = new Map(prev); m.delete(tableId); return m; });
      refreshHistory(tableId);
      pushUndo({
        label: `Stop · ${tableLabel}`,
        undo: async () => {
          const r = await poolApi.reopen(tableId);
          setTables(prev => prev.map(t => t.id === r.id ? r : t));
        },
        redo: async () => {
          setStopping(tableId);
          try {
            const r = await poolApi.stop(tableId);
            setTables(prev => prev.map(t => t.id === r.id ? r : t));
            setTicks(prev => { const m = new Map(prev); m.delete(tableId); return m; });
          } finally { setStopping(null); }
        },
      });
    } catch (e) {
      alert((e as Error).message);
    } finally { setStopping(null); }
  }

  function openAddModal() {
    setAddStep('tab');
    setAddTabId(null);
    setAddTabLabel('');
    setShowNewTabForAdd(false);
    setNewTabNameForAdd('');
    setPagerInput('');
    setNotesInput('');
    tabsApi.list().then(setOpenTabs).catch(console.error);
    setShowAdd(true);
  }

  function selectTabForAdd(tab: Tab) {
    setAddTabId(tab.id);
    setAddTabLabel(tab.customer_name);
    setAddStep('pager');
    setShowNewTabForAdd(false);
  }

  async function createTabForAdd() {
    if (!newTabNameForAdd.trim() || creatingTabForAdd) return;
    setCreatingTabForAdd(true);
    try {
      const tab = await tabsApi.create(newTabNameForAdd.trim());
      setOpenTabs(prev => [...prev, tab]);
      selectTabForAdd(tab);
      setNewTabNameForAdd('');
    } catch (e) {
      alert((e as Error).message);
    } finally { setCreatingTabForAdd(false); }
  }

  async function handleAddWaitlist() {
    if (!pagerInput.trim() || addTabId === null) return;
    const entryData = {
      pager_number: pagerInput.trim(),
      type: addType,
      tab_id: addTabId,
      notes: notesInput.trim() || undefined,
    };
    const prev = waitlist.slice();
    try {
      const updated = await waitlistApi.add(
        entryData.pager_number, entryData.type, entryData.tab_id, entryData.notes
      );
      setWaitlist(updated);
      setShowAdd(false);
      const newEntry = updated.find(e => !prev.some(p => p.id === e.id));
      if (newEntry) {
        const ids = { current: newEntry.id };
        pushUndo({
          label: `Add · Pager ${entryData.pager_number}`,
          undo: async () => {
            const r = await waitlistApi.remove(ids.current);
            setWaitlist(r);
          },
          redo: async () => {
            const r = await waitlistApi.add(
              entryData.pager_number, entryData.type, entryData.tab_id, entryData.notes
            );
            setWaitlist(r);
            ids.current = r.reduce((mx, e) => e.id > mx.id ? e : mx).id;
          },
        });
      }
    } catch (e) { alert((e as Error).message); }
  }

  async function handleSeat(entry: WaitlistEntry) {
    if (!entry.tab_id) return;
    const freeTable = tables.find(t => t.type === entry.type && t.status === 'free');
    if (!freeTable) return;
    try {
      const updated = await poolApi.start(freeTable.id, entry.tab_id);
      setTables(prev => prev.map(t => t.id === updated.id ? updated : t));
      setWaitlist(await waitlistApi.remove(entry.id));
    } catch (e) { alert((e as Error).message); }
  }

  async function handleMove(id: number, direction: 'up' | 'down') {
    const entry = waitlist.find(w => w.id === id);
    try {
      const updated = await waitlistApi.move(id, direction);
      setWaitlist(updated);
      pushUndo({
        label: `Move ${direction === 'up' ? '▲' : '▼'} · Pager ${entry?.pager_number ?? id}`,
        undo: async () => {
          const r = await waitlistApi.move(id, direction === 'up' ? 'down' : 'up');
          setWaitlist(r);
        },
        redo: async () => {
          const r = await waitlistApi.move(id, direction);
          setWaitlist(r);
        },
      });
    } catch (e) { alert((e as Error).message); }
  }

  async function handleRemove(id: number) {
    const entry = waitlist.find(w => w.id === id);
    if (!entry) return;
    try {
      const removed = await waitlistApi.remove(id);
      setWaitlist(removed);
      const ids = { current: null as number | null };
      pushUndo({
        label: `Remove · Pager ${entry.pager_number}`,
        undo: async () => {
          const r = await waitlistApi.add(
            entry.pager_number, entry.type, entry.tab_id!, entry.notes ?? undefined
          );
          setWaitlist(r);
          ids.current = r.reduce((mx, e) => e.id > mx.id ? e : mx).id;
        },
        redo: async () => {
          if (ids.current === null) return;
          const r = await waitlistApi.remove(ids.current);
          setWaitlist(r);
          ids.current = null;
        },
      });
    } catch (e) { alert((e as Error).message); }
  }

  const billiardTables   = tables.filter(t => t.type === 'billiard');
  const dartTables       = tables.filter(t => t.type === 'dart');
  const poolWaitlist     = waitlist.filter(e => e.type === 'billiard');
  const dartWaitlist     = waitlist.filter(e => e.type === 'dart');
  const poolHasFree      = billiardTables.some(t => t.status === 'free');
  const dartHasFree      = dartTables.some(t => t.status === 'free');

  function renderTable(table: PoolTable) {
    const busy    = table.status === 'in_use';
    const tick    = ticks.get(table.id);
    const session = table.active_session;
    const items   = tableHistories.get(table.id) ?? [];
    return (
      <div key={table.id} className={`pool-card${busy ? ' pool-card--busy' : ' pool-card--free'}`}>
        <div className="pool-card__header">
          {busy && session?.tab && onOpenTab ? (
            <button className="pool-card__label pool-card__label--link" onClick={() => onOpenTab(session.tab!.id)}>
              {session.tab.customer_name}
            </button>
          ) : (
            <span className="pool-card__label">{busy && session ? session.tab?.customer_name : (table.type === 'dart' ? 'Dart' : 'Billard')}</span>
          )}
          <span className={`pool-card__status pool-card__status--${busy ? 'busy' : 'free'}`}>
            {busy ? 'In use' : 'Free'}
          </span>
        </div>
        {busy && session ? (
          <div className="pool-card__body">
            <div className="pool-card__elapsed">
              {editingStartId === table.id ? (
                <>
                  seit{' '}
                  <input
                    className="pool-card__start-input"
                    type="time"
                    value={editStartValue}
                    onChange={e => setEditStartValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAdjustStart(table.id);
                      if (e.key === 'Escape') setEditingStartId(null);
                    }}
                    autoFocus
                  />
                  <button className="pool-card__start-btn" onClick={() => handleAdjustStart(table.id)}>✓</button>
                  <button className="pool-card__start-btn" onClick={() => setEditingStartId(null)}>✕</button>
                </>
              ) : (
                <>
                  seit{' '}
                  <button
                    className="pool-card__start-time"
                    onClick={() => { setEditStartValue(formatTime(session.started_at)); setEditingStartId(table.id); }}
                  >
                    {formatTime(session.started_at)}
                  </button>
                  {' '}· {fmtElapsed(tick?.elapsed ?? 0)}
                </>
              )}
            </div>
            <div className="pool-card__cost">{formatMoney(tick?.cost ?? 0)}</div>
          </div>
        ) : (
          <div className="pool-card__body pool-card__body--free" />
        )}
        <div className="pool-card__footer">
          {busy ? (
            <button
              className="btn btn--danger"
              style={{ width: '100%' }}
              onClick={() => handleStop(table.id)}
              disabled={stopping === table.id}
            >
              {stopping === table.id ? 'Stopping…' : 'Stop & charge'}
            </button>
          ) : (
            <button className="btn btn--primary" style={{ width: '100%' }} onClick={() => openStartModal(table.id)}>
              Start session
            </button>
          )}
        </div>
        {items.length > 0 && (
          <div className="pool-history">
            {items.map(item => {
              const durationSecs = Math.floor(
                (new Date(item.ended_at).getTime() - new Date(item.started_at).getTime()) / 1000
              );
              return (
                <div key={item.id} className="pool-history__item">
                  <div className="pool-history__row">
                    {onOpenTab ? (
                      <button className="pool-history__name" onClick={() => onOpenTab(item.tab_id)}>
                        {item.tab_customer_name}
                      </button>
                    ) : (
                      <span className="pool-history__name pool-history__name--plain">{item.tab_customer_name}</span>
                    )}
                    <span className="pool-history__price">{formatMoney(item.computed_cost_cents)}</span>
                  </div>
                  <div className="pool-history__meta">
                    {formatTime(item.started_at)} – {formatTime(item.ended_at)} · {fmtElapsed(durationSecs)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Pool & Dart</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn--ghost btn--sm" onClick={doUndo} disabled={historyLen.undo === 0} title={`Undo: ${undoStack.current.at(-1)?.label ?? ''} (Ctrl+Z)`}>
            ↩ Undo{historyLen.undo > 0 ? ` · ${undoStack.current.at(-1)?.label}` : ''}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={doRedo} disabled={historyLen.redo === 0} title="Redo (Ctrl+Y / Ctrl+Shift+Z)">
            Redo ↪{historyLen.redo > 0 ? ` · ${redoStack.current.at(-1)?.label}` : ''}
          </button>
        </div>
      </div>

      <div className="pool-layout">
        {/* ── Table sections ─────────────────────────────────── */}
        <div className="pool-main">
          {billiardTables.length > 0 && (
            <div className="pool-section">
              <div className="pool-section__label">Pool</div>
              <div className="pool-grid">{billiardTables.map(renderTable)}</div>
            </div>
          )}
          {dartTables.length > 0 && (
            <div className="pool-section">
              <div className="pool-section__label">Dart</div>
              <div className="pool-grid">{dartTables.map(renderTable)}</div>
            </div>
          )}
        </div>

        {/* ── Waitlist panel ──────────────────────────────────── */}
        <div className="waitlist-panel">
          <div className="waitlist-panel__header">
            <span className="waitlist-panel__title">
              Waiting list{waitlist.length > 0 ? ` (${waitlist.length})` : ''}
            </span>
            <button className="btn btn--primary btn--sm" onClick={openAddModal}>+ Add</button>
          </div>

          <div className="waitlist-list">
            {(['billiard', 'dart'] as TableType[]).map(type => {
              const entries = type === 'billiard' ? poolWaitlist : dartWaitlist;
              const hasFree = type === 'billiard' ? poolHasFree : dartHasFree;
              return (
                <div key={type}>
                  <div className="waitlist-section-label">{type === 'billiard' ? 'Pool' : 'Dart'}</div>
                  {hasFree && entries.length > 0 && (
                    <div className="waitlist-alert">
                      Free! Call pager <strong>#{entries[0].pager_number}</strong>
                    </div>
                  )}
                  {entries.length === 0 ? (
                    <p className="waitlist-empty">No one waiting</p>
                  ) : entries.map((e, i) => (
                    <div key={e.id} className={`waitlist-entry${e.status === 'called' ? ' waitlist-entry--called' : ''}`}>
                      <div className="waitlist-entry__top">
                        <span className="waitlist-entry__pos">#{i + 1}</span>
                        <span className="waitlist-entry__pager">Pager {e.pager_number}</span>
                        <span className="waitlist-entry__time">{formatTime(e.created_at)}</span>
                      </div>
                      {(e.tab || e.notes) && (
                        <div className="waitlist-entry__sub">
                          {e.tab && onOpenTab ? (
                          <button className="waitlist-entry__tab-link" onClick={() => onOpenTab(e.tab_id!)}>
                            {e.tab.customer_name}
                          </button>
                        ) : e.tab && (
                          <span>{e.tab.customer_name}</span>
                        )}
                          {e.notes && <span className="waitlist-entry__note">{e.notes}</span>}
                        </div>
                      )}
                      <div className="waitlist-entry__actions">
                        <div className="waitlist-entry__reorder">
                          <button
                            className="btn btn--ghost btn--sm btn--icon"
                            onClick={() => handleMove(e.id, 'up')}
                            disabled={i === 0}
                            title="Move up"
                          >▲</button>
                          <button
                            className="btn btn--ghost btn--sm btn--icon"
                            onClick={() => handleMove(e.id, 'down')}
                            disabled={i === entries.length - 1}
                            title="Move down"
                          >▼</button>
                        </div>
                        {(() => {
                          const freeTable = tables.find(t => t.type === e.type && t.status === 'free');
                          const title = !freeTable
                            ? 'No free table available'
                            : e.type === 'dart' ? 'Move to dart board' : 'Move to pool table';
                          return (
                            <button
                              className="btn btn--primary btn--sm btn--icon"
                              onClick={() => handleSeat(e)}
                              disabled={!freeTable || !e.tab_id}
                              title={title}
                            >
                              ✅
                            </button>
                          );
                        })()}
                        <button className="btn btn--ghost btn--sm btn--icon waitlist-entry__remove" onClick={() => handleRemove(e.id)} title="Remove">
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Start session modal ──────────────────────────────── */}
      {startingId !== null && (
        <div className="modal-overlay" onClick={() => setStartingId(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Start — {tables.find(t => t.id === startingId)?.label}</h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setStartingId(null)}>✕</button>
            </div>
            {showNewTab ? (
              <div className="modal__body">
                <div className="field">
                  <label className="field__label">Customer name</label>
                  <input
                    className="field__input"
                    placeholder='"Lukas + friends"'
                    value={newTabName}
                    onChange={e => setNewTabName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateAndStart()}
                    autoFocus
                  />
                </div>
                <div className="modal__footer" style={{ padding: 0, marginTop: 12 }}>
                  <button className="btn btn--ghost" onClick={() => setShowNewTab(false)}>← Back</button>
                  <button className="btn btn--primary" onClick={handleCreateAndStart} disabled={creatingTab || !newTabName.trim()}>
                    {creatingTab ? 'Opening…' : 'Open tab & start'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ paddingBottom: 4 }}>
                <button className="tab-pick-btn tab-pick-btn--new" onClick={() => setShowNewTab(true)}>
                  <span className="tab-pick-btn__name">+ New tab</span>
                </button>
                {openTabs.map(t => (
                  <button key={t.id} className="tab-pick-btn" onClick={() => handleStart(t.id)}>
                    <span className="tab-pick-btn__name">{t.customer_name}</span>
                    <span className="tab-pick-btn__meta">{formatMoney(t.running_total_cents ?? 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add to waitlist modal ────────────────────────────── */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">
                {addStep === 'tab' ? 'Add to waiting list — pick tab' : `Waiting list — ${addTabLabel}`}
              </h2>
              <button className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowAdd(false)}>✕</button>
            </div>

            {addStep === 'tab' ? (
              /* Step 1: pick or create tab */
              <div style={{ paddingBottom: 4 }}>
                {showNewTabForAdd ? (
                  <div className="modal__body">
                    <div className="field">
                      <label className="field__label">Customer name</label>
                      <input
                        className="field__input"
                        placeholder='"Lukas + friends"'
                        value={newTabNameForAdd}
                        onChange={e => setNewTabNameForAdd(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && createTabForAdd()}
                        autoFocus
                      />
                    </div>
                    <div className="modal__footer" style={{ padding: 0, marginTop: 12 }}>
                      <button className="btn btn--ghost" onClick={() => setShowNewTabForAdd(false)}>← Back</button>
                      <button className="btn btn--primary" onClick={createTabForAdd} disabled={creatingTabForAdd || !newTabNameForAdd.trim()}>
                        {creatingTabForAdd ? 'Creating…' : 'Create tab'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button className="tab-pick-btn tab-pick-btn--new" onClick={() => setShowNewTabForAdd(true)}>
                      <span className="tab-pick-btn__name">+ New tab</span>
                    </button>
                    {openTabs.length === 0 ? (
                      <p style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                        No open tabs yet.
                      </p>
                    ) : openTabs.map(t => (
                      <button key={t.id} className="tab-pick-btn" onClick={() => selectTabForAdd(t)}>
                        <span className="tab-pick-btn__name">{t.customer_name}</span>
                        <span className="tab-pick-btn__meta">{formatMoney(t.running_total_cents ?? 0)}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : (
              /* Step 2: pager + type + notes */
              <div className="modal__body">
                <div className="field">
                  <label className="field__label">For</label>
                  <div className="pay-method-row">
                    <button className={`pay-method-btn${addType === 'billiard' ? ' pay-method-btn--active' : ''}`} onClick={() => setAddType('billiard')}>Pool</button>
                    <button className={`pay-method-btn${addType === 'dart' ? ' pay-method-btn--active' : ''}`} onClick={() => setAddType('dart')}>Dart</button>
                  </div>
                </div>
                <div className="field">
                  <label className="field__label">Pager number *</label>
                  <input
                    className="field__input"
                    placeholder="z.B. 42"
                    value={pagerInput}
                    onChange={e => setPagerInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddWaitlist()}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label className="field__label">Notes (optional)</label>
                  <input
                    className="field__input"
                    placeholder="z.B. Gruppe von 4"
                    value={notesInput}
                    onChange={e => setNotesInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddWaitlist()}
                  />
                </div>
                <div className="modal__footer" style={{ padding: 0, marginTop: 12 }}>
                  <button className="btn btn--ghost" onClick={() => setAddStep('tab')}>← Back</button>
                  <button className="btn btn--primary" onClick={handleAddWaitlist} disabled={!pagerInput.trim()}>
                    Add to list
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
