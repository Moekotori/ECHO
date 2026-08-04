export const showAudioErrorNoticeEvent = 'app:show-audio-error-notice';

export type AudioErrorNoticeEventDetail =
  | string
  | {
      message?: unknown;
    };

export const getErrorNoticeMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }

  return String(value);
};

export const dispatchAudioErrorNotice = (value: unknown): void => {
  const message = getErrorNoticeMessage(value).trim();
  if (!message) {
    return;
  }

  window.dispatchEvent(new CustomEvent<AudioErrorNoticeEventDetail>(showAudioErrorNoticeEvent, { detail: { message } }));
};
