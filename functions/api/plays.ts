// Minimal binding interfaces keep the browser's TypeScript globals unchanged.
interface Statement {
  bind(...values: string[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
}
interface Env { PLAYS: { prepare(sql: string): Statement } }
const demoId = /^0x[0-9a-f]{64}$/;
const loadId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
}
export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(request.url);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    if (request.method === 'GET') {
      const ids = [...new Set(url.searchParams.getAll('id'))];
      if (!ids.length || ids.length > 50 || ids.some(id => !demoId.test(id))) return json({ error: 'INVALID_DEMO_IDS' }, 400);
      const rows = await env.PLAYS.prepare(`SELECT demo_id, plays FROM play_counts WHERE demo_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ demo_id: string; plays: number }>();
      return json({ counts: Object.fromEntries(ids.map(id => [id, rows.results.find(row => row.demo_id === id)?.plays ?? 0])) });
    }
    // The opaque demo sandbox cannot write counters; only the host origin can.
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return json({ error: 'JSON_REQUIRED' }, 415);
    if (Number(request.headers.get('Content-Length') ?? 0) > 512) return json({ error: 'BODY_TOO_LARGE' }, 413);
    const text = await request.text();
    if (text.length > 512) return json({ error: 'BODY_TOO_LARGE' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'INVALID_JSON' }, 400); }
    if (!body || !demoId.test(body.demoId) || !loadId.test(body.loadId)) return json({ error: 'INVALID_PLAY' }, 400);
    // The insert and counter trigger are one atomic operation, including concurrent retries.
    await env.PLAYS.prepare('INSERT INTO play_events (load_id, demo_id) VALUES (?, ?) ON CONFLICT(load_id) DO NOTHING').bind(body.loadId, body.demoId).run();
    const row = await env.PLAYS.prepare('SELECT plays FROM play_counts WHERE demo_id = ?').bind(body.demoId).first<{ plays: number }>();
    return json({ plays: row?.plays ?? 0 });
  } catch { return json({ error: 'PLAY_COUNTS_UNAVAILABLE' }, 503); }
}
