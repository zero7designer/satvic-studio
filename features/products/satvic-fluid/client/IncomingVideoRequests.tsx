'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, ExternalLink, Instagram, LoaderCircle, RefreshCw, Youtube } from 'lucide-react';

type VideoRequest = {
  id: string;
  submitter_name: string;
  submitter_email: string;
  project_name: string;
  video_type: 'short' | 'long';
  source_url: string;
  target_languages: string[];
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
};

export default function IncomingVideoRequests() {
  const [requests, setRequests] = useState<VideoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);

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

  async function updateStatus(request: VideoRequest) {
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

  return (
    <section className="incoming-video-requests panel" aria-labelledby="incoming-video-requests-title">
      <header className="incoming-video-requests-heading">
        <div><div className="section-kicker">VIDEO MANAGER HANDOFF</div><h2 id="incoming-video-requests-title">Incoming video requests <span className="incoming-video-count">{requests.length}</span></h2></div>
        <button type="button" className="incoming-video-refresh" onClick={() => void loadRequests(true)} disabled={refreshing} aria-label="Refresh incoming video requests">
          {refreshing ? <LoaderCircle size={15} className="video-manager-spin"/> : <RefreshCw size={15}/>} Refresh
        </button>
      </header>
      {loading ? <div className="incoming-video-state"><LoaderCircle size={16} className="video-manager-spin"/> Loading requests…</div>
        : <>{error && <div className="incoming-video-error" role="alert">{error}</div>}
          {requests.length === 0 ? error ? null : <div className="incoming-video-empty"><span><Clock3 size={17}/></span><div><b>No incoming requests yet</b><small>New Video Manager submissions will show here.</small></div></div>
            : <div className="incoming-video-list">{requests.map(request => <article className="incoming-video-card" key={request.id}>
              <div className={`incoming-video-format ${request.video_type}`}>
                {request.video_type === 'short' ? <Instagram size={17}/> : <Youtube size={18}/>}
                <small>{request.video_type === 'short' ? 'SHORT' : 'LONG'}</small>
              </div>
              <div className="incoming-video-main">
                <div className="incoming-video-title-row"><h3>{request.project_name}</h3><span className={`incoming-video-status ${request.status}`}>{request.status.replace('_', ' ')}</span></div>
                <p>From {request.submitter_name} · {request.submitter_email}</p>
                <div className="incoming-video-languages"><b>Dub into</b>{request.target_languages.map(language => <span key={language}>{language}</span>)}</div>
                <small className="incoming-video-date">{new Date(request.created_at).toLocaleString()}</small>
              </div>
              <a className="incoming-video-link" href={request.source_url} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={14}/></a>
              {request.status !== 'completed' && <button className="incoming-video-status-action" type="button" disabled={updatingRequestId === request.id} onClick={() => void updateStatus(request)}>
                {updatingRequestId === request.id ? 'Saving…' : request.status === 'pending' ? 'Start' : 'Complete'}
              </button>}
              <ArrowUpRight className="incoming-video-arrow" size={16} aria-hidden="true"/>
            </article>)}</div>}
        </>}
    </section>
  );
}
