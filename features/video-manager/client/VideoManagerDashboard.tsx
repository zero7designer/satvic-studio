'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import ProductDashboardShell from '@/features/dashboard/client/ProductDashboardShell';
import { VIDEO_MANAGER_LANGUAGES, type VideoManagerVideoType } from '@/features/video-manager/constants';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Ban, Check, CheckCircle2, Clock3,
  ExternalLink, Instagram, Languages, Link2, LoaderCircle, Plus, RefreshCw, Search, Trash2, Youtube,
} from 'lucide-react';

type RequestStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type RequestFilter = 'all' | RequestStatus;
type SubmittedRequest = {
  id: string;
  project_name: string;
  video_type: VideoManagerVideoType;
  source_url: string;
  target_languages: string[];
  status: RequestStatus;
  created_at: string;
};

const requestFilters: { id: RequestFilter; label: string }[] = [
  { id: 'all', label: 'All requests' },
  { id: 'pending', label: 'Pending' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

function matchesRequestQuery(request: SubmittedRequest, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    request.project_name,
    request.video_type === 'short' ? 'short-form instagram reels youtube shorts' : 'long-form youtube',
    request.source_url,
    request.status.replace('_', ' '),
    request.created_at,
    ...request.target_languages,
  ].some(value => value.toLowerCase().includes(normalizedQuery));
}

export default function VideoManagerDashboard({
  accountEmail,
  accountAvatar,
}: {
  accountEmail: string;
  accountAvatar: string;
}) {
  const [activeView, setActiveView] = useState('create-job');
  const [projectName, setProjectName] = useState('');
  const [videoType, setVideoType] = useState<VideoManagerVideoType | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submittedName, setSubmittedName] = useState('');
  const [requests, setRequests] = useState<SubmittedRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsRefreshing, setRequestsRefreshing] = useState(false);
  const [requestsError, setRequestsError] = useState('');
  const [requestAction, setRequestAction] = useState<{ id: string; action: 'cancel' | 'delete' } | null>(null);
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('all');
  const [requestSearchQuery, setRequestSearchQuery] = useState('');
  const [requestSearchOpen, setRequestSearchOpen] = useState(false);
  const [requestSearchClosing, setRequestSearchClosing] = useState(false);
  const [requestSearchOrigin, setRequestSearchOrigin] = useState({ x: 325, y: 30 });
  const requestSearchInputRef = useRef<HTMLInputElement>(null);
  const requestSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const requestSearchCloseTimerRef = useRef<number | null>(null);

  const loadRequests = useCallback(async (refresh = false) => {
    if (refresh) setRequestsRefreshing(true);
    try {
      const response = await fetch('/api/video-manager/requests', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load your requests.');
      setRequests(body.requests || []);
      setRequestsError('');
    } catch (error) {
      setRequestsError(error instanceof Error ? error.message : 'Could not load your requests.');
    } finally {
      setRequestsLoading(false);
      setRequestsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
    const timer = window.setInterval(() => void loadRequests(), 30000);
    return () => window.clearInterval(timer);
  }, [loadRequests]);

  useEffect(() => {
    if (!requestSearchOpen) return;
    const frame = window.requestAnimationFrame(() => requestSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [requestSearchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && requestSearchOpen) {
        event.preventDefault();
        closeRequestSearch();
      } else if (activeView === 'request-status' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openRequestSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeView, requestSearchOpen, requestSearchClosing]);

  useEffect(() => () => {
    if (requestSearchCloseTimerRef.current !== null) window.clearTimeout(requestSearchCloseTimerRef.current);
  }, []);

  function openRequestSearch() {
    if (requestSearchCloseTimerRef.current !== null) window.clearTimeout(requestSearchCloseTimerRef.current);
    const trigger = requestSearchTriggerRef.current?.getBoundingClientRect();
    if (trigger) {
      const edgePadding = window.innerWidth <= 600 ? 10 : 18;
      const panelWidth = Math.min(650, window.innerWidth - edgePadding * 2);
      const panelLeft = (window.innerWidth - panelWidth) / 2;
      const panelTop = window.innerWidth <= 600 ? 68 : Math.min(150, Math.max(70, window.innerHeight * 0.15));
      setRequestSearchOrigin({ x: trigger.left + trigger.width / 2 - panelLeft, y: trigger.top + trigger.height / 2 - panelTop });
    }
    setRequestSearchClosing(false);
    setRequestSearchOpen(true);
  }

  function closeRequestSearch() {
    if (!requestSearchOpen || requestSearchClosing) return;
    setRequestSearchClosing(true);
    requestSearchCloseTimerRef.current = window.setTimeout(() => {
      setRequestSearchOpen(false);
      setRequestSearchClosing(false);
      requestSearchCloseTimerRef.current = null;
    }, 190);
  }

  function selectRequestSearchResult(request: SubmittedRequest) {
    setRequestFilter('all');
    setRequestSearchQuery(request.project_name);
    closeRequestSearch();
  }

  const matchingRequests = useMemo(
    () => requests.filter(request => matchesRequestQuery(request, requestSearchQuery)),
    [requestSearchQuery, requests],
  );
  const filteredRequests = useMemo(
    () => requests.filter(request =>
      (requestFilter === 'all' || request.status === requestFilter) &&
      matchesRequestQuery(request, requestSearchQuery),
    ),
    [requestFilter, requestSearchQuery, requests],
  );
  const requestCounts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter(request => request.status === 'pending').length,
    in_progress: requests.filter(request => request.status === 'in_progress').length,
    completed: requests.filter(request => request.status === 'completed').length,
    cancelled: requests.filter(request => request.status === 'cancelled').length,
  }), [requests]);

  function toggleLanguage(language: string) {
    setTargetLanguages(current => current.includes(language)
      ? current.filter(item => item !== language)
      : [...current, language]);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    setSubmittedName('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/video-manager/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, videoType, sourceUrl, targetLanguages }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not submit the video request.');
      setSubmittedName(projectName.trim());
      setProjectName('');
      setVideoType(null);
      setSourceUrl('');
      setTargetLanguages([]);
      setActiveView('request-status');
      setRequestFilter('all');
      await loadRequests(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not submit the video request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelRequest(request: SubmittedRequest) {
    if (!window.confirm(`Cancel "${request.project_name}"? It will stay in your request history as cancelled.`)) return;
    setRequestAction({ id: request.id, action: 'cancel' });
    setRequestsError('');
    try {
      const response = await fetch('/api/video-manager/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id, action: 'cancel' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not cancel this request.');
      setRequests(current => current.map(item => item.id === request.id ? { ...item, status: 'cancelled' } : item));
    } catch (error) {
      setRequestsError(error instanceof Error ? error.message : 'Could not cancel this request.');
    } finally {
      setRequestAction(null);
    }
  }

  async function deleteRequest(request: SubmittedRequest) {
    if (!window.confirm(`Permanently delete "${request.project_name}"? This cannot be undone.`)) return;
    setRequestAction({ id: request.id, action: 'delete' });
    setRequestsError('');
    try {
      const response = await fetch('/api/video-manager/requests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not delete this request.');
      setRequests(current => current.filter(item => item.id !== request.id));
    } catch (error) {
      setRequestsError(error instanceof Error ? error.message : 'Could not delete this request.');
    } finally {
      setRequestAction(null);
    }
  }

  return (
    <ProductDashboardShell
      productId="video-manager"
      accountEmail={accountEmail}
      accountAvatar={accountAvatar}
      initialFeatureId="create-job"
      onFeatureSelect={setActiveView}
    >
      <div className={`video-manager-dashboard${activeView === 'request-status' ? ' video-manager-dashboard-status' : ''}`}>
        {activeView === 'create-job' ? <>
          <section className="video-manager-create-card panel" aria-labelledby="video-manager-new-request-title">
            <header className="video-manager-create-heading">
              <div className="video-manager-create-heading-icon"><Plus size={19}/></div>
              <div>
                <span className="section-kicker">NEW REQUEST</span>
                <h2 id="video-manager-new-request-title">Create a dubbing request</h2>
                <p>Add the source link, video format, and every language you need.</p>
              </div>
            </header>

            <form className="video-manager-job-form" onSubmit={submitRequest}>
              <label className="video-manager-form-field">
                <span>Video name</span>
                <input value={projectName} onChange={event => setProjectName(event.target.value)} minLength={2} maxLength={120} placeholder="e.g. The benefits of mindful eating" required/>
              </label>

              <label className="video-manager-form-field">
                <span>Source video link <small>Use a link the dubbing team can open</small></span>
                <span className="video-manager-url-field"><Link2 size={17}/><input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…" required/><ArrowUpRight size={15}/></span>
              </label>

              <fieldset className="video-manager-choice-field">
                <legend>Video format</legend>
                <div className="video-manager-format-options">
                  <button type="button" className={`video-manager-format-option${videoType === 'short' ? ' selected' : ''}`} aria-pressed={videoType === 'short'} onClick={() => setVideoType('short')}>
                    <span className="video-manager-format-icon short"><span className="video-platform-pair"><Instagram size={15}/><Youtube size={15}/></span></span>
                    <span><b>Short-form</b><small>Reels and Shorts</small><span className="folder-platforms"><i className="folder-platform-badge instagram"><Instagram size={12}/> Instagram Reels</i><i className="folder-platform-badge youtube"><Youtube size={12}/> YouTube Shorts</i></span></span>
                    {videoType === 'short' && <Check size={17}/>}
                  </button>
                  <button type="button" className={`video-manager-format-option${videoType === 'long' ? ' selected' : ''}`} aria-pressed={videoType === 'long'} onClick={() => setVideoType('long')}>
                    <span className="video-manager-format-icon long"><Youtube size={19}/></span>
                    <span><b>Long-form</b><small>Full-length YouTube videos</small><span className="folder-platforms"><i className="folder-platform-badge youtube"><Youtube size={12}/> YouTube</i></span></span>
                    {videoType === 'long' && <Check size={17}/>}
                  </button>
                </div>
              </fieldset>

              <fieldset className="video-manager-choice-field">
                <legend>Languages to dub <small>Select all that apply</small></legend>
                <div className="video-manager-language-options">
                  {VIDEO_MANAGER_LANGUAGES.map(language => <label className={`video-manager-language-option${targetLanguages.includes(language) ? ' selected' : ''}`} key={language}>
                    <input type="checkbox" checked={targetLanguages.includes(language)} onChange={() => toggleLanguage(language)}/>
                    <span>{targetLanguages.includes(language) && <Check size={12}/>}</span>{language}
                  </label>)}
                </div>
                <small className="video-manager-language-count">{targetLanguages.length ? `${targetLanguages.length} ${targetLanguages.length === 1 ? 'language' : 'languages'} selected` : 'Choose one or more target languages.'}</small>
              </fieldset>

              {submitError && <p className="video-manager-form-error" role="alert">{submitError}</p>}
              {submittedName && <p className="video-manager-form-success" role="status"><CheckCircle2 size={16}/> “{submittedName}” was added to your request list.</p>}

              <footer className="video-manager-form-footer">
                <span><Clock3 size={14}/> The dubbing team will review your request.</span>
                <button className="primary-btn" type="submit" disabled={submitting || !videoType || targetLanguages.length === 0}>
                  {submitting ? <><LoaderCircle size={16} className="spin"/> Sending…</> : <>Create request <ArrowRight size={16}/></>}
                </button>
              </footer>
            </form>
          </section>
        </> : <>
          <header className="welcome-row video-manager-status-header">
            <div>
              <h1>Request status</h1>
              <p className="welcome-subtitle">See where each video is in the dubbing workflow.</p>
            </div>
            <button type="button" className="video-manager-refresh" onClick={() => void loadRequests(true)} disabled={requestsRefreshing}>
              {requestsRefreshing ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>} Refresh
            </button>
          </header>

          <section className="video-manager-status-metrics" aria-label="Request summary">
            <article className="metric-card"><span className="video-manager-metric-icon"><Languages size={17}/></span><b>{requestCounts.all}</b><small>Total requests</small></article>
            <article className="metric-card"><span className="video-manager-metric-icon pending"><Clock3 size={17}/></span><b>{requestCounts.pending}</b><small>Pending</small></article>
            <article className="metric-card"><span className="video-manager-metric-icon working"><ArrowDownToLine size={17}/></span><b>{requestCounts.in_progress}</b><small>In progress</small></article>
            <article className="metric-card"><span className="video-manager-metric-icon complete"><CheckCircle2 size={17}/></span><b>{requestCounts.completed}</b><small>Completed</small></article>
          </section>

          <section className="video-manager-requests panel" aria-labelledby="video-manager-requests-title">
            <header className="panel-heading">
              <div><span className="section-kicker">YOUR VIDEOS</span><h2 id="video-manager-requests-title">Dubbing requests <span className="heading-count">{filteredRequests.length}</span></h2></div>
              <div className="video-manager-request-tools">
                <button ref={requestSearchTriggerRef} type="button" className="search-box search-trigger video-manager-request-search" onClick={openRequestSearch} aria-haspopup="dialog" aria-expanded={requestSearchOpen}>
                  <Search size={14}/><span>Search requests</span><kbd>⌘ K</kbd>
                </button>
                <div className="video-manager-request-filters" role="group" aria-label="Filter requests">
                  {requestFilters.map(filter => <button key={filter.id} type="button" className={requestFilter === filter.id ? 'active' : ''} aria-pressed={requestFilter === filter.id} onClick={() => setRequestFilter(filter.id)}>{filter.label}<span>{requestCounts[filter.id]}</span></button>)}
                </div>
              </div>
            </header>
            {requestsError && <p className="video-manager-list-error" role="alert">{requestsError}</p>}
            {requestsLoading ? <div className="video-manager-list-state"><LoaderCircle size={18} className="spin"/> Loading your requests…</div>
              : filteredRequests.length === 0 ? <div className="video-manager-list-empty"><span><Languages size={20}/></span><b>{!requests.length ? 'No video requests yet' : requestSearchQuery.trim() ? 'No matching requests' : 'No requests in this status'}</b><small>{!requests.length ? 'Create a dub job to see its progress here.' : requestSearchQuery.trim() ? 'Try another video name, language, or status.' : 'Choose another filter to see your requests.'}</small></div>
                : filteredRequests.length > 0 && <div className="video-manager-request-table-wrap">
                  <table className="video-manager-request-table">
                    <thead><tr><th scope="col">Name</th><th scope="col">Target languages</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Actions</th></tr></thead>
                    <tbody>{filteredRequests.map(request => <tr key={request.id}>
                      <td data-label="Name">
                        <div className="video-manager-request-name">
                          <span className={`video-manager-request-format ${request.video_type}`}>{request.video_type === 'short' ? <span className="video-platform-pair"><Instagram size={14}/><Youtube size={14}/></span> : <Youtube size={18}/>}<small>{request.video_type === 'short' ? 'SHORT' : 'LONG'}</small></span>
                          <span><b>{request.project_name}</b><small>{request.video_type === 'short' ? 'Instagram Reels · YouTube Shorts' : 'YouTube video'}</small></span>
                        </div>
                      </td>
                      <td data-label="Target languages"><div className="video-manager-request-languages">{request.target_languages.map(language => <span key={language}>{language}</span>)}</div></td>
                      <td data-label="Submitted" className="video-manager-request-date">{new Date(request.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td data-label="Status"><span className={`video-manager-request-status ${request.status}`}>{request.status.replace('_', ' ')}</span></td>
                      <td data-label="Source"><a className="video-manager-source-link" href={request.source_url} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={14}/></a></td>
                      <td data-label="Actions"><div className="video-manager-request-actions">
                        {(request.status === 'pending' || request.status === 'in_progress') && <button type="button" className="video-manager-request-action cancel" onClick={() => void cancelRequest(request)} disabled={requestAction !== null} aria-label={`Cancel ${request.project_name}`}>
                          {requestAction?.id === request.id && requestAction.action === 'cancel' ? <LoaderCircle size={13} className="spin"/> : <Ban size={13}/>} {requestAction?.id === request.id && requestAction.action === 'cancel' ? 'Cancelling…' : 'Cancel'}
                        </button>}
                        <button type="button" className="video-manager-request-action delete" onClick={() => void deleteRequest(request)} disabled={requestAction !== null} aria-label={`Delete ${request.project_name}`}>
                          {requestAction?.id === request.id && requestAction.action === 'delete' ? <LoaderCircle size={13} className="spin"/> : <Trash2 size={13}/>} {requestAction?.id === request.id && requestAction.action === 'delete' ? 'Deleting…' : 'Delete'}
                        </button>
                      </div></td>
                    </tr>)}</tbody>
                  </table>
                </div>}
          </section>
        </>}
        {requestSearchOpen && <div className={`spotlight-backdrop${requestSearchClosing ? ' closing' : ''}`} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeRequestSearch(); }}>
          <section className="spotlight-panel video-manager-search-dock" role="dialog" aria-modal="true" aria-label="Search dubbing requests" style={{ transformOrigin: `${requestSearchOrigin.x}px ${requestSearchOrigin.y}px` }}>
            <div className="spotlight-input-row"><Search size={21} aria-hidden="true"/><input ref={requestSearchInputRef} value={requestSearchQuery} onChange={event => setRequestSearchQuery(event.target.value)} placeholder="Search by video, language, status, or link…" aria-label="Search requests" onKeyDown={event => {
              if (event.key === 'Escape') closeRequestSearch();
              if (event.key === 'Enter' && matchingRequests[0]) selectRequestSearchResult(matchingRequests[0]);
            }}/><button type="button" className="spotlight-escape" onClick={closeRequestSearch}>ESC</button></div>
            <div className="spotlight-results" role="listbox" aria-label="Matching video requests">
              <div className="spotlight-section-label">{requestSearchQuery.trim() ? `${matchingRequests.length} MATCHING REQUESTS` : 'RECENT REQUESTS'}</div>
              {(requestSearchQuery.trim() ? matchingRequests : requests).slice(0, 8).map(request => <button type="button" key={request.id} className="spotlight-result" role="option" aria-selected="false" onClick={() => selectRequestSearchResult(request)}>
                <span className="spotlight-folder-icon"><Languages size={16}/></span><span className="spotlight-result-copy"><b>{request.project_name}</b><small>{request.video_type === 'short' ? 'Short-form · Instagram Reels + YouTube Shorts' : 'Long-form · YouTube'} · {request.target_languages.join(', ')}</small></span><span className={`spotlight-status ${request.status.replace('_', '-')}`}>{request.status.replace('_', ' ')}</span><ArrowRight className="spotlight-result-arrow" size={16}/>
              </button>)}
              {!(requestSearchQuery.trim() ? matchingRequests : requests).length && <div className="spotlight-empty"><Search size={19}/><b>{requests.length ? 'No matching requests' : 'No video requests yet'}</b><span>{requests.length ? 'Try another video name, language, or status.' : 'Create a dub job to see it here.'}</span></div>}
            </div>
            <footer className="spotlight-footer"><span><kbd>↵</kbd> Filter requests</span><span><kbd>ESC</kbd> Close</span></footer>
          </section>
        </div>}
      </div>
    </ProductDashboardShell>
  );
}
