import React, { useEffect, useRef, useState } from 'react';
import { getInsights, insightsEnabled } from '../utils/insights';
import { instituteType } from '../utils/instituteTypes';
import '../styles/insights.css';

const memo = new Map(); // a college you already looked up opens instantly again during this visit
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

function Tiles({ items }) {
  return (
    <dl className="insights-tiles">
      {items.map(([label, value, wide]) => (
        <div key={label} className={`insights-tile${wide ? ' wide' : ''}`}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

// Typical ranges for this kind of institute. Always labelled as an estimate, never as this college's data.
function Estimate({ institute }) {
  const t = instituteType(institute);
  return (
    <div className="insights-estimate">
      <p className="insights-estimate-head"><span className="insights-badge">Estimate</span> Typical for {t.label}, not specific to this college</p>
      <Tiles items={[['Average package', t.avg], ['Highest package', t.highest], ['Total course fee', t.fees]]} />
      <p className="insights-note">Rough ranges only. Actual figures vary by college and branch: check the official placement report.</p>
    </div>
  );
}

// The toggle button, shown in the Action column.
export function InsightsButton({ open, onToggle, controls }) {
  if (!insightsEnabled) return null;
  return (
    <button type="button" className={`insights-btn${open ? ' open' : ''}`} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <path d="M6 20V11M12 20V4M18 20v-6" />
      </svg>
      {open ? 'Hide Insights' : 'Fees & Placements'}
    </button>
  );
}

// A full-width row that opens directly under the result row. It starts the lookup when it appears.
export function InsightsRow({ id, institute, colSpan = 5, slowAfterMs = 25000 }) {
  const [slow, setSlow] = useState(false); // true once the live lookup has taken longer than slowAfterMs
  const [state, setState] = useState(() => (memo.has(institute) ? { status: 'done', data: memo.get(institute), error: '' } : { status: 'loading', data: null, error: '' }));
  const ctrl = useRef(null);
  const timer = useRef(null);

  const load = async () => {
    if (memo.has(institute)) return setState({ status: 'done', data: memo.get(institute), error: '' });
    setState({ status: 'loading', data: null, error: '' });
    setSlow(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSlow(true), slowAfterMs);
    ctrl.current?.abort();
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

  useEffect(() => {
    if (state.status === 'loading') load();
    return () => { ctrl.current?.abort(); clearTimeout(timer.current); }; // closing the row stops the lookup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { status, data, error } = state;
  const d = data?.data || {};
  const live = ROWS.filter(([, key]) => d[key] != null).map(([label, key, fmt]) => [label, fmt(d[key])]);
  if (d.data_year) live.push(['Data year', d.data_year]);
  if (d.top_recruiters?.length > 0) live.push(['Top recruiters', d.top_recruiters.join(', '), true]);
  const hasLive = live.length > (d.data_year ? 1 : 0);

  return (
    <tr className="insights-row" id={id}>
      <td colSpan={colSpan}>
        <div className="insights-card" role="region" aria-label={`Fees and placements for ${institute}`} aria-live="polite">
          {status === 'loading' && (
            <>
              <p className="insights-status"><span className="insights-spinner" aria-hidden="true" />
                {slow ? 'Still checking official sources… typical figures shown meanwhile.' : 'Reading official sources… a live lookup can take up to a minute.'}</p>
              {slow && <Estimate institute={institute} />}
            </>
          )}
          {status === 'error' && (
            <>
              <p className="insights-error"><span>{error}</span> <button type="button" className="insights-retry" onClick={load}>Retry</button></p>
              <Estimate institute={institute} />
            </>
          )}
          {status === 'done' && !hasLive && (
            <>
              <p className="insights-status">No reliable official figures found for this institute.</p>
              <Estimate institute={institute} />
            </>
          )}
          {status === 'done' && hasLive && (
            <>
              <Tiles items={live} />
              <p className="insights-note">
                Extracted automatically by TinyFish
                {data.source_url && <> from <a href={data.source_url} target="_blank" rel="noopener noreferrer">{data.source_title || 'the source page'}</a></>}
                {data.fetched_at && <> on {new Date(data.fetched_at).toLocaleDateString('en-IN')}</>}. Verify on the official site before deciding.
              </p>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
