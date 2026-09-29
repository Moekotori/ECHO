import { describe, expect, it } from 'vitest';
import {
  createEchoLinkMobileRemoteHtml,
  createEchoLinkMobileRemotePairingUrl,
  echoLinkMobileRemotePath,
} from './EchoLinkMobileRemote';

describe('EchoLinkMobileRemote', () => {
  it('keeps the one-time pairing credential in the URL fragment', () => {
    const pairingUri = 'echo://pair?version=2&host=192.168.1.20&port=26789&pairingId=pair-1&secret=secret-1';
    const remoteUrl = new URL(createEchoLinkMobileRemotePairingUrl('192.168.1.20', 26789, pairingUri));

    expect(remoteUrl.pathname).toBe(echoLinkMobileRemotePath);
    expect(remoteUrl.search).toBe('');
    expect(new URLSearchParams(remoteUrl.hash.slice(1)).get('pair')).toBe(pairingUri);
    expect(remoteUrl.toString()).not.toContain('?secret=');
  });

  it('formats IPv6 hosts for browser URLs', () => {
    const remoteUrl = new URL(createEchoLinkMobileRemotePairingUrl('::1', 26789, 'echo://pair?version=2'));

    expect(remoteUrl.hostname).toBe('[::1]');
    expect(remoteUrl.port).toBe('26789');
  });

  it('ships a dependency-free control page with private credential storage and SSE resync', () => {
    const html = createEchoLinkMobileRemoteHtml();
    const script = html.match(/<script>([\s\S]+)<\/script>/u)?.[1];

    expect(html).toContain('indexedDB.open');
    expect(html).toContain("history.replaceState(null, '', location.pathname + location.search)");
    expect(html).toContain("request('/events/ticket'");
    expect(html).toContain('new EventSource');
    expect(html).toContain("'playback.track.changed'");
    expect(html).toContain("sendAction('seek'");
    expect(html).toContain("sendAction('setVolume'");
    expect(html).toContain("sendAction('setPlaybackOrder'");
    expect(html).toContain("credential.apiBaseUrl + '/artwork/current'");
    expect(html).toContain('URL.createObjectURL');
    expect(html).toContain('<img class="artwork"');
    expect(html.match(/data-action="(?:toggleShuffle|previous|playToggle|next|toggleRepeatOne)"/gu)).toHaveLength(5);
    expect(html).toContain('id="mode-label"');
    expect(html).toContain('顺序播放');
    expect(html).toContain('随机播放');
    expect(html).toContain('单曲循环');
    expect(html).not.toContain('transport-divider');
    expect(html).not.toContain('data-action="stop"');
    expect(html).not.toContain('data-action="refresh"');
    expect(html).not.toContain('id="forget"');
    expect(html.toLowerCase()).not.toContain('#9ef01a');
    expect(html).not.toContain('linear-gradient');
    expect(html).not.toContain('radial-gradient');
    expect(html).not.toContain('localStorage');
    expect(html).not.toContain('<script src=');
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });
});
