import {
  defaultStreamingAudioQuality,
  type StreamingMediaType,
  type StreamingProviderName,
  type StreamingSearchResult,
} from '../../../shared/types/streaming';
import {
  readStreamingQualityPreference,
  type StreamingQualityPreference,
  writeStreamingQualityPreference,
} from '../../preferences/streamingQualityPreference';

export type { StreamingQualityPreference } from '../../preferences/streamingQualityPreference';
export { readStreamingQualityPreference, writeStreamingQualityPreference } from '../../preferences/streamingQualityPreference';

export type StreamingSearchMemory = {
  provider: StreamingProviderName;
  quality: StreamingQualityPreference;
  activeTab: StreamingMediaType;
  input: string;
  query: string;
  resultKey: string | null;
  result: StreamingSearchResult | null;
  failedCoverUrls: Record<string, string>;
  scrollTop: number;
};

const initialStreamingSearchMemory: StreamingSearchMemory = {
  provider: 'netease',
  quality: defaultStreamingAudioQuality,
  activeTab: 'track',
  input: '',
  query: '',
  resultKey: null,
  result: null,
  failedCoverUrls: {},
  scrollTop: 0,
};

let streamingSearchMemory: StreamingSearchMemory = {
  ...initialStreamingSearchMemory,
  quality: readStreamingQualityPreference(),
};

export const readStreamingSearchMemory = (): StreamingSearchMemory => {
  const quality = readStreamingQualityPreference();
  if (quality !== streamingSearchMemory.quality) {
    streamingSearchMemory = {
      ...streamingSearchMemory,
      quality,
    };
  }

  return streamingSearchMemory;
};

export const updateStreamingSearchMemory = (patch: Partial<StreamingSearchMemory>): StreamingSearchMemory => {
  if (patch.quality) {
    writeStreamingQualityPreference(patch.quality);
  }

  streamingSearchMemory = {
    ...streamingSearchMemory,
    ...patch,
  };

  return streamingSearchMemory;
};
