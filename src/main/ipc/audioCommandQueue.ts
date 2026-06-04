let audioCommandQueue: Promise<void> = Promise.resolve();

const AUDIO_COMMAND_TIMEOUT_MS = 15_000;

export class AudioCommandTimeoutError extends Error {
  readonly code = 'audio_command_timeout' as const;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super('audio_command_timeout');
    this.name = 'AudioCommandTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export const isAudioCommandTimeoutError = (error: unknown): error is AudioCommandTimeoutError => {
  if (error instanceof AudioCommandTimeoutError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.message === 'audio_command_timeout' ||
    (error as { code?: unknown }).code === 'audio_command_timeout';
};

const createAudioCommandTimeout = <T>(): {
  promise: Promise<T>;
  clear: () => void;
} => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<T>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      console.warn('[audioCommandQueue] command timed out after 15 s');
      reject(new AudioCommandTimeoutError(AUDIO_COMMAND_TIMEOUT_MS));
    }, AUDIO_COMMAND_TIMEOUT_MS);
  });

  return {
    promise,
    clear: () => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    },
  };
};

const runAudioCommandWithTimeout = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  const timeout = createAudioCommandTimeout<T>();

  try {
    return await Promise.race([
      Promise.resolve().then(() => fn()),
      timeout.promise,
    ]);
  } finally {
    timeout.clear();
  }
};

export const enqueueAudioCommand = <T>(fn: () => Promise<T> | T): Promise<T> => {
  const result = audioCommandQueue.then(() => runAudioCommandWithTimeout(fn));
  audioCommandQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export const flushAudioCommandQueue = (): Promise<void> => audioCommandQueue;
