import React, { useEffect, useRef, useState } from 'react';
import { loadCutoffsData, getPredictions, BRANCH_OPTIONS } from '../utils/predictionEngine';
import { readShortlist, writeShortlist, subscribeShortlist } from '../utils/shortlist';
import InstituteInsights from '../components/InstituteInsights';
import '../styles/animations.css';
import '../styles/insights.css';

const FILTERS = ['All', 'Safe', 'Target', 'Reach'];

function Field({ label, hint, children }) {
  return (
    <label className="field-label">
      {label}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export default function Predictor() {
  const [mainsRank, setMainsRank] = useState('');
  const [advancedRank, setAdvancedRank] = useState('');
  const [category, setCategory] = useState('OPEN');
  const [gender, setGender] = useState('Gender-Neutral');
  const [quota, setQuota] = useState('All India (AI)');
  const [preferredBranch, setPreferredBranch] = useState('');

  const [results, setResults] = useState(null);
  const [searched, setSearched] = useState(null); // the inputs used for the results on screen
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [shortlisted, setShortlisted] = useState(readShortlist);
  const resultsRef = useRef(null);

  // Keep the Saved buttons in sync when the shortlist changes anywhere (other tab, navbar, choice list page)
  useEffect(() => subscribeShortlist(() => setShortlisted(readShortlist())), []);

  const handlePredict = async (e) => {
    e.preventDefault();
    if (!mainsRank) return;

    setLoading(true);
    setError('');
    try {
      const cutoffsData = await loadCutoffsData();

      // Blank Advanced rank MUST become null: predictionEngine.js uses null to completely exclude IITs.
      const normalizedAdvancedRank = advancedRank.trim() === '' ? null : parseInt(advancedRank, 10);
      const parsedMains = parseInt(mainsRank, 10);

      const matches = getPredictions(cutoffsData, {
        mainsRank: parsedMains,
        advancedRank: normalizedAdvancedRank,
        category,
        gender,
        quota,
        preferredBranch,
      });

      // IMPORTANT: do NOT sort here. predictionEngine.js already applies the strict hierarchy
      // IIT -> NIT -> IIIT -> GFTI and sorts within each tier. Re-sorting by Safe/Target/Reach would destroy it.
      setResults(matches);
      setSearched({ mains: parsedMains, advanced: normalizedAdvancedRank, category, quota });

      // On phones the results sit below the form, so scroll them into view
      if (window.matchMedia('(max-width: 900px)').matches) {
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    } catch (err) {
      console.error('Failed to load cutoff dataset:', err);
      setResults(null);
      setError('Could not load the cutoff data. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const isSaved = (item) => shortlisted.some((s) => s.institute === item.institute && s.branch === item.branch);

  const handleShortlist = (item) => {
    if (isSaved(item)) return;
    const updated = [...shortlisted, item];
    setShortlisted(updated);
    writeShortlist(updated);
  };

  const filteredResults = results
    ? results.filter((item) => activeFilter === 'All' || item.tag?.toLowerCase() === activeFilter.toLowerCase())
    : [];

  return (
    <div className="wrap predictor-page animate-page-entry">
      <div className="predictor-layout">

        <form className="feature-card predictor-form" onSubmit={handlePredict}>
          <h2 className="form-title">Find College Options</h2>
          <div className="form-fields">
            <Field label="JEE Mains Rank">
              <input className="field-control" type="number" inputMode="numeric" min="1" step="1" placeholder="e.g. 8500"
                value={mainsRank} onChange={(e) => setMainsRank(e.target.value)} required />
            </Field>

            <Field
              label={<>JEE Advanced Rank <span className="field-optional">(Optional)</span></>}
              hint="Leave blank if you did not appear for JEE Advanced. IITs will be excluded.">
              <input className="field-control" type="number" inputMode="numeric" min="1" step="1" placeholder="e.g. 777"
                value={advancedRank} onChange={(e) => setAdvancedRank(e.target.value)} />
            </Field>

            <Field label="Seat Category">
              <select className="field-control" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="OPEN">OPEN (General)</option>
                <option value="EWS">EWS</option>
                <option value="OBC-NCL">OBC-NCL</option>
                <option value="SC">SC</option>
                <option value="ST">ST</option>
              </select>
            </Field>

            <Field label="Gender Pool">
              <select className="field-control" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="Gender-Neutral">Gender-Neutral</option>
                <option value="Female-only">Female-Only</option>
              </select>
            </Field>

            <Field label="Quota">
              <select className="field-control" value={quota} onChange={(e) => setQuota(e.target.value)}>
                <option value="All India (AI)">All India (AI)</option>
                <option value="Home State (HS)">Home State (HS)</option>
                <option value="Other State (OS)">Other State (OS)</option>
              </select>
            </Field>

            <Field label="Preferred Branch">
              <select className="field-control" value={preferredBranch} onChange={(e) => setPreferredBranch(e.target.value)}>
                {BRANCH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </Field>

            <button type="submit" className="btn btn-yellow submit-btn" disabled={loading}>
              {loading ? 'Analyzing Cutoffs...' : 'Predict Colleges'}
            </button>
            {error && <p className="error-msg" role="alert">{error}</p>}
          </div>
        </form>

        <div className="feature-card results-panel" ref={resultsRef} aria-live="polite">
          {!results ? (
            <div className="results-empty">
              <div className="results-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                  <path d="M6 12v5c3 3 9 3 12 0v-5" />
                </svg>
              </div>
              <h3>Your matched colleges will appear here</h3>
              <p>Enter your JEE Mains rank and preferences in the form to calculate your allocation odds.</p>
            </div>
          ) : (
            <div>
              <h2 className="results-title">Predicted Colleges ({filteredResults.length})</h2>
              <p className="results-sub">
                Matching Mains rank #{searched?.mains.toLocaleString()}
                {searched?.advanced != null && <> · Advanced rank #{searched.advanced.toLocaleString()}</>}
                {' '}({searched?.category}, {searched?.quota})
              </p>

              <div className="filter-pills">
                {FILTERS.map((filter) => (
                  <button key={filter} type="button" aria-pressed={activeFilter === filter}
                    className={`filter-pill${activeFilter === filter ? ' active' : ''}`} onClick={() => setActiveFilter(filter)}>
                    {filter}
                  </button>
                ))}
              </div>

              {filteredResults.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', padding: '2rem 0' }}>
                  No colleges found under the selected "{activeFilter}" filter.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Institute</th>
                        <th>Branch</th>
                        <th className="nowrap">Closing Rank</th>
                        <th className="nowrap">Chance</th>
                        <th className="nowrap">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((item, idx) => {
                        const tag = item.tag?.toLowerCase();
                        return (
                          <tr key={`${item.institute}-${item.branch}-${idx}`} className="animate-table-row"
                            style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s` }}>
                            <td className="cell-institute">{item.institute}</td>
                            <td className="cell-branch">{item.branch}</td>
                            <td className="cell-rank nowrap" data-label="Closing rank">{item.expRank.toLocaleString()}</td>
                            <td className="nowrap">
                              <span className={`chance-tag ${tag}`}>{item.tag} {item.prob ? `(${item.prob})` : ''}</span>
                            </td>
                            <td className="cell-action">
                              <div className="action-group">
                                <InstituteInsights institute={item.institute} />
                                <button type="button" className="btn btn-secondary shortlist-btn" disabled={isSaved(item)} onClick={() => handleShortlist(item)}>
                                  {isSaved(item) ? 'Saved' : '+ Shortlist'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
