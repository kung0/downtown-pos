import { useState, useEffect } from 'react';
import type { Settings, OrderPrinter, Category } from '@downtown/shared';
import { settingsApi, printerApi, categoriesApi } from '../api';
import { formatMoney } from '../utils/money';

function parseRate(s: string): number | null {
  const v = parseFloat(s.trim().replace(',', '.'));
  if (isNaN(v) || v < 0) return null;
  return Math.round(v * 100);
}

function toInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function RateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <div className="price-input">
        <span className="price-input__prefix">€</span>
        <input
          className="price-input__field"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <span className="price-input__prefix" style={{ borderLeft: '1.5px solid var(--border)', borderRight: 'none' }}>/ h</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings]     = useState<Settings | null>(null);
  const [standard, setStandard]     = useState('');
  const [peak, setPeak]             = useState('');
  const [discount, setDiscount]     = useState('');
  const [dart, setDart]             = useState('');
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);

  // printer state
  const [printerIp, setPrinterIp]         = useState('');
  const [autoPrint, setAutoPrint]         = useState(false);
  const [printerStatus, setPrinterStatus] = useState<{ configured: boolean; ip?: string; online: boolean } | null>(null);
  const [savingPrinter, setSavingPrinter] = useState(false);
  const [savedPrinter, setSavedPrinter]   = useState(false);
  const [testing, setTesting]             = useState(false);
  const [testMsg, setTestMsg]             = useState('');

  // order printers state
  const [orderPrinters,        setOrderPrinters]        = useState<OrderPrinter[]>([]);
  const [parentCategories,     setParentCategories]     = useState<Category[]>([]);
  const [savingOrderPrinters,  setSavingOrderPrinters]  = useState(false);
  const [savedOrderPrinters,   setSavedOrderPrinters]   = useState(false);

  // DSFinV-K state
  const [dsfKassenId,      setDsfKassenId]      = useState('');
  const [dsfBetreiber,     setDsfBetreiber]      = useState('');
  const [dsfStrasse,       setDsfStrasse]        = useState('');
  const [dsfPlz,           setDsfPlz]            = useState('');
  const [dsfOrt,           setDsfOrt]            = useState('');
  const [dsfLand,          setDsfLand]           = useState('DE');
  const [dsfStnr,          setDsfStnr]           = useState('');
  const [dsfUstid,         setDsfUstid]          = useState('');
  const [savingDsf,        setSavingDsf]         = useState(false);
  const [savedDsf,         setSavedDsf]          = useState(false);

  useEffect(() => {
    settingsApi.get().then(s => {
      setSettings(s);
      setStandard(toInput(s.pool_rate_standard_cents));
      setPeak(toInput(s.pool_rate_peak_cents));
      setDiscount(toInput(s.pool_rate_daytime_discount_cents));
      setDart(toInput(s.dart_hourly_rate_cents));
      setPrinterIp(s.printer_ip ?? '');
      setAutoPrint(s.printer_auto_print ?? false);
      setOrderPrinters(s.printer_order_printers ?? []);
      setDsfKassenId(s.dsfinvk_kassen_id ?? 'DOWNTOWN-001');
      setDsfBetreiber(s.dsfinvk_betreiber_name ?? '');
      setDsfStrasse(s.dsfinvk_strasse ?? '');
      setDsfPlz(s.dsfinvk_plz ?? '');
      setDsfOrt(s.dsfinvk_ort ?? '');
      setDsfLand(s.dsfinvk_land ?? 'DE');
      setDsfStnr(s.dsfinvk_stnr ?? '');
      setDsfUstid(s.dsfinvk_ustid ?? '');
    }).catch(console.error);

    printerApi.status().then(setPrinterStatus).catch(console.error);
    categoriesApi.list().then(cats => setParentCategories(cats.filter(c => c.parent_id === null))).catch(console.error);
  }, []);

  const standardCents = parseRate(standard);
  const peakCents     = parseRate(peak);
  const discountCents = parseRate(discount);
  const dartCents     = parseRate(dart);

  const dirty = settings !== null && (
    standardCents !== settings.pool_rate_standard_cents ||
    peakCents     !== settings.pool_rate_peak_cents ||
    discountCents !== settings.pool_rate_daytime_discount_cents ||
    dartCents     !== settings.dart_hourly_rate_cents
  );

  async function handleSave() {
    if (standardCents === null || peakCents === null || discountCents === null || dartCents === null) return;
    setSaving(true);
    try {
      const updated = await settingsApi.update({
        pool_rate_standard_cents: standardCents,
        pool_rate_peak_cents: peakCents,
        pool_rate_daytime_discount_cents: discountCents,
        dart_hourly_rate_cents: dartCents,
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePrinter() {
    setSavingPrinter(true);
    try {
      const updated = await settingsApi.update({ printer_ip: printerIp.trim(), printer_auto_print: autoPrint });
      setSettings(updated);
      setSavedPrinter(true);
      setTimeout(() => setSavedPrinter(false), 2000);
      const status = await printerApi.status();
      setPrinterStatus(status);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSavingPrinter(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg('');
    try {
      await printerApi.test();
      setTestMsg('Test page sent!');
    } catch (e) {
      setTestMsg((e as Error).message);
    } finally {
      setTesting(false);
      setTimeout(() => setTestMsg(''), 4000);
    }
  }

  async function handleSaveOrderPrinters() {
    setSavingOrderPrinters(true);
    try {
      const updated = await settingsApi.update({ printer_order_printers: orderPrinters });
      setSettings(updated);
      setOrderPrinters(updated.printer_order_printers ?? []);
      setSavedOrderPrinters(true);
      setTimeout(() => setSavedOrderPrinters(false), 2000);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSavingOrderPrinters(false);
    }
  }

  async function handleSaveDsf() {
    setSavingDsf(true);
    try {
      const updated = await settingsApi.update({
        dsfinvk_kassen_id:      dsfKassenId.trim(),
        dsfinvk_betreiber_name: dsfBetreiber.trim(),
        dsfinvk_strasse:        dsfStrasse.trim(),
        dsfinvk_plz:            dsfPlz.trim(),
        dsfinvk_ort:            dsfOrt.trim(),
        dsfinvk_land:           dsfLand.trim(),
        dsfinvk_stnr:           dsfStnr.trim(),
        dsfinvk_ustid:          dsfUstid.trim(),
      });
      setSettings(updated);
      setSavedDsf(true);
      setTimeout(() => setSavedDsf(false), 2000);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSavingDsf(false);
    }
  }

  const dsfDirty = settings !== null && (
    dsfKassenId  !== (settings.dsfinvk_kassen_id      ?? 'DOWNTOWN-001') ||
    dsfBetreiber !== (settings.dsfinvk_betreiber_name ?? '') ||
    dsfStrasse   !== (settings.dsfinvk_strasse        ?? '') ||
    dsfPlz       !== (settings.dsfinvk_plz            ?? '') ||
    dsfOrt       !== (settings.dsfinvk_ort            ?? '') ||
    dsfLand      !== (settings.dsfinvk_land           ?? 'DE') ||
    dsfStnr      !== (settings.dsfinvk_stnr           ?? '') ||
    dsfUstid     !== (settings.dsfinvk_ustid          ?? '')
  );

  const s  = standardCents ?? (settings?.pool_rate_standard_cents ?? 1200);
  const p  = peakCents     ?? (settings?.pool_rate_peak_cents ?? 1600);
  const d  = discountCents ?? (settings?.pool_rate_daytime_discount_cents ?? 400);

  const printerDirty = settings !== null && (
    printerIp.trim() !== (settings.printer_ip ?? '') ||
    autoPrint !== (settings.printer_auto_print ?? false)
  );

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Settings</h1>
      </div>

      {!settings ? (
        <div className="placeholder">Loading…</div>
      ) : (
        <div className="settings-body">

          <div className="settings-section">
            <div className="settings-section__title">Pool — hourly rates</div>
            <div className="settings-section__fields">
              <RateField label="Standard (Mo–Do, So after 17:00)" value={standard} onChange={v => { setStandard(v); setSaved(false); }} />
              <RateField label="Peak (Fr + Sa after 17:00)" value={peak} onChange={v => { setPeak(v); setSaved(false); }} />
              <RateField label="Daytime discount (before 17:00)" value={discount} onChange={v => { setDiscount(v); setSaved(false); }} />
            </div>

            <table className="settings-rate-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Before 17:00</th>
                  <th>After 17:00</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Mo–Do, So</td>
                  <td>{formatMoney(s - d)}</td>
                  <td>{formatMoney(s)}</td>
                </tr>
                <tr>
                  <td>Fr + Sa</td>
                  <td>{formatMoney(p - d)}</td>
                  <td>{formatMoney(p)}</td>
                </tr>
              </tbody>
            </table>

            <div className="settings-section__footer">
              <span />
              <button
                className="btn btn--primary"
                onClick={handleSave}
                disabled={saving || !dirty || standardCents === null || peakCents === null || discountCents === null}
              >
                {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">Dart — hourly rate</div>
            <div className="settings-section__fields">
              <RateField label="Flat rate" value={dart} onChange={v => { setDart(v); setSaved(false); }} />
            </div>
            <div className="settings-section__footer">
              <span />
              <button
                className="btn btn--primary"
                onClick={handleSave}
                disabled={saving || !dirty || dartCents === null}
              >
                {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">Printer — Epson TM-M30 III</div>

            <div className="settings-section__fields">
              <div className="field">
                <label className="field__label">Printer IP address</label>
                <input
                  type="text"
                  className="price-input__field"
                  style={{ padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', width: '200px', fontFamily: 'monospace', fontSize: '14px', background: 'var(--surface)', color: 'var(--text)' }}
                  placeholder="192.168.1.100"
                  value={printerIp}
                  onChange={e => { setPrinterIp(e.target.value); setSavedPrinter(false); }}
                />
              </div>

              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="auto-print"
                  checked={autoPrint}
                  onChange={e => { setAutoPrint(e.target.checked); setSavedPrinter(false); }}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="auto-print" className="field__label" style={{ marginBottom: 0, cursor: 'pointer' }}>
                  Auto-print receipt on tab close
                </label>
              </div>
            </div>

            {printerStatus && (
              <div style={{ marginTop: '10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
                  background: !printerStatus.configured ? 'var(--text-muted)' : printerStatus.online ? '#22c55e' : '#ef4444',
                }} />
                <span style={{ color: 'var(--text-muted)' }}>
                  {!printerStatus.configured ? 'No IP configured' : printerStatus.online ? `Online · ${printerStatus.ip}` : `Offline · ${printerStatus.ip}`}
                </span>
              </div>
            )}

            <div className="settings-section__footer">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  className="btn"
                  onClick={handleTest}
                  disabled={testing || !printerIp.trim()}
                  title="Print a test page"
                >
                  {testing ? 'Printing…' : 'Test print'}
                </button>
                {testMsg && (
                  <span style={{ fontSize: '13px', color: testMsg.includes('!') ? '#22c55e' : 'var(--danger)' }}>
                    {testMsg}
                  </span>
                )}
              </div>
              <button
                className="btn btn--primary"
                onClick={handleSavePrinter}
                disabled={savingPrinter || !printerDirty}
              >
                {savingPrinter ? 'Saving…' : savedPrinter ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">Order Printers</div>
            <div className="settings-section__fields" style={{ gap: 16 }}>
              {orderPrinters.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  No order printers configured — all order tickets print to the receipt printer above.
                </p>
              )}
              {orderPrinters.map((op, idx) => (
                <div key={op.id} style={{ border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      type="text"
                      className="price-input__field"
                      placeholder="Name (e.g. Kitchen)"
                      value={op.name}
                      onChange={e => setOrderPrinters(prev => prev.map((p, i) => i === idx ? { ...p, name: e.target.value } : p))}
                      style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', width: 160, fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                    />
                    <input
                      type="text"
                      className="price-input__field"
                      placeholder="192.168.1.101"
                      value={op.ip}
                      onChange={e => setOrderPrinters(prev => prev.map((p, i) => i === idx ? { ...p, ip: e.target.value } : p))}
                      style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', width: 150, fontFamily: 'monospace', fontSize: 14, background: 'var(--surface)', color: 'var(--text)' }}
                    />
                    <button
                      className="btn"
                      style={{ marginLeft: 'auto', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => setOrderPrinters(prev => prev.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                    {parentCategories.map(cat => (
                      <label key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={op.category_ids.includes(cat.id)}
                          onChange={e => setOrderPrinters(prev => prev.map((p, i) => {
                            if (i !== idx) return p;
                            const ids = e.target.checked
                              ? [...p.category_ids, cat.id]
                              : p.category_ids.filter(id => id !== cat.id);
                            return { ...p, category_ids: ids };
                          }))}
                          style={{ width: 14, height: 14, cursor: 'pointer' }}
                        />
                        {cat.name}
                      </label>
                    ))}
                  </div>
                  {parentCategories.length > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                      Checked categories and all their subcategories will print here.
                    </p>
                  )}
                </div>
              ))}
              <button
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setOrderPrinters(prev => [...prev, { id: String(Date.now()), name: '', ip: '', category_ids: [] }])}
              >
                + Add printer
              </button>
            </div>
            <div className="settings-section__footer">
              <span />
              <button
                className="btn btn--primary"
                onClick={handleSaveOrderPrinters}
                disabled={savingOrderPrinters}
              >
                {savingOrderPrinters ? 'Saving…' : savedOrderPrinters ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">DSFinV-K — Exportkonfiguration</div>
            <div className="settings-section__fields">
              {[
                { label: 'Kassennummer',    value: dsfKassenId,  onChange: setDsfKassenId,  placeholder: 'DOWNTOWN-001' },
                { label: 'Betreiber',       value: dsfBetreiber, onChange: setDsfBetreiber, placeholder: 'Downtown GmbH' },
                { label: 'Straße',          value: dsfStrasse,   onChange: setDsfStrasse,   placeholder: 'Musterstraße 1' },
                { label: 'PLZ',             value: dsfPlz,       onChange: setDsfPlz,       placeholder: '64293' },
                { label: 'Ort',             value: dsfOrt,       onChange: setDsfOrt,       placeholder: 'Darmstadt' },
                { label: 'Land',            value: dsfLand,      onChange: setDsfLand,      placeholder: 'DE' },
                { label: 'Steuernummer',    value: dsfStnr,      onChange: setDsfStnr,      placeholder: '007 815 08765' },
                { label: 'USt-IdNr.',       value: dsfUstid,     onChange: setDsfUstid,     placeholder: 'DE123456789 (optional)' },
              ].map(({ label, value, onChange, placeholder }) => (
                <div className="field" key={label}>
                  <label className="field__label">{label}</label>
                  <input
                    type="text"
                    className="price-input__field"
                    style={{ padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', width: '260px', fontSize: '14px', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
                    placeholder={placeholder}
                    value={value}
                    onChange={e => { onChange(e.target.value); setSavedDsf(false); }}
                  />
                </div>
              ))}
            </div>
            <div className="settings-section__footer">
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Angaben erscheinen in jedem DSFinV-K-Export
              </span>
              <button
                className="btn btn--primary"
                onClick={handleSaveDsf}
                disabled={savingDsf || !dsfDirty}
              >
                {savingDsf ? 'Speichern…' : savedDsf ? 'Gespeichert!' : 'Speichern'}
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
