import { useCallback, useState } from 'react';
import { BookOpen, ExternalLink, Loader2, ShieldCheck, X } from 'lucide-react';
import { currentUserNoticeVersion, type AppSettings } from '../../../shared/types/appSettings';

type UserNoticeGateProps = {
  onAccepted: (settings: AppSettings | null) => void;
};

type NoticeLinkProps = {
  children: string;
  url: string;
};

const echoDocumentationUrl = 'https://echonext.moe/zh/docs/';
const echoCommunityBoundariesUrl = 'https://echonext.moe/zh/docs/community-boundaries/';

const copy = {
  title: 'ECHO \u7528\u6237\u987b\u77e5',
  description:
    '\u7ee7\u7eed\u4f7f\u7528 ECHO \u524d\u5fc5\u987b\u5148\u786e\u8ba4\u8fd9\u4e9b\u8fb9\u754c\u3002\u540c\u610f\u540e\u624d\u80fd\u8fdb\u5165\uff1b\u4e0d\u540c\u610f\u5c06\u9000\u51fa ECHO\u3002',
  docsPrefix: '\u9996\u5148\u8bf7\u9605\u8bfb ECHO \u6587\u6863\uff1a',
  docsSuffix: '\u3002\u6709\u4e0d\u61c2\u7684\u5185\u5bb9\uff0c\u8bf7\u4f18\u5148\u67e5\u770b\u6587\u6863\u3002',
  boundariesPrefix: '\u5f3a\u70c8\u8981\u6c42\u6240\u6709\u7528\u6237\u9605\u8bfb\u793e\u533a\u8fb9\u754c\uff1a',
  boundariesSuffix: '\u3002',
  locked:
    '\u8be5\u4e8b\u4ef6\u8ba9 ECHO \u9501\u5b9a\u4e86\u7f51\u76d8\u3001\u8fde\u63a5\u529f\u80fd\uff08AirPlay / DLNA / \u7535\u53f0 / HQPlayer\uff09\u548c\u90e8\u5206\u4e3b\u9898\u3002',
  dmca:
    'ECHO \u9075\u5b88 DMCA\uff0c\u4e0d\u63d0\u4f9b\u4e0b\u8f7d\uff0c\u4e5f\u4e0d\u4f1a\u534f\u52a9\u7ed5\u8fc7\u4f1a\u5458\u3001\u7248\u6743\u3001DRM \u6216\u5e73\u53f0\u9650\u5236\u3002',
  antiCrack:
    'ECHO \u4f1a\u6301\u7eed\u52a0\u5f3a\u53cd\u7834\u89e3\u548c\u5b8c\u6574\u6027\u4fdd\u62a4\uff1b\u7834\u89e3\u3001\u7ed5\u8fc7\u9501\u5b9a\u3001\u4f20\u64ad\u89e3\u9501\u65b9\u5f0f\u90fd\u4e0d\u88ab\u63a5\u53d7\u3002',
  bridgeError:
    '\u684c\u9762\u6865\u4e0d\u53ef\u7528\uff0c\u6682\u65f6\u65e0\u6cd5\u4fdd\u5b58\u7528\u6237\u987b\u77e5\u540c\u610f\u72b6\u6001\u3002',
  declineBridgeError:
    '\u4e0d\u540c\u610f\u7528\u6237\u987b\u77e5\u65f6\u4e0d\u80fd\u8fdb\u5165 ECHO\u3002\u8bf7\u5173\u95ed\u7a97\u53e3\u9000\u51fa\u3002',
  openDocs: '\u6253\u5f00\u6587\u6863',
  communityBoundaries: '\u793e\u533a\u8fb9\u754c',
  decline: '\u4e0d\u540c\u610f\uff0c\u9000\u51fa',
  accept: '\u6211\u5df2\u9605\u8bfb\u5e76\u540c\u610f',
} as const;

const openExternalUrl = (url: string): void => {
  const bridgeOpenExternalUrl = window.echo?.app?.openExternalUrl;
  if (bridgeOpenExternalUrl) {
    void bridgeOpenExternalUrl(url).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
};

const NoticeLink = ({ children, url }: NoticeLinkProps): JSX.Element => (
  <button className="user-notice-link" type="button" onClick={() => openExternalUrl(url)}>
    <span>{children}</span>
    <ExternalLink size={12} aria-hidden="true" />
  </button>
);

export const UserNoticeGate = ({ onAccepted }: UserNoticeGateProps): JSX.Element => {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.setSettings) {
      setError(copy.bridgeError);
      return;
    }

    try {
      setBusy('accept');
      setError(null);
      const settings = await app.setSettings({ userNoticeAcceptedVersion: currentUserNoticeVersion });
      window.dispatchEvent(new CustomEvent('settings:changed', { detail: settings }));
      onAccepted(settings);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : String(acceptError));
      setBusy(null);
    }
  }, [onAccepted]);

  const decline = useCallback(async (): Promise<void> => {
    const app = window.echo?.app;
    if (!app?.quit) {
      setError(copy.declineBridgeError);
      return;
    }

    try {
      setBusy('decline');
      setError(null);
      await app.quit();
    } catch (declineError) {
      setError(declineError instanceof Error ? declineError.message : String(declineError));
      setBusy(null);
    }
  }, []);

  return (
    <div className="user-notice-backdrop" role="dialog" aria-modal="true" aria-labelledby="user-notice-title" aria-describedby="user-notice-description">
      <section className="user-notice-panel">
        <header className="user-notice-header">
          <span className="section-kicker">ECHO Next</span>
          <h2 id="user-notice-title">{copy.title}</h2>
          <p id="user-notice-description">{copy.description}</p>
        </header>

        <div className="user-notice-body">
          <ol className="user-notice-list">
            <li>
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                {copy.docsPrefix}
                <NoticeLink url={echoDocumentationUrl}>{echoDocumentationUrl}</NoticeLink>
                {copy.docsSuffix}
              </span>
            </li>
            <li>
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                {copy.boundariesPrefix}
                <NoticeLink url={echoCommunityBoundariesUrl}>{echoCommunityBoundariesUrl}</NoticeLink>
                {copy.boundariesSuffix}
              </span>
            </li>
            {[copy.locked, copy.dmca, copy.antiCrack].map((item) => (
              <li key={item}>
                <ShieldCheck size={15} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="user-notice-actions">
          <button className="settings-action-button" type="button" onClick={() => openExternalUrl(echoDocumentationUrl)}>
            <BookOpen size={15} />
            {copy.openDocs}
          </button>
          <button className="settings-action-button" type="button" onClick={() => openExternalUrl(echoCommunityBoundariesUrl)}>
            <ExternalLink size={15} />
            {copy.communityBoundaries}
          </button>
        </div>

        {error ? <p className="settings-inline-error">{error}</p> : null}

        <footer className="user-notice-footer">
          <button className="settings-action-button" type="button" disabled={busy !== null} onClick={() => void decline()}>
            {busy === 'decline' ? <Loader2 className="spinning-icon" size={15} /> : <X size={15} />}
            {copy.decline}
          </button>
          <button className="settings-action-button user-notice-primary" type="button" disabled={busy !== null} onClick={() => void accept()}>
            {busy === 'accept' ? <Loader2 className="spinning-icon" size={15} /> : <ShieldCheck size={15} />}
            {copy.accept}
          </button>
        </footer>
      </section>
    </div>
  );
};
