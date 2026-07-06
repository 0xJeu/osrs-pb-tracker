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
      <button type="button" className="feedback-trigger" onClick={() => setOpen(true)}>
        Feedback
      </button>
    );
  }

  return (
    <div className="feedback-panel">
      {status === 'sent' ? (
        <>
          <p>Thanks - that helps a lot while this is still in beta.</p>
          <button type="button" onClick={reset}>
            Close
          </button>
        </>
      ) : (
        <>
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
            <p className="feedback-error">Couldn't send that - try again in a moment.</p>
          )}
          <div className="feedback-actions">
            <button type="button" onClick={reset} className="feedback-cancel">
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={!message.trim() || status === 'sending'}>
              {status === 'sending' ? 'Sending...' : 'Send feedback'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
