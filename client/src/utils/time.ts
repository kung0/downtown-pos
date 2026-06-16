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

export function elapsed(isoUtc: string): string {
  const mins = Math.floor((Date.now() - new Date(isoUtc).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}
