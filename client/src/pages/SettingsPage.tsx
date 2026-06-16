import { useState, useEffect } from 'react';
import type { Settings } from '@downtown/shared';
import { settingsApi } from '../api';
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

  useEffect(() => {
    settingsApi.get().then(s => {
      setSettings(s);
      setStandard(toInput(s.pool_rate_standard_cents));
      setPeak(toInput(s.pool_rate_peak_cents));
      setDiscount(toInput(s.pool_rate_daytime_discount_cents));
      setDart(toInput(s.dart_hourly_rate_cents));
    }).catch(console.error);
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

  // Computed preview using current input values
  const s  = standardCents ?? (settings?.pool_rate_standard_cents ?? 1200);
  const p  = peakCents     ?? (settings?.pool_rate_peak_cents ?? 1600);
  const d  = discountCents ?? (settings?.pool_rate_daytime_discount_cents ?? 400);

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

        </div>
      )}
    </div>
  );
}
