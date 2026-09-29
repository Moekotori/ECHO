// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranslationKey } from '../../../i18n/locales';
import { PlaybackNoSoundGuideDialog } from './PlaybackNoSoundGuideDialog';
import { playbackNoSoundGuideSteps } from './playbackSettingsModel';

const translate = (key: TranslationKey): string => key;

describe('PlaybackNoSoundGuideDialog', () => {
  afterEach(cleanup);

  it('keeps guide navigation and completion actions in the extracted dialog', () => {
    const onClose = vi.fn();
    const onStepChange = vi.fn();
    const { rerender } = render(
      <PlaybackNoSoundGuideDialog
        activeStepIndex={0}
        control={<span>step control</span>}
        onClose={onClose}
        onStepChange={onStepChange}
        open
        t={translate}
      />,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('step control')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'firstRun.action.next' }));
    expect(onStepChange).toHaveBeenCalledWith(1);

    rerender(
      <PlaybackNoSoundGuideDialog
        activeStepIndex={playbackNoSoundGuideSteps.length - 1}
        control={<span>last step control</span>}
        onClose={onClose}
        onStepChange={onStepChange}
        open
        t={translate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'firstRun.action.finish' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
