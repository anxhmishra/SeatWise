const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const insightsEnabled = Boolean(BASE); // the feature needs the backend, so it hides itself without one

async function call(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    let msg = 'Could not load insights right now.';
    try { const j = await res.json(); if (typeof j.detail === 'string') msg = j.detail; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

// Starts a lookup, then checks every 3 s (a live lookup takes ~20-90 s). Cached/seeded answers return immediately.
export async function getInsights(institute, signal, { intervalMs = 3000, maxWaitMs = 120000 } = {}) {
  let r = await call('/api/insights/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ institute }), signal });
  const deadline = Date.now() + maxWaitMs;
  while (r.status === 'pending') {
    if (Date.now() > deadline) throw new Error('This is taking longer than usual. Please try again in a minute.');
    await sleep(intervalMs, signal);
    r = await call(`/api/insights/result/${encodeURIComponent(r.run_id)}`, { signal });
  }
  return r;
}
