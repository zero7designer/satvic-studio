'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/features/auth/server/actions';
import { VIDEO_MANAGER_LANGUAGES, type VideoManagerVideoType } from '@/features/video-manager/constants';
import {
  ArrowUpRight, Check, CheckCircle2, Clapperboard, ExternalLink, Instagram, Languages, Link2,
  LoaderCircle, LogOut, Send, Trash2, X, Youtube,
} from 'lucide-react';

type SubmittedRequest = {
  id: string;
  project_name: string;
  video_type: VideoManagerVideoType;
  source_url: string;
  target_languages: string[];
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
};

export default function VideoManagerDashboard({ accountEmail, fullName }: { accountEmail: string; fullName: string }) {
  const router = useRouter();
  const [projectName, setProjectName] = useState('');
  const [videoType, setVideoType] = useState<VideoManagerVideoType | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedName, setSubmittedName] = useState('');
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [myRequests, setMyRequests] = useState<SubmittedRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState('');
  const confirmationPrompt = accountEmail.trim() || 'DELETE';

  const loadMyRequests = useCallback(async () => {
    try {
      const response = await fetch('/api/video-manager/requests', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load your requests.');
      setMyRequests(body.requests || []);
      setRequestsError('');
    } catch (requestError) {
      setRequestsError(requestError instanceof Error ? requestError.message : 'Could not load your requests.');
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMyRequests();
    const timer = window.setInterval(() => void loadMyRequests(), 30000);
    return () => window.clearInterval(timer);
  }, [loadMyRequests]);

  function toggleLanguage(language: string) {
    setTargetLanguages(current => current.includes(language)
      ? current.filter(item => item !== language)
      : [...current, language]);
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
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
      void loadMyRequests();
      setProjectName('');
      setVideoType(null);
      setSourceUrl('');
      setTargetLanguages([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not submit the video request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not delete your account.');
      for (const key of Object.keys(window.localStorage)) {
        if (key === 'satvic-studio-dashboard-theme' || key === 'satvic-studio-dashboard-mode' || key.startsWith('satvic-cost-estimate:')) {
          window.localStorage.removeItem(key);
        }
      }
      router.replace('/login');
      router.refresh();
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : 'Could not delete your account.');
      setDeleteBusy(false);
    }
  }

  return (
    <main className="video-manager-page">
      <header className="video-manager-topbar">
        <a className="video-manager-brand" href="/dashboard" aria-label="Satvic Studio home">
          <span className="video-manager-brand-mark">✳</span>
          <span><b>Satvic Studio</b><small>VIDEO OPERATIONS</small></span>
        </a>
        <div className="video-manager-account">
          <span className="video-manager-role">Video Manager</span>
          <span className="video-manager-user">{fullName}</span>
          <div className="video-manager-account-actions">
            <form action={signOut}><button className="video-manager-signout" type="submit"><LogOut size={15}/> Log out</button></form>
            <button type="button" className="video-manager-delete-trigger" onClick={() => { setDeleteConfirmation(''); setDeleteError(''); setDeleteAccountOpen(true); }}><Trash2 size={14}/> Delete account</button>
          </div>
        </div>
      </header>

      <div className="video-manager-content">
        <section className="video-manager-welcome">
          <div className="video-manager-welcome-copy">
            <span className="video-manager-eyebrow"><span/> VIDEO LOCALIZATION WORKSPACE</span>
            <h1>Make every video<br/><em>feel at home.</em></h1>
            <p>Send your video and language requirements to the dubbing team. They’ll access the source and prepare the next steps.</p>
            <div className="video-manager-welcome-meta"><span><CheckCircle2 size={15}/> Request tracking</span><i/> <span><Languages size={15}/> 12 languages</span></div>
          </div>
          <div className="video-manager-orbit" aria-hidden="true">
            <div className="video-manager-orbit-ring ring-one"/><div className="video-manager-orbit-ring ring-two"/>
            <span className="video-manager-orbit-core"><Clapperboard size={28}/></span>
            <span className="video-manager-orbit-chip chip-short"><Instagram size={13}/> Reels & Shorts</span>
            <span className="video-manager-orbit-chip chip-long"><Youtube size={14}/> YouTube</span>
          </div>
        </section>

        <div className="video-manager-layout">
          <section className="video-request-panel">
            <div className="video-request-heading">
              <span className="video-request-icon"><Send size={17}/></span>
              <div><span className="video-manager-eyebrow">NEW REQUEST</span><h2>Send a video for dubbing</h2></div>
              <span className="video-request-step">01 <i/> 03</span>
            </div>
            <form className="video-request-form" onSubmit={submitRequest}>
              <label className="video-request-field">
                <span>Video name</span>
                <input value={projectName} onChange={event => setProjectName(event.target.value)} minLength={2} maxLength={120} placeholder="e.g. The benefits of mindful eating" required/>
              </label>

              <fieldset className="video-type-field">
                <legend>Choose video format</legend>
                <div className="video-manager-type-options">
                  <button type="button" className={`video-manager-type-option${videoType === 'short' ? ' selected' : ''}`} aria-pressed={videoType === 'short'} onClick={() => setVideoType('short')}>
                    <span className="video-manager-type-symbol short"><Instagram size={17}/></span>
                    <span><b>Short-form</b><small>Reels and Shorts</small><span className="video-manager-platforms"><i><Instagram size={11}/> Instagram Reels</i><i><Youtube size={11}/> YouTube Shorts</i></span></span>
                    {videoType === 'short' && <Check className="video-manager-type-check" size={17}/>}
                  </button>
                  <button type="button" className={`video-manager-type-option${videoType === 'long' ? ' selected' : ''}`} aria-pressed={videoType === 'long'} onClick={() => setVideoType('long')}>
                    <span className="video-manager-type-symbol long"><Youtube size={18}/></span>
                    <span><b>Long-form</b><small>Full-length videos</small><span className="video-manager-platforms"><i><Youtube size={11}/> YouTube</i></span></span>
                    {videoType === 'long' && <Check className="video-manager-type-check" size={17}/>}
                  </button>
                </div>
              </fieldset>

              <label className="video-request-field">
                <span>Source video link <small>Share a link the dubbing team can open</small></span>
                <span className="video-request-link-input"><Link2 size={16}/><input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…" required/><ArrowUpRight size={15}/></span>
              </label>
              <fieldset className="video-language-field">
                <legend>Languages to dub <small>Select all that apply</small></legend>
                <div className="video-language-options">{VIDEO_MANAGER_LANGUAGES.map(language => <label key={language} className={`video-language-option${targetLanguages.includes(language) ? ' selected' : ''}`}><input type="checkbox" checked={targetLanguages.includes(language)} onChange={() => toggleLanguage(language)}/><span className="video-language-check">{targetLanguages.includes(language) && <Check size={11}/>}</span>{language}</label>)}</div>
                <span className="video-language-selected">{targetLanguages.length ? `${targetLanguages.length} ${targetLanguages.length === 1 ? 'language' : 'languages'} selected` : 'Choose one or more languages'}</span>
              </fieldset>

              {error && <p className="video-request-error" role="alert">{error}</p>}
              {submittedName && <p className="video-request-success" role="status"><CheckCircle2 size={16}/> “{submittedName}” is in the dubbing team’s request queue.</p>}
              <button className="video-request-submit" type="submit" disabled={submitting || !videoType || targetLanguages.length === 0}>
                {submitting ? <><LoaderCircle size={16} className="video-manager-spin"/> Sending request…</> : <>Send to dubbing team <ArrowUpRight size={16}/></>}
              </button>
            </form>
          </section>

          <aside className="video-manager-side">
            <section className="video-manager-how">
              <span className="video-manager-eyebrow">A SIMPLE HANDOFF</span>
              <h2>From your link<br/>to every language.</h2>
              <ol>
                <li><span>1</span><div><b>Share the source</b><small>Add the video link and choose its format.</small></div></li>
                <li><span>2</span><div><b>Pick your languages</b><small>Tell the dubbing team where it should go.</small></div></li>
                <li><span>3</span><div><b>Team takes it from here</b><small>Your request appears in the Satvic Fluid dashboard.</small></div></li>
              </ol>
            </section>
            <section className="video-manager-history" aria-labelledby="video-manager-history-title">
              <header><span className="video-manager-eyebrow">YOUR SUBMISSIONS</span><h2 id="video-manager-history-title">Recent requests</h2></header>
              {requestsLoading ? <p className="video-manager-history-state"><LoaderCircle size={14} className="video-manager-spin"/> Loading requests…</p>
                : requestsError ? <p className="video-manager-history-state error" role="alert">{requestsError}</p>
                  : myRequests.length === 0 ? <p className="video-manager-history-state">Your submitted videos will appear here.</p>
                    : <div className="video-manager-history-list">{myRequests.slice(0, 5).map(request => <article key={request.id} className="video-manager-history-item">
                      <div><b>{request.project_name}</b><small>{request.video_type === 'short' ? 'Short-form' : 'Long-form'} · {request.target_languages.join(', ')}</small></div>
                      <span className={`video-manager-history-status ${request.status}`}>{request.status.replace('_', ' ')}</span>
                      <a href={request.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Open source link for ${request.project_name}`}><ExternalLink size={13}/></a>
                    </article>)}</div>}
            </section>
            <section className="video-manager-access-note"><span><Link2 size={16}/></span><div><b>Make sure the link is accessible</b><p>Anyone on the dubbing team who has the link should be able to view or download the source video.</p></div></section>
            <p className="video-manager-account-note">Signed in with Google as <b>{accountEmail}</b></p>
          </aside>
        </div>
      </div>
      {deleteAccountOpen && <div className="account-delete-backdrop">
        <section className="account-delete-modal" role="dialog" aria-modal="true" aria-labelledby="video-manager-delete-title" aria-describedby="video-manager-delete-description">
          <button type="button" className="account-delete-close" aria-label="Close dialog" onClick={() => { if (!deleteBusy) setDeleteAccountOpen(false); }}><X size={17}/></button>
          <span className="account-delete-icon"><Trash2 size={20}/></span>
          <h2 id="video-manager-delete-title">Delete your account?</h2>
          <p id="video-manager-delete-description">This permanently deletes your Satvic Studio profile and data, including any video requests you submitted. Shared files already copied outside Satvic Studio are not deleted.</p>
          <form onSubmit={deleteAccount}>
            <label htmlFor="video-manager-delete-confirmation">Type <strong>{confirmationPrompt}</strong> to confirm</label>
            <input id="video-manager-delete-confirmation" autoComplete="off" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} disabled={deleteBusy}/>
            {deleteError && <p className="account-delete-error" role="alert">{deleteError}</p>}
            <div className="account-delete-actions">
              <button type="button" className="account-delete-cancel" onClick={() => setDeleteAccountOpen(false)} disabled={deleteBusy}>Cancel</button>
              <button type="submit" className="account-delete-confirm" disabled={deleteBusy || deleteConfirmation.trim().toLowerCase() !== confirmationPrompt.toLowerCase()}>{deleteBusy ? <><LoaderCircle size={15} className="video-manager-spin"/> Deleting…</> : <><Trash2 size={15}/> Delete account and data</>}</button>
            </div>
          </form>
        </section>
      </div>}
    </main>
  );
}
