/**
 * Capture the first decodable frame of a video URL as a PNG data URL.
 *
 * The Electron renderer cannot reach into the main process to read a frame
 * from `echo-wallpaper://`, so we use an in-page `<video>` element backed by
 * the same custom protocol and draw the current frame onto a 2D canvas once
 * metadata has loaded. The custom protocol is same-origin, so the canvas is
 * never tainted and `toDataURL` succeeds.
 *
 * The capture preserves the video's intrinsic dimensions so the editor's
 * committed framing maps 1:1 onto the real video layer; callers that only
 * need a thumbnail should re-encode the result themselves.
 */

export type VideoFirstFrame = {
  dataUrl: string;
  width: number;
  height: number;
};

const drawAt = (context: CanvasRenderingContext2D, video: HTMLVideoElement): void => {
  const naturalWidth = video.videoWidth;
  const naturalHeight = video.videoHeight;
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return;
  }
  context.canvas.width = naturalWidth;
  context.canvas.height = naturalHeight;
  context.drawImage(video, 0, 0, naturalWidth, naturalHeight);
};

const seekToFirstFrame = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      // 'currentTime' is already at 0 (or wherever the protocol started).
      resolve();
      return;
    }
    const onLoaded = (): void => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = (): void => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
      resolve();
    };
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });

export const captureVideoFirstFrame = (src: string): Promise<VideoFirstFrame | null> => {
  if (typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise<VideoFirstFrame | null>((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = src;

    const cleanup = (): void => {
      video.removeAttribute('src');
      video.load();
    };

    const finalize = (): void => {
      cleanup();
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width <= 0 || height <= 0) {
        resolve(null);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(null);
          return;
        }
        drawAt(context, video);
        const dataUrl = canvas.toDataURL('image/png');
        // Report the video's intrinsic dimensions so the editor can anchor the
        // committed framing to the original aspect — the data URL is a scaled
        // preview only.
        resolve({ dataUrl, width, height });
      } catch {
        resolve(null);
      }
    };

    void seekToFirstFrame(video).then(() => {
      // Some custom protocols need an explicit seek to expose the first frame.
      if (video.readyState >= 2) {
        finalize();
        return;
      }
      try {
        video.currentTime = 0;
      } catch {
        // ignore — finalize below will fail safely
      }
      const onSeeked = (): void => {
        video.removeEventListener('seeked', onSeeked);
        finalize();
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      // Safety net: if 'seeked' never fires, fall back after a short delay.
      window.setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        if (video.videoWidth > 0) {
          finalize();
        } else {
          resolve(null);
        }
      }, 1500);
    });
  });
};
