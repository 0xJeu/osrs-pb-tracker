import { FormEvent, useState } from 'react';
import { api } from '../lib/api';

type SubmissionStatus = 'idle' | 'sending' | 'sent' | 'error';

function parseRecoveryId(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function RecoveryHelpPage({
  initialRecoveryId,
  state,
}: {
  initialRecoveryId?: number;
  state?: string;
}) {
  const [recoveryId, setRecoveryId] = useState(initialRecoveryId ? String(initialRecoveryId) : '');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<SubmissionStatus>('idle');
  const parsedId = parseRecoveryId(recoveryId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsedId || !message.trim()) return;
    setStatus('sending');
    try {
      await api.submitFeedback(message.trim(), `recovery:${parsedId}`);
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  return (
    <section className="recovery-page">
      <p className="recovery-kicker">Install mismatch recovery</p>
      <h1>Restore syncing after reinstalling RuneLite</h1>
      <p className="recovery-intro">
        PB Tracker quarantines a sync when the same RuneScape account appears from a different
        plugin installation. Your public PBs stay unchanged while the request is reviewed.
      </p>

      {initialRecoveryId && (
        <div className="recovery-id" aria-label={`Recovery ID ${initialRecoveryId}`}>
          Recovery ID <strong>#{initialRecoveryId}</strong>
          {state && <span>Current state: {state.replaceAll('_', ' ').toLowerCase()}</span>}
        </div>
      )}

      <div className="recovery-steps">
        <article>
          <span>1</span>
          <div><h2>Keep the recovery ID</h2><p>It links your support message to the quarantined request. It is not a password.</p></div>
        </article>
        <article>
          <span>2</span>
          <div><h2>Explain what changed</h2><p>For example: reinstalled RuneLite, moved computers, or restored a RuneLite profile.</p></div>
        </article>
        <article>
          <span>3</span>
          <div><h2>Wait for review</h2><p>Keep the plugin installed. An operator can resolve a contested request without exposing or resetting your credential.</p></div>
        </article>
      </div>

      <form className="recovery-form" onSubmit={submit}>
        <h2>Request recovery review</h2>
        <label htmlFor="recovery-id">Recovery ID</label>
        <input
          id="recovery-id"
          inputMode="numeric"
          value={recoveryId}
          onChange={(event) => { setRecoveryId(event.target.value); setStatus('idle'); }}
          placeholder="e.g. 42"
          required
        />
        {recoveryId && !parsedId && <p className="recovery-error">Enter a positive whole-number recovery ID.</p>}

        <label htmlFor="recovery-message">What changed?</label>
        <textarea
          id="recovery-message"
          value={message}
          onChange={(event) => { setMessage(event.target.value); setStatus('idle'); }}
          maxLength={2000}
          rows={5}
          placeholder="I reinstalled RuneLite on this computer and then my PB sync stopped…"
          required
        />
        <p className="recovery-safety">
          Do not include passwords, Jagex login details, install secrets, authenticator codes, or recovery codes.
        </p>
        {status === 'error' && <p className="recovery-error" role="alert">The request could not be sent. Please try again.</p>}
        {status === 'sent' ? (
          <p className="recovery-success" role="status">Your recovery request was submitted with ID #{parsedId}.</p>
        ) : (
          <button type="submit" disabled={!parsedId || !message.trim() || status === 'sending'}>
            {status === 'sending' ? 'Submitting…' : 'Submit recovery request'}
          </button>
        )}
      </form>
    </section>
  );
}

export { parseRecoveryId };
