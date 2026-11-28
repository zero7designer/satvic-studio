'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import ProductDashboardShell from '@/features/dashboard/client/ProductDashboardShell';
import { VIDEO_MANAGER_LANGUAGES, type VideoManagerVideoType } from '@/features/video-manager/constants';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2, Clock3,
  ExternalLink, Instagram, Languages, Link2, LoaderCircle, Plus, RefreshCw, Youtube,
} from 'lucide-react';

type RequestStatus = 'pending' | 'in_progress' | 'completed';
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
];

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
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('all');

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

  const filteredRequests = useMemo(
    () => requests.filter(request => requestFilter === 'all' || request.status === requestFilter),
    [requestFilter, requests],
  );
  const requestCounts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter(request => request.status === 'pending').length,
    in_progress: requests.filter(request => request.status === 'in_progress').length,
    completed: requests.filter(request => request.status === 'completed').length,
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

  return (
    <ProductDashboardShell
      productId="video-manager"
      accountEmail={accountEmail}
      accountAvatar={accountAvatar}
      initialFeatureId="create-job"
      onFeatureSelect={setActiveView}
    >
      <div className="video-manager-dashboard">
        {activeView === 'create-job' ? <>
          <header className="welcome-row">
            <div>
              <span className="eyebrow"><span className="eyebrow-line"/> VIDEO MANAGER</span>
              <h1>Create dub job</h1>
              <p className="welcome-subtitle">Send a video and language requirements to the dubbing team.</p>
            </div>
          </header>

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
                    <span className="video-manager-format-icon short"><Instagram size={18}/></span>
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
              <span className="eyebrow"><span className="eyebrow-line"/> VIDEO MANAGER</span>
              <h1>Request status</h1>
              <p className="welcome-subtitle">Follow your videos from submission through the dubbing queue.</p>
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
              <div className="video-manager-request-filters" role="group" aria-label="Filter requests">
                {requestFilters.map(filter => <button key={filter.id} type="button" className={requestFilter === filter.id ? 'active' : ''} aria-pressed={requestFilter === filter.id} onClick={() => setRequestFilter(filter.id)}>{filter.label}<span>{requestCounts[filter.id]}</span></button>)}
              </div>
            </header>
            {requestsError && <p className="video-manager-list-error" role="alert">{requestsError}</p>}
            {requestsLoading ? <div className="video-manager-list-state"><LoaderCircle size={18} className="spin"/> Loading your requests…</div>
              : filteredRequests.length === 0 ? <div className="video-manager-list-empty"><span><Languages size={20}/></span><b>{requests.length ? 'No requests in this status' : 'No video requests yet'}</b><small>{requests.length ? 'Choose another filter to see your requests.' : 'Create a dub job to see its progress here.'}</small></div>
                : <div className="video-manager-request-list">{filteredRequests.map(request => <article className="video-manager-request-row" key={request.id}>
                  <span className={`video-manager-request-format ${request.video_type}`}>{request.video_type === 'short' ? <Instagram size={17}/> : <Youtube size={18}/>}<small>{request.video_type === 'short' ? 'SHORT' : 'LONG'}</small></span>
                  <div className="video-manager-request-info">
                    <div className="video-manager-request-title"><h3>{request.project_name}</h3><span className={`video-manager-request-status ${request.status}`}>{request.status.replace('_', ' ')}</span></div>
                    <p>{request.target_languages.join(' · ')}</p>
                    <small>{new Date(request.created_at).toLocaleString()}</small>
                  </div>
                  <a className="video-manager-source-link" href={request.source_url} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={14}/></a>
                </article>)}</div>}
          </section>
        </>}
      </div>
    </ProductDashboardShell>
  );
}
