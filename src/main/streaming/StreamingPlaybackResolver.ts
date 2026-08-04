import type { StreamingPlaybackRequest, StreamingPlaybackSource } from '../../shared/types/streaming';
import type { StreamingProviderRegistry } from './StreamingProviderRegistry';

export class StreamingPlaybackResolver {
  constructor(private readonly registry: StreamingProviderRegistry) {}

  async resolve(request: StreamingPlaybackRequest): Promise<StreamingPlaybackSource> {
    const provider = this.registry.get(request.provider);
    return provider.resolvePlayback(request);
  }
}
