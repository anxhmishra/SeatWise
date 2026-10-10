import React, { useEffect, useRef, useState } from 'react';
import { getInsights, insightsEnabled } from '../utils/insights';
import { instituteType } from '../utils/instituteTypes';
import '../styles/insights.css';

const memo = new Map(); // reopening a card never calls the server twice in one visit
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const ROWS = [
  ['Tuition / year', 'tuition_fee_per_year_inr', inr],
  ['Total course fee', 'total_course_fee_inr', inr],
  ['Median package', 'median_package_lpa', (v) => `${v} LPA`],
  ['Average package', 'average_package_lpa', (v) => `${v} LPA`],
  ['Highest package', 'highest_package_lpa', (v) => `${v} LPA`],
  ['Placed', 'placement_percent', (v) => `${v}%`],
  ['NIRF (Engineering)', 'nirf_engineering_rank', (v) => `#${v}`],
];

// Typical ranges for this kind of institute. Always labelled as an estimate, never as this college's data.
function Estimate({ institute }) {
  const t = instituteType(institute);
  return (
    <div className="insights-estimate">
      <p className="insights-estimate-head"><span className="insights-badge">Estimate</span> Typical for {t.label}, not specific to this college</p>
      <dl className="insights-grid">
        <dt>Average package</dt><dd>{t.avg}</dd>
        <dt>Highest package</dt><dd>{t.highest}</dd>
        <dt>Total course fee</dt><dd>{t.fees}</dd>
      </dl>
      <p className="insights-note">Rough ranges only. Actual figures vary by college and branch: check the official placement report.</p>
    </div>
  );
}

// The button and the popover are direct children of the parent ".action-group".
export default function InstituteInsights({ institute, slowAfterMs = 25000 }) {
  const [open, setOpen] = useState(false);
  const [slow, setSlow] = useState(false); // true once the live lookup has taken longer than slowAfterMs
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const ctrl = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => { ctrl.current?.abort(); clearTimeout(timer.current); }, []);
  if (!insightsEnabled) return null;

  const load = async () => {
    if (memo.has(institute)) return setState({ status: 'done', data: memo.get(institute), error: '' });
    setState({ status: 'loading', data: null, error: '' });
    setSlow(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSlow(true), slowAfterMs);
    ctrl.current = new AbortController();
    try {
      const data = await getInsights(institute, ctrl.current.signal);
      if (data.status === 'failed') return setState({ status: 'error', data: null, error: 'Live data could not be read for this institute right now.' });
      memo.set(institute, data);
      setState({ status: 'done', data, error: '' });
    } catch (e) {
      if (e.name !== 'AbortError') setState({ status: 'error', data: null, error: e.message });
    } finally { clearTimeout(timer.current); }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.status !== 'loading' && state.status !== 'done') load();
  };

  const { status, data, error } = state;
  const d = data?.data || {};
  const rows = ROWS.filter(([, key]) => d[key] != null);
  const hasLive = rows.length > 0 || d.top_recruiters?.length > 0;
  return (
    <>
      <button type="button" className={`insights-toggle${open ? ' open' : ''}`} aria-expanded={open} onClick={toggle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M6 20V11M12 20V4M18 20v-6" />
        </svg>
        {open ? 'Hide Insights' : 'Fees & Placements'}
      </button>
      {open && (
        <div className="insights-panel" role="region" aria-label={`Fees and placements for ${institute}`} aria-live="polite">
          {status === 'loading' && (
            <>
              <p className="insights-muted">{slow ? 'Still checking official sources… typical figures shown meanwhile.' : 'Reading official sources… a live lookup can take up to a minute.'}</p>
              {slow && <Estimate institute={institute} />}
            </>
          )}
          {status === 'error' && (
            <>
              <p className="insights-error">{error} <button type="button" className="insights-link" onClick={load}>Retry</button></p>
              <Estimate institute={institute} />
            </>
          )}
          {status === 'done' && !hasLive && (
            <>
              <p className="insights-muted">No reliable official figures found for this institute.</p>
              <Estimate institute={institute} />
            </>
          )}
          {status === 'done' && hasLive && (
            <>
              <dl className="insights-grid">
                {rows.map(([label, key, fmt]) => (<React.Fragment key={key}><dt>{label}</dt><dd>{fmt(d[key])}</dd></React.Fragment>))}
                {d.data_year && (<><dt>Data year</dt><dd>{d.data_year}</dd></>)}
                {d.top_recruiters?.length > 0 && (<><dt>Top recruiters</dt><dd>{d.top_recruiters.join(', ')}</dd></>)}
              </dl>
              <p className="insights-note">
                Extracted automatically by TinyFish
                {data.source_url && <> from <a href={data.source_url} target="_blank" rel="noopener noreferrer">{data.source_title || 'the source page'}</a></>}
                {data.fetched_at && <> on {new Date(data.fetched_at).toLocaleDateString('en-IN')}</>}. Verify on the official site before deciding.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
