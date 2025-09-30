/**
 * UpworkFiltersModal.tsx
 * Upwork-specific filters editor (company/profile scope), persisted via /api/filters.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type Scope = 'company' | 'profile';

type Filters = {
  active: boolean;
  categoryIds_any: string[];
  workload_part_time: boolean;
  workload_full_time: boolean;
  verifiedPaymentOnly_eq: boolean;
  clientHires_min: number | null;
  clientHires_max: number | null;
  hourlyRate: string | null;  // "min-max"
  budget: string[];           // ["min-max"]
  proposal_min: number | null;
  proposal_max: number | null;
  experienceLevel_eq: string | null;
};

function defaultFilters(): Filters {
  return {
    active: false,
    categoryIds_any: [],
    workload_part_time: false,
    workload_full_time: false,
    verifiedPaymentOnly_eq: false,
    clientHires_min: null,
    clientHires_max: null,
    hourlyRate: null,
    budget: [],
    proposal_min: null,
    proposal_max: null,
    experienceLevel_eq: null,
  };
}

export default function FiltersModal({ scope, profileId, onClose } : { scope: Scope; profileId?: string | null; onClose: () => void; }) {
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [loading, setLoading] = useState<boolean>(true);
  const token = useMemo(() => localStorage.getItem('auth_token'), []);
  const baseUrl = useMemo(() => {
    let u = import.meta.env.VITE_API_URL as string;
    if (!u) u = 'http://localhost:3009/api/';
    if (!u.endsWith('/')) u += '/';
    return u;
  }, []);
  const headersJson = useMemo(() => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }), [token]);
  const headersBearer = useMemo(() => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}) }), [token]);

  useEffect(() => {
    (async () => {
      try {
        const qs = scope === 'profile' && profileId ? `scope=profile&profileId=${profileId}` : 'scope=company';
        const resp = await fetch(`${baseUrl}filters?${qs}`, { headers: headersBearer });
        const data = await resp.json();
        const toStr = (v: any) => (v === null || v === undefined || v === '' ? null : String(v));
        const hourly = (() => {
          if (typeof data.hourlyRate === 'string' && data.hourlyRate.trim() !== '') return data.hourlyRate;
          const lo = toStr(data.hourlyRate_min);
          const hi = toStr(data.hourlyRate_max);
          if (lo === null && hi === null) return null;
          return `${lo ?? ''}-${hi ?? ''}`;
        })();
        const budgetArr = (() => {
          if (Array.isArray(data.budget) && data.budget.length) return data.budget.map((s: any) => String(s));
          const lo = toStr(data.budget_min);
          const hi = toStr(data.budget_max);
          if (lo === null && hi === null) return [] as string[];
          return [`${lo ?? ''}-${hi ?? ''}`];
        })();
        const cat = Array.isArray(data.categoryIds_any) ? data.categoryIds_any.map((s: any) => String(s)) : [];
        setFilters({
          ...defaultFilters(),
          categoryIds_any: cat,
          workload_part_time: !!data.workload_part_time,
          workload_full_time: !!data.workload_full_time,
          verifiedPaymentOnly_eq: !!data.verifiedPaymentOnly_eq,
          clientHires_min: data.clientHires_min ?? null,
          clientHires_max: data.clientHires_max ?? null,
          hourlyRate: hourly,
          budget: budgetArr,
          proposal_min: data.proposal_min ?? null,
          proposal_max: data.proposal_max ?? null,
          experienceLevel_eq: (typeof data.experienceLevel_eq === 'string' && data.experienceLevel_eq.trim() !== '') ? data.experienceLevel_eq : null,
          active: !!data.active,
        });
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [baseUrl, headersBearer, scope, profileId]);

  async function copyFromCompanyDefaults() {
    try {
      const resp = await fetch(`${baseUrl}filters?scope=company`, { headers: headersBearer });
      const data = await resp.json();
      // Map only user-editable fields; keep current profile's active as-is
      const toStr = (v: any) => (v === null || v === undefined || v === '' ? null : String(v));
      const numOrNull = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

      const hourlyFromMinMax = (() => {
        const lo = toStr(data.hourlyRate_min);
        const hi = toStr(data.hourlyRate_max);
        if (lo === null && hi === null) return null;
        return `${lo ?? ''}-${hi ?? ''}`;
      })();
      const budgetFromMinMax = (() => {
        const lo = toStr(data.budget_min);
        const hi = toStr(data.budget_max);
        if (lo === null && hi === null) return [] as string[];
        return [`${lo ?? ''}-${hi ?? ''}`];
      })();

      setFilters((prev) => ({
        ...prev,
        // Do NOT override prev.active to allow per-profile control
        categoryIds_any: Array.isArray(data.categoryIds_any) ? data.categoryIds_any.map(String) : [],
        workload_part_time: !!data.workload_part_time,
        workload_full_time: !!data.workload_full_time,
        verifiedPaymentOnly_eq: !!data.verifiedPaymentOnly_eq,
        clientHires_min: numOrNull(data.clientHires_min),
        clientHires_max: numOrNull(data.clientHires_max),
        hourlyRate: toStr(data.hourlyRate) ?? hourlyFromMinMax,
        budget: Array.isArray(data.budget) ? data.budget.map(String) : budgetFromMinMax,
        proposal_min: numOrNull(data.proposal_min),
        proposal_max: numOrNull(data.proposal_max),
        experienceLevel_eq: toStr(data.experienceLevel_eq),
      }));
    } catch (e) {
      alert('Failed to load company defaults');
    }
  }

  if (loading) {
    return createPortal(
      <div className="dialog-overlay">
        <div className="dialog-content dialog-large" style={{ display: 'flex', flexDirection: 'column', height: '86vh', width: '100%', maxWidth: 1000 }}>
          <div className="dialog-header">
            <h3 className="dialog-title">Loading filters…</h3>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="dialog-overlay">
      <div className="dialog-content dialog-large" style={{ display: 'flex', flexDirection: 'column', height: '86vh', width: '100%', maxWidth: 1000 }}>
        <div className="dialog-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 className="dialog-title">{scope === 'company' ? 'Default Filters (Company)' : 'User Filters'}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {scope === 'profile' && (
              <button
                className="button button-outline"
                title="Make same as company default"
                onClick={copyFromCompanyDefaults}
              >
                Use Company Default
              </button>
            )}
            <button className="button button-close" onClick={onClose}>×</button>
          </div>
        </div>
        <p className="subtitle" style={{ margin: '6px 0 12px 0' }}>
          Enable/disable and edit the filter. Leave blank ranges to ignore. Comma-separate category IDs.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const rangeOk = (lo: any, hi: any) => (lo == null || hi == null) || Number(lo) <= Number(hi);
              if (!rangeOk(filters.clientHires_min, filters.clientHires_max)) throw new Error('Client hires min must be <= max');
              if (filters.hourlyRate) {
                const [hMin, hMax] = filters.hourlyRate.split('-').map(s => Number(s.trim()));
                if (Number.isFinite(hMin) && Number.isFinite(hMax) && hMin > hMax) throw new Error('Hourly min must be <= max');
              }
              if (filters.budget?.[0]) {
                const [bMin, bMax] = filters.budget[0].split('-').map(s => Number(s.trim()));
                if (Number.isFinite(bMin) && Number.isFinite(bMax) && bMin > bMax) throw new Error('Budget min must be <= max');
              }
              if (!rangeOk(filters.proposal_min, filters.proposal_max)) throw new Error('Proposals min must be <= max');

              const body: any = {
                scope,
                ...filters,
              };
              if (scope === 'profile' && profileId) body.profileId = profileId;

              const resp = await fetch(`${baseUrl}filters`, {
                method: 'POST',
                headers: headersJson,
                body: JSON.stringify(body)
              });
              if (!resp.ok) throw new Error('Failed to save');
              onClose();
            } catch (err:any) {
              alert(err.message || 'Failed');
            }
          }}
        >
          <div className="grid-container">
            <div className="form-group">
              <label className="form-label">Enable this filter</label>
              <input type="checkbox" checked={filters.active} onChange={(e) => setFilters({ ...filters, active: e.target.checked })} />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select
                className="input"
                value={String((filters.categoryIds_any?.[0] ?? ''))}
                onChange={(e) => setFilters({ ...filters, categoryIds_any: e.target.value ? [String(e.target.value)] : [] })}
              >
                <option value="">All categories</option>
                <option value="531770282580668418">All - Translation, All - Web, Mobile & Software Dev</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Workload (multi-select)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={filters.workload_part_time}
                    onChange={(e) => setFilters({ ...filters, workload_part_time: e.target.checked })}
                  />
                  <span>Less than 30 hrs/week</span>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={filters.workload_full_time}
                    onChange={(e) => setFilters({ ...filters, workload_full_time: e.target.checked })}
                  />
                  <span>30+ hrs/week</span>
                </label>
              </div>
              <small className="subtitle">Leave both unchecked for Any.</small>
            </div>
            <div className="form-group">
              <label className="form-label">Verified Payment Only</label>
              <input type="checkbox" checked={!!filters.verifiedPaymentOnly_eq} onChange={(e) => setFilters({ ...filters, verifiedPaymentOnly_eq: e.target.checked })} />
            </div>
            <div className="form-group">
              <label className="form-label">Client Hires (min–max)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} type="number" placeholder="1" value={filters.clientHires_min ?? ''} onChange={(e) => setFilters({ ...filters, clientHires_min: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="input" style={{ flex: 1 }} type="number" placeholder="100000" value={filters.clientHires_max ?? ''} onChange={(e) => setFilters({ ...filters, clientHires_max: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Hourly Rate (min–max)</label>
              <input className="input" placeholder="e.g., 12-30" value={filters.hourlyRate || ''} onChange={(e) => setFilters({ ...filters, hourlyRate: e.target.value || null })} />
            </div>
            <div className="form-group">
              <label className="form-label">Budget (min–max)</label>
              <input className="input" placeholder='e.g., 23-344' value={filters.budget?.[0] || ''} onChange={(e) => setFilters({ ...filters, budget: e.target.value ? [e.target.value] : [] })} />
            </div>
            <div className="form-group">
              <label className="form-label">Proposals (min–max)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} type="number" placeholder="0" value={filters.proposal_min ?? ''} onChange={(e) => setFilters({ ...filters, proposal_min: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="input" style={{ flex: 1 }} type="number" placeholder="50" value={filters.proposal_max ?? ''} onChange={(e) => setFilters({ ...filters, proposal_max: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Experience Level</label>
              <select className="input" value={filters.experienceLevel_eq || ''} onChange={(e) => setFilters({ ...filters, experienceLevel_eq: e.target.value || null })}>
                <option value="">Any</option>
                <option value="ENTRY_LEVEL">Entry</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="EXPERT">Expert</option>
              </select>
            </div>
          </div>
          <div className="flex-end" style={{ marginTop: 12 }}>
            <button className="button" type="submit">Save</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}


