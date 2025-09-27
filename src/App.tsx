/**
 * App.tsx
 * Root UI: auth, profile selection, filters modal, proposals table, and JobProposal view.
 * Platform-specific UI (e.g., Upwork filters) is imported from src/platforms.
 */
import { useState, useEffect, useMemo } from 'react';
import './App.css';
import JobProposal from './JobProposal.tsx';
import Tooltip from '@mui/material/Tooltip';
import { groupProposalsByThread } from '../utils/groupProposals.ts';
import UserManagement from './users/UserManagement.tsx';
import FiltersModal from './platforms/upwork/UpworkFiltersModal.tsx';
// import AppQuery from '../AppQuery.tsx';

interface JobProfile {
  id: string;
  profile_id: string;
  job_id: string;
  score: number;
  query_text: {
    title: string;
    // other query_text properties
  };
  // other properties
}

interface Profile {
  id: string;
  name: string;
  modelname: string | null;
  last_updated: string;
  job_id: string;
  training_file: {
    name: string;
    path: string;
    size: number;
    type: string;
  }[];
  content: string;
}

// removed unused ProfilesResponse

function App() {
  const [filteredProfiles, setFilteredProfiles] = useState<JobProfile[]>([]);
  const [availableProfiles, setAvailableProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [groupedProposals, setGroupedProposals] = useState<Record<string, any[]>>({});
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [companyId, setCompanyId] = useState<string | null>(() => localStorage.getItem('company_id'));
  const [authMode, setAuthMode] = useState<'login'|'signup'>('login');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string>('');
  const [authForm, setAuthForm] = useState({ companyName: '', username: '', email: '', password: '', confirmPassword: '' });
  const [settingsMenuOpen, setSettingsMenuOpen] = useState<boolean>(false);
  const [filtersScope, setFiltersScope] = useState<{ scope: 'company'|'profile'; profileId?: string|null } | null>(null);

  type Filters = {
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
  const defaultFilters = (): Filters => ({
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
  });
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const baseUrl = useMemo(() => {
    let u = import.meta.env.VITE_API_URL as string;
    if (!u) u = 'http://localhost:3009/api/';
    if (!u.endsWith('/')) u += '/';
    return u;
  }, []);
  const authHeaders = useMemo(() => ({
    json: () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }),
    bearer: () => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}) })
  }), [token]);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const url = authMode === 'login' ? `${baseUrl}auth/login` : `${baseUrl}auth/signup`;
      const payload = authMode === 'login' 
        ? { email: authForm.email, password: authForm.password }
        : authForm;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.message || 'Auth failed');
      if (!data?.token) throw new Error('Missing token');
      setToken(data.token);
      localStorage.setItem('auth_token', data.token);
      const prevCid = localStorage.getItem('company_id') || null;
      const cid = (data.company_id || (data.data && data.data.company_id)) || null;
      if (cid) {
        if (prevCid && prevCid !== cid) {
          try { localStorage.removeItem('chat_master_key'); } catch {}
        }
        setCompanyId(cid);
        localStorage.setItem('company_id', cid);
      }
      setAuthForm({ companyName: '', username: '', email: '', password: '', confirmPassword: '' });
    } catch (err: any) {
      setAuthError(err.message || 'Auth error');
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    setToken(null);
    setCompanyId(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('company_id');
    try { localStorage.removeItem('chat_master_key'); } catch {}
    setFilteredProfiles([]);
    setGroupedProposals({});
    setSelectedProfileId('');
    // ensure all in-memory UI state resets
    try { window.location.reload(); } catch {}
  }

  function confirmAndLogout() {
    const ok = window.confirm('Are you sure you want to logout?');
    if (ok) handleLogout();
  }

  // Fetch all profiles on load (only when authed)
  useEffect(() => {
    const fetchData = async () => {
      if (!token) { setLoading(false); setAvailableProfiles([]); return; }
      try {
        const response = await fetch(`${baseUrl}profiles`, { headers: authHeaders.bearer() });
        if (response.status === 401) { handleLogout(); return; }
        const data = await response.json().catch(() => null);
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        setAvailableProfiles(rows as any);
      } catch (error) {
        console.error('Error fetching profiles:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [userManagementOpen, token, baseUrl, authHeaders]);

  // Load filters once (only when authed)
  useEffect(() => {
    const loadFilters = async () => {
      if (!token) return;
      try {
        const resp = await fetch(`${baseUrl}filters`, { headers: authHeaders.bearer() });
        if (resp.status === 401) { handleLogout(); return; }
        const data = await resp.json();
        setFilters({ ...defaultFilters(), ...data });
      } catch (e) {
        console.error('Failed to load filters', e);
      }
    };
    loadFilters();
  }, [token, baseUrl, authHeaders]);

  // Handle profile selection
  const handleProfileChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    handleCloseProposal();
    const profileId = e.target.value;
    setSelectedProfileId(profileId);

    if (!profileId) {
      setFilteredProfiles([]);
      setGroupedProposals({});
      return;
    }

    setProfileLoading(true);
    try {
      const response = await fetch(`${baseUrl}proposal/${profileId}`, { headers: authHeaders.bearer() });
      const result = await response.json();
      console.log('Fetched job profiles:', result);

      const jobProfiles = result?.data?.map((profile: any) => {
        const parsedQuery = (() => {
          if (typeof profile?.query_text === 'string') {
            try {
              return JSON.parse(profile.query_text);
            } catch {
              let string = JSON.stringify(profile.query_text);
              return JSON.parse(string);
            }
          }
          return profile.query_text;
        })();

        return {
          ...profile,
          query_text: parsedQuery
        };
      }) || [];
      console.log('Job Profiles:', jobProfiles);

      const latestProfiles = jobProfiles.reduce((acc: any[], current: any) => {
        const existing = acc.find(
          (p) =>
            p.thread_id === current.thread_id &&
            p.query_text?.id === current.query_text?.id
        );
        if (!existing) {
          acc.push(current);
        } else if (new Date(current.created_at) > new Date(existing.created_at)) {
          acc = acc.filter(
            (p) => !(p.thread_id === current.thread_id && p.query_text?.id === current.query_text?.id)
          );
          acc.push(current);
        }
        return acc;
      }, []);

      setFilteredProfiles(latestProfiles);
      setGroupedProposals(groupProposalsByThread(jobProfiles));
    } catch (error) {
      console.error('Error fetching job profiles:', error);
      setFilteredProfiles([]);
      setGroupedProposals({});
    } finally {
      setProfileLoading(false);
    }
  };

  const handleDiscardJobForProfile = async (jobId: string, profileId: string) => {
    console.log('Discarding job for profile:', jobId, profileId);
    try {
      const response = await fetch(`${baseUrl}proposal/${jobId}`, {
        method: 'DELETE',
        headers: authHeaders.bearer(),
      });
      if (response.ok) {
        setFilteredProfiles((prev) => prev.filter((job) => job.id !== profileId));
      }
    } catch (error) {
      console.error('Error discarding job for profile:', error);
    }
  };

  const handleJobTitleClick = (profile: any) => {
    console.log('Job title clicked:', profile);
    try {
      const jobData = {
        proposal: profile?.proposal,
        id: profile?.query_text?.id,
        title: profile?.query_text?.title,
        thread_id: profile?.thread_id,
        query_text: profile?.query_text,
      };
      setSelectedJob(jobData);
    } catch (error) {
      console.error('Error parsing job data:', error);
    }
  };

  const handleCloseProposal = () => {
    setSelectedJob(null);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="extension-container">
      {!token && (
        <div className="dialog-overlay">
          <div className="dialog-content" style={{ maxWidth: 520 }}>
            <div className="dialog-header">
              <h3 className="dialog-title">{authMode === 'login' ? 'Login' : 'Sign Up'}</h3>
            </div>
            <form onSubmit={handleAuthSubmit} className="form-spacing">
              {authMode === 'signup' && (
                <div className="form-group">
                  <label className="form-label">Company Name</label>
                  <input className="input" value={authForm.companyName} onChange={(e) => setAuthForm({ ...authForm, companyName: e.target.value })} required />
                </div>
              )}
              {authMode === 'signup' && (
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input className="input" value={authForm.username} onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} required />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="input" type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="input" type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
              </div>
              {authMode === 'signup' && (
                <div className="form-group">
                  <label className="form-label">Confirm Password</label>
                  <input className="input" type="password" value={authForm.confirmPassword} onChange={(e) => setAuthForm({ ...authForm, confirmPassword: e.target.value })} required />
                </div>
              )}
              {authError && <div className="form-error">{authError}</div>}
              <div className="flex-end" style={{ gap: 8 }}>
                <button type="button" className="button button-outline" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
                  {authMode === 'login' ? 'Need an account? Sign Up' : 'Have an account? Login'}
                </button>
                <button className="button" disabled={authLoading}>{authLoading ? 'Please wait…' : (authMode === 'login' ? 'Login' : 'Sign Up')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <header className="extension-header">
        <select
          className="custom-dropdown"
          value={selectedProfileId}
          onChange={handleProfileChange}
          disabled={availableProfiles.length === 0}
        >
          <option value="">
            {availableProfiles.length === 0 ? 'Not Available' : 'Choose a Profile...'}
          </option>
          {availableProfiles.map(profile => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button
          className="button"
          onClick={() => setUserManagementOpen(true)}
        >
          User Management
        </button>
        {companyId && (
          <span className="subtitle" style={{ marginLeft: 8 }}>Company: {companyId}</span>
        )}
        {token && (
          <div style={{ position: 'relative', marginLeft: 8 }}>
            <button className="button button-outline" onClick={() => setSettingsMenuOpen((v) => !v)} title="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.26 1.3.73 1.77.47.47 1.11.73 1.77.73H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            {settingsMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: '#0b1020', border: '1px solid #1f2937', borderRadius: 8, padding: 8, minWidth: 180, zIndex: 1000 }}>
                <button className="button button-full" onClick={() => { setSettingsMenuOpen(false); setFiltersScope({ scope: 'company' }); }}>Default Filters</button>
                <button className="button button-full" style={{ marginTop: 6 }} onClick={() => { setSettingsMenuOpen(false); confirmAndLogout(); }}>Logout</button>
              </div>
            )}
          </div>
        )}
      </header>
      {userManagementOpen && (
        <div className="dialog-overlay">
          <div className="dialog-content dialog-large">
            <div className="dialog-header-cross">
              <button
                className="button button-close"
                onClick={() => setUserManagementOpen(false)}
              >
                ×
              </button>
            </div>
            <UserManagement />
          </div>
        </div>
      )}

      {filtersOpen && (
        <div className="dialog-overlay">
          <div className="dialog-content dialog-large">
            <div className="dialog-header">
              <h3 className="dialog-title">Upwork Filters</h3>
              <button className="button button-close" onClick={() => setFiltersOpen(false)}>×</button>
            </div>
            <p className="subtitle" style={{ margin: '6px 0 12px 0' }}>
              Only fill what you need. Leave blank to ignore a range. Comma-separate category IDs.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const rangeOk = (lo: any, hi: any) => (lo == null || hi == null) || Number(lo) <= Number(hi);
                  if (!rangeOk(filters.clientHires_min, filters.clientHires_max)) throw new Error('Client hires min must be <= max');
                  // Validate hourly string if present
                  if (filters.hourlyRate) {
                    const [hMin, hMax] = filters.hourlyRate.split('-').map(s => Number(s.trim()));
                    if (Number.isFinite(hMin) && Number.isFinite(hMax) && hMin > hMax) throw new Error('Hourly min must be <= max');
                  }
                  // Validate budget string if present
                  if (filters.budget?.[0]) {
                    const [bMin, bMax] = filters.budget[0].split('-').map(s => Number(s.trim()));
                    if (Number.isFinite(bMin) && Number.isFinite(bMax) && bMin > bMax) throw new Error('Budget min must be <= max');
                  }
                  if (!rangeOk(filters.proposal_min, filters.proposal_max)) throw new Error('Proposals min must be <= max');

                  const resp = await fetch(`${baseUrl}filters`, {
                    method: 'POST',
                    headers: authHeaders.json(),
                    body: JSON.stringify({
                      categoryIds_any: filters.categoryIds_any,
                      workload_part_time: filters.workload_part_time,
                      workload_full_time: filters.workload_full_time,
                      verifiedPaymentOnly_eq: filters.verifiedPaymentOnly_eq,
                      clientHires_min: filters.clientHires_min,
                      clientHires_max: filters.clientHires_max,
                      hourlyRate: filters.hourlyRate,
                      budget: filters.budget,
                      proposal_min: filters.proposal_min,
                      proposal_max: filters.proposal_max,
                      experienceLevel_eq: filters.experienceLevel_eq,
                    })
                  });
                  if (!resp.ok) throw new Error('Failed to save filters');
                  setFiltersOpen(false);
                } catch (err) {
                  console.error('Save filters error:', err);
                  alert((err as Error).message);
                }
              }}
            >
              <div className="grid-container">
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

                {/* Compact rows: label + min/max inputs */}
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
        </div>
      )}

      {profileLoading && (
        <div className="loading-container">
          <div className="spinner small"></div>
          <p>Loading job matches...</p>
        </div>
      )}

      {!profileLoading && filteredProfiles.length === 0 && selectedProfileId && (
        <p className="no-results">No job profiles found for this selection.</p>
      )}

      {!profileLoading && filteredProfiles.length > 0 && (
        <div className="profiles-table-container">
          <table className="profiles-table">
            <thead>
              <tr>
                <th>{`P(job)`}</th>
                <th>Job Title</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => (
                <tr key={profile.id}>
                  {/* Probability Column */}
                  <td>
                    <div className="probability-cell">
                      <div
                        className="probability-bar"
                        style={{
                          width: `${profile.score || 0}%`,
                        }}
                      ></div>
                      <span className="probability-value">
                        {profile.score?.toFixed(0) || 0}%
                      </span>
                    </div>
                  </td>

                  {/* Job Title + Icons Column */}
                  <td>
                    <div className="job-title-row">
                      <Tooltip
                        placement="top"
                        title={profile.query_text?.title || 'No title available'}
                        arrow
                        slotProps={{
                          arrow: {
                            sx: {
                            },
                          },
                        }}
                      >
                        <button
                          className="department-tag title-button"
                          onClick={() => handleJobTitleClick(profile)}
                        >
                          <span className="job-title">
                            {profile.query_text?.title
                              ? (profile.query_text.title.length > 20
                                ? `${profile.query_text.title.substring(0, 20)}...`
                                : profile.query_text.title)
                              : 'No title'}
                          </span>
                        </button>
                      </Tooltip>

                      {/* Keep your discard buttons here */}
                      {/* <Tooltip
                        placement="top"
                        title="discard job"
                        arrow
                        slotProps={{
                          arrow: {
                            sx: {
                            },
                          },
                        }}
                      >
                        <button
                          className="icon-button"
                          onClick={() => handleDiscardJob(profile.job_id)}
                        >
                          <img src="/discard_job.png" alt="Delete Job" className="icon" />
                        </button>
                      </Tooltip> */}

                      <Tooltip
                        placement="top"
                        title="discard job for this profile"
                        arrow
                        slotProps={{
                          arrow: {
                            sx: {
                            },
                          },
                        }}
                      >
                        <button
                          className="icon-button"
                          onClick={() => handleDiscardJobForProfile(profile.id, profile.profile_id)}
                        >
                          <img src="/discard_job_user_profile.png" alt="Delete Job for Profile" className="icon" />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedJob && (groupedProposals[selectedJob.thread_id] || []).length > 0 && (
        <JobProposal
          jobData={selectedJob}
          onClose={handleCloseProposal}
          profileId={selectedProfileId}
          proposalHistory={groupedProposals[selectedJob.thread_id] || []}
        />
      )}
      {filtersScope && (
        <FiltersModal scope={filtersScope.scope} profileId={filtersScope.profileId || null} onClose={() => setFiltersScope(null)} />
      )}
      {/* <AppQuery /> */}
    </div>
  );
}

export default App;