import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryHelpPage } from '../src/components/RecoveryHelpPage';
import { api } from '../src/lib/api';

describe('recovery help page', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('submits a player message under the exact recovery candidate context', async () => {
    const submit = vi.spyOn(api, 'submitFeedback').mockResolvedValue(undefined);
    render(<RecoveryHelpPage initialRecoveryId={42} state="RECOVERY_CONTESTED" />);

    expect(screen.getByLabelText('Recovery ID 42')).toBeInTheDocument();
    expect(screen.getByText(/do not include passwords/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What changed?'), {
      target: { value: 'I reinstalled RuneLite on a new computer.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit recovery request' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(
      'I reinstalled RuneLite on a new computer.',
      'recovery:42'
    ));
    expect(await screen.findByText('Your recovery request was submitted with ID #42.')).toBeInTheDocument();
  });

  it('does not allow malformed candidate IDs to be submitted', () => {
    render(<RecoveryHelpPage />);
    fireEvent.change(screen.getByLabelText('Recovery ID'), { target: { value: '12oops' } });
    fireEvent.change(screen.getByLabelText('What changed?'), { target: { value: 'Moved computers.' } });

    expect(screen.getByText('Enter a positive whole-number recovery ID.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit recovery request' })).toBeDisabled();
  });
});
