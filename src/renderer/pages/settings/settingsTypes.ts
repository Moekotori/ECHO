import type { NeteaseQrLoginState } from '../../../shared/types/accounts';

export type SettingsNavKey =
  | 'general'
  | 'experimental'
  | 'advancedCustom'
  | 'playback'
  | 'shortcuts'
  | 'lyrics'
  | 'mv'
  | 'integrations'
  | 'accounts'
  | 'plugins'
  | 'remote'
  | 'eq'
  | 'appearance'
  | 'accessibility'
  | 'library'
  | 'about'
  | 'steam'
  | 'danger';

export type AccountBusyAction = 'save' | 'check' | 'clear' | 'browser' | 'login';

export type NeteaseQrLoginUiState = {
  open: boolean;
  busy: boolean;
  key: string | null;
  qrUrl: string | null;
  qrDataUrl: string | null;
  expiresAt: string | null;
  state: NeteaseQrLoginState | 'idle' | 'creating';
  message: string | null;
  error: string | null;
};

export const initialNeteaseQrLoginState: NeteaseQrLoginUiState = {
  open: false,
  busy: false,
  key: null,
  qrUrl: null,
  qrDataUrl: null,
  expiresAt: null,
  state: 'idle',
  message: null,
  error: null,
};
