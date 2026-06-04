import type { StreamingProviderDescriptor, StreamingProviderName } from '../../shared/types/streaming';
import { streamingProviderNames } from '../../shared/types/streaming';
import type { StreamingProvider } from './StreamingProvider';

const providerDisplayNames: Record<StreamingProviderName, string> = {
  mock: 'Mock',
  netease: 'NetEase Cloud Music',
  qqmusic: 'QQ Music',
  kugou: 'KuGou Music',
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  tidal: 'TIDAL',
  m3u8: 'M3U8',
  plugin: '插件音源',
};

const defaultDescriptor = (provider: StreamingProvider): StreamingProviderDescriptor => ({
  name: provider.name,
  displayName: providerDisplayNames[provider.name],
  enabled: true,
  supportsSearch: true,
  supportsPlayback: true,
  supportsDownload: true,
  supportsLyrics: Boolean(provider.getLyrics),
  supportsMv: Boolean(provider.getMv),
  requiresAccount: false,
  ...provider.descriptor,
});

export class StreamingProviderRegistry {
  private readonly providers = new Map<StreamingProviderName, StreamingProvider>();

  register(provider: StreamingProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: StreamingProviderName): StreamingProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Streaming provider "${name}" is not registered.`);
    }

    return provider;
  }

  has(name: StreamingProviderName): boolean {
    return this.providers.has(name);
  }

  list(): StreamingProviderDescriptor[] {
    return streamingProviderNames.map((name) => {
      const provider = this.providers.get(name);
      if (provider) {
        return defaultDescriptor(provider);
      }

      return {
        name,
        displayName: providerDisplayNames[name],
        enabled: false,
        supportsSearch: false,
        supportsPlayback: false,
        supportsDownload: false,
        supportsLyrics: false,
        supportsMv: false,
        requiresAccount: name !== 'mock' && name !== 'm3u8' && name !== 'plugin',
      };
    });
  }
}
