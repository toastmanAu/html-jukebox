import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/plays';
import { recordPlay } from '../src/plays/client';
const demoId = '0x' + 'ab'.repeat(32);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_plays.sql', 'utf8'));
  const env = { PLAYS: { prepare(sql: string) {
    let values: string[] = [];
    const statement = { bind(...args: string[]) { values = args; return statement; }, async run() { return db.prepare(sql).run(...values); }, async first<T>() { return (db.prepare(sql).get(...values) ?? null) as T | null; }, async all<T>() { return { results: db.prepare(sql).all(...values) as T[] }; } };
    return statement;
  } } };
  const call = (request: Request) => onRequest({ request, env });
  const post = (loadId: string, origin = 'https://htmljukebox.online') => call(new Request('https://htmljukebox.online/api/plays', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ demoId, loadId }) }));
  return { db, call, post };
}
afterEach(() => vi.unstubAllGlobals());
describe('shared play counter', () => {
  it('atomically counts distinct loads and ignores concurrent duplicate receipts', async () => {
    const f = fixture();
    try {
      const id = crypto.randomUUID();
      await Promise.all([f.post(id), f.post(id), f.post(id)]);
      expect(await (await f.post(crypto.randomUUID())).json()).toEqual({ plays: 2 });
      const response = await f.call(new Request(`https://htmljukebox.online/api/plays?id=${demoId}&id=0x${'cc'.repeat(32)}`));
      expect(await response.json()).toEqual({ counts: { [demoId]: 2, ['0x' + 'cc'.repeat(32)]: 0 } });
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally { f.db.close(); }
  });
  it('rejects sandbox origins and malformed requests without recording plays', async () => {
    const f = fixture();
    try {
      expect((await f.post(crypto.randomUUID(), 'null')).status).toBe(403);
      expect((await f.post(crypto.randomUUID(), 'https://another.example')).status).toBe(403);
      expect((await f.post('invalid')).status).toBe(400);
      expect((await f.call(new Request('https://htmljukebox.online/api/plays?id=invalid'))).status).toBe(400);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM play_events').get()?.n).toBe(0);
    } finally { f.db.close(); }
  });
  it('returns an actionable unavailable status if storage fails', async () => {
    const response = await onRequest({ request: new Request(`https://htmljukebox.online/api/plays?id=${demoId}`), env: { PLAYS: { prepare() { throw new Error('offline'); } } } });
    expect(response.status).toBe(503);
  });
  it('reuses the exact load ID after a lost response', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(Response.json({ plays: 3 }));
    vi.stubGlobal('fetch', fetcher);
    const id = crypto.randomUUID();
    expect(await recordPlay(demoId, id)).toBe(3);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
});
