function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid play count');
  return value;
}
export async function readPlayCounts(ids: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const response = await fetch(`/api/plays?${new URLSearchParams(batch.map(id => ['id', id]))}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Play counts unavailable');
    const data = await response.json();
    for (const id of batch) counts[id] = count(data.counts?.[id]);
  }
  return counts;
}
export async function recordPlay(demoId: string, loadId: string): Promise<number> {
  // A retry reuses the same ID, even if the first request reached the server.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch('/api/plays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demoId, loadId }), signal: AbortSignal.timeout(8000), keepalive: true });
      if (!response.ok) throw new Error('Play count could not be saved');
      return count((await response.json()).plays);
    } catch (error) { if (attempt >= 1) throw error; }
  }
}
export function playLabel(value: number | undefined): string {
  return value === undefined ? 'PLAYS —' : `${value.toLocaleString()} ${value === 1 ? 'PLAY' : 'PLAYS'}`;
}
