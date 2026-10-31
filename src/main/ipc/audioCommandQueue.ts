let audioCommandQueue: Promise<void> = Promise.resolve();

const AUDIO_COMMAND_TIMEOUT_MS = 15_000;

type AudioCommandQueueOptions = {
  onTimeout?: () => void;
};

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

const createAudioCommandTimeout = <T>(options: AudioCommandQueueOptions = {}): {
  promise: Promise<T>;
  clear: () => void;
} => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<T>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      console.warn('[audioCommandQueue] command timed out after 15 s');
      try {
        options.onTimeout?.();
      } catch (error) {
        console.warn(`[audioCommandQueue] timeout cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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

const runAudioCommandWithTimeout = async <T>(operation: Promise<T>, options: AudioCommandQueueOptions = {}): Promise<T> => {
  const timeout = createAudioCommandTimeout<T>(options);

  try {
    return await Promise.race([
      operation,
      timeout.promise,
    ]);
  } finally {
    timeout.clear();
  }
};

export const enqueueAudioCommand = <T>(fn: () => Promise<T> | T, options: AudioCommandQueueOptions = {}): Promise<T> => {
  const started = audioCommandQueue.then(() => {
    const operation = Promise.resolve().then(() => fn());
    return {
      operation,
      result: runAudioCommandWithTimeout(operation, options),
    };
  });
  const result = started.then(({ result: commandResult }) => commandResult);
  audioCommandQueue = started.then(({ operation }) => operation).then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export const flushAudioCommandQueue = (): Promise<void> => audioCommandQueue;
