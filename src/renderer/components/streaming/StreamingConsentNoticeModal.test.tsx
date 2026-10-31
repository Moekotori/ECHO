// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { StreamingConsentNoticeModal } from './StreamingConsentNoticeModal';

describe('StreamingConsentNoticeModal', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('uses the localized consent phrase', async () => {
    window.localStorage.setItem('echo-next.locale', 'en-US');
    const onConfirm = vi.fn();
    const ModalHarness = (): JSX.Element => {
      const [consent, setConsent] = useState('');
      return (
        <StreamingConsentNoticeModal
          consent={consent}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
          setConsent={setConsent}
        />
      );
    };

    render(
      <I18nProvider>
        <ModalHarness />
      </I18nProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Streaming Feature Notice' });
    expect(dialog.textContent).toContain('Type "I agree" to continue');
    expect(dialog.textContent).toContain('ECHO is fundamentally a local music player');
    expect(within(dialog).getByRole('button', { name: 'I agree and continue' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'I agree' } });
    fireEvent.click(await screen.findByRole('button', { name: 'I agree and continue' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
