// Accepts what people really paste into a dashboard: spaces, quotes, a missing "https://", a trailing slash,
// or a markdown link such as "[https://x.com](https://x.com)". Returns a clean "https://host" (or "").
export function cleanBase(value) {
  let s = String(value || '').trim();
  const md = s.match(/\]\(\s*(https?:\/\/[^)\s]+)\s*\)/i);
  if (md) s = md[1];
  const url = s.match(/https?:\/\/[^\s\])"'<>]+/i);
  if (url) s = url[0];
  s = s.replace(/^[[("'\s]+|[\])"'\s]+$/g, '').replace(/\/+$/, '');
  return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s;
}

const BASE = cleanBase(import.meta.env.VITE_API_URL);
export const insightsEnabled = Boolean(BASE); // the feature needs the backend, so it hides itself without one

async function call(path, options) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, options);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    console.error('[insights] request failed:', e); // technical detail stays in the console
    throw new Error('Could not reach the insights server. Please try again.');
  }
  if (!res.ok) {
    let msg = `Could not load insights right now (error ${res.status}).`; // the number tells you what the server answered
    if (res.status === 405) {
      console.warn('[insights] 405 from', res.url, '- check that VITE_API_URL is your backend address, not this website');
      msg = 'The insights request reached the wrong server (error 405).';
    }
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
