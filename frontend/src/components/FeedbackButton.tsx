import { useState } from 'react';
import { api } from '../lib/api';

const MAX_LENGTH = 2000;

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function FeedbackButton({ context }: { context?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const reset = () => {
    setOpen(false);
    setMessage('');
    setStatus('idle');
  };

  const submit = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setStatus('sending');
    try {
      await api.submitFeedback(trimmed, context);
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="feedback-trigger"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="feedback-trigger-mark" aria-hidden="true">?</span>
        <span className="feedback-trigger-copy">
          <span className="feedback-trigger-label">Feedback</span>
          <span className="feedback-trigger-meta">Report an issue</span>
        </span>
      </button>
    );
  }

  return (
    <section className="feedback-panel" role="dialog" aria-label="Send feedback">
      <header className="feedback-panel-header">
        <div>
          <span className="feedback-kicker">Community channel</span>
          <h2>Send feedback</h2>
        </div>
        <button type="button" className="feedback-close" onClick={reset} aria-label="Close feedback">
          ×
        </button>
      </header>

      {status === 'sent' ? (
        <div className="feedback-body feedback-success" aria-live="polite">
          <span className="feedback-success-mark" aria-hidden="true">✓</span>
          <p>Thanks - that helps a lot while this is still in beta.</p>
          <button type="button" className="feedback-primary" onClick={reset}>
            Close
          </button>
        </div>
      ) : (
        <div className="feedback-body">
          <label htmlFor="feedback-message">
            Found a bug, a wrong PB, or something confusing? Say so here.
          </label>
          <textarea
            id="feedback-message"
            value={message}
            maxLength={MAX_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. My Colosseum PB never synced, even after opening the Counters page"
            rows={4}
          />
          {status === 'error' && (
            <p className="feedback-error" role="alert">Couldn't send that - try again in a moment.</p>
          )}
          <div className="feedback-footer">
            <span className="feedback-count" aria-live="polite">
              {message.length} / {MAX_LENGTH}
            </span>
            <div className="feedback-actions">
              <button type="button" onClick={reset} className="feedback-cancel">
                Cancel
              </button>
              <button
                type="button"
                className="feedback-primary"
                onClick={submit}
                disabled={!message.trim() || status === 'sending'}
              >
                {status === 'sending' ? 'Sending...' : 'Send feedback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
