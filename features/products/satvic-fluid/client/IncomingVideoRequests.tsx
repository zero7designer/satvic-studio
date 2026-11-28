'use client';

import { useEffect, useState } from 'react';
import { Clock3, ExternalLink, Instagram, LoaderCircle, RefreshCw, UserRound, Youtube } from 'lucide-react';

export type IncomingVideoRequest = {
  id: string;
  submitter_name: string;
  submitter_email: string;
  project_name: string;
  video_type: 'short' | 'long';
  source_url: string;
  target_languages: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
};

type Props = {
  videoType: 'short' | 'long';
  selectedDate: string | null;
  onRequestsChange?: (requests: IncomingVideoRequest[]) => void;
};

function requestDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function IncomingVideoRequests({ videoType, selectedDate, onRequestsChange }: Props) {
  const [requests, setRequests] = useState<IncomingVideoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);
  const activeRequests = requests.filter(request => request.video_type === videoType && request.status !== 'completed' && request.status !== 'cancelled');
  const visibleRequests = selectedDate
    ? activeRequests.filter(request => requestDateKey(request.created_at) === selectedDate)
    : activeRequests;

  async function loadRequests(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const response = await fetch('/api/video-manager/requests', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load incoming requests.');
      setRequests(body.requests || []);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load incoming requests.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function updateStatus(request: IncomingVideoRequest) {
    if (request.status !== 'pending' && request.status !== 'in_progress') return;
    const status = request.status === 'pending' ? 'in_progress' : 'completed';
    setUpdatingRequestId(request.id);
    setError('');
    try {
      const response = await fetch('/api/video-manager/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id, status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not update this request.');
      setRequests(current => current.map(item => item.id === request.id ? { ...item, status } : item));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update this request.');
    } finally {
      setUpdatingRequestId(null);
    }
  }

  useEffect(() => {
    void loadRequests();
    const timer = window.setInterval(() => void loadRequests(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { onRequestsChange?.(requests); }, [onRequestsChange, requests]);

  return (
    <section className="workflow-tasks-panel incoming-video-requests" aria-labelledby="incoming-video-requests-title">
      <header className="workflow-overview-heading incoming-video-requests-heading">
        <div className="workflow-overview-title"><span><Clock3 size={16}/></span><div><span className="section-kicker">VIDEO MANAGER HANDOFF</span><h2 id="incoming-video-requests-title">Incoming video requests</h2></div></div>
        <span className="workflow-task-total">{visibleRequests.length} active</span>
        <button type="button" className="incoming-video-refresh" onClick={() => void loadRequests(true)} disabled={refreshing} aria-label="Refresh incoming video requests">
          {refreshing ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>} Refresh
        </button>
      </header>
      {loading ? <div className="incoming-video-state"><LoaderCircle size={16} className="spin"/> Loading requests…</div>
        : <>{error && <div className="incoming-video-error" role="alert">{error}</div>}
          {visibleRequests.length === 0 ? error ? null : <div className="incoming-video-empty"><span><Clock3 size={17}/></span><div><b>{selectedDate ? 'No new requests on this date' : `No active ${videoType === 'short' ? 'Short-form' : 'Long-form'} requests`}</b><small>New Video Manager submissions will appear here until completed.</small></div></div>
            : <div className="incoming-video-list">{visibleRequests.map(request => <article className="incoming-video-card" key={request.id}>
              <div className={`incoming-video-format ${request.video_type}`}>
                {request.video_type === 'short' ? <span className="video-platform-pair"><Instagram size={14}/><Youtube size={14}/></span> : <Youtube size={18}/>}
                <small>{request.video_type === 'short' ? 'SHORT' : 'LONG'}</small>
              </div>
              <div className="incoming-video-main">
                <div className="incoming-video-card-heading">
                  <div className="incoming-video-title-row"><h3>{request.project_name}</h3><span className={`incoming-video-status ${request.status}`}>{request.status.replace('_', ' ')}</span></div>
                  <div className="incoming-video-actions">
                    <a className="incoming-video-link" href={request.source_url} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={15}/></a>
                    {(request.status === 'pending' || request.status === 'in_progress') && <button className="incoming-video-status-action" type="button" disabled={updatingRequestId === request.id} onClick={() => void updateStatus(request)}>
                      {updatingRequestId === request.id ? 'Saving…' : request.status === 'pending' ? 'Start' : 'Complete'}
                    </button>}
                  </div>
                </div>
                <div className="incoming-video-meta">
                  <span className="incoming-video-requester" title={request.submitter_email} aria-label={`Requested by ${request.submitter_name}, email ${request.submitter_email}`}>
                    <UserRound size={14}/>{request.submitter_name}
                  </span>
                  <small className="incoming-video-date"><Clock3 size={13}/><span>{new Date(request.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></small>
                </div>
                <div className="incoming-video-language-row">
                  <span>Languages</span>
                  <div className="incoming-video-languages" aria-label="Target languages">{request.target_languages.map(language => <span key={language}>{language}</span>)}</div>
                </div>
              </div>
            </article>)}</div>}
        </>}
    </section>
  );
}
