export function formatTime(isoUtc: string): string {
  return new Date(isoUtc).toLocaleTimeString('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatDateTime(isoUtc: string): string {
  return new Date(isoUtc).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Clock time (HH:mm) when the timestamp falls on today in Berlin; otherwise the
// full date + time, so a tab left open/parked across days reads unambiguously.
export function openedAtLabel(isoUtc: string): string {
  const berlinDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  return berlinDay(new Date(isoUtc)) === berlinDay(new Date())
    ? formatTime(isoUtc)
    : formatDateTime(isoUtc);
}

export function elapsed(isoUtc: string): string {
  const mins = Math.floor((Date.now() - new Date(isoUtc).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}
