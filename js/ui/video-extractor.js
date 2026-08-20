/**
 * @fileoverview Extracts N evenly-spaced frames from a video file, client-side,
 * for use as a time-lapse series (no server, no transcoding library — just
 * <video> seeking + <canvas> drawImage). Produces frames in the exact shape
 * the pipeline expects (see core/frame-utils.js), plus a matching hours array.
 */

import { canvasToFrame } from '../core/frame-utils.js';

const MAX_DIM = 1600; // cap extracted-frame resolution to bound memory/perf

/**
 * @param {File} file
 * @param {{frameCount: number, totalHours: number}} opts
 * @param {(index: number, count: number) => void} [onProgress]
 * @returns {Promise<{images: Array<{data: Float32Array, width: number, height: number, channels: number}>, hours: number[]}>}
 */
export function extractFramesFromVideo(file, { frameCount, totalHours }, onProgress) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.display = 'none';
    document.body.appendChild(video);

    const cleanup = () => {
      video.remove();
      URL.revokeObjectURL(video.src);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Could not read this video file — try a different format (MP4/WebM/MOV).'));
    };

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration;
        if (!isFinite(duration) || duration <= 0) {
          throw new Error('Video has no readable duration.');
        }

        const width = Math.min(video.videoWidth, MAX_DIM);
        const scale = width / video.videoWidth;
        const height = Math.round(video.videoHeight * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const images = [];
        const hours = [];
        // Keep a small margin off the very end — seeking exactly to `duration`
        // is unreliable in some browsers.
        const lastT = Math.max(0, duration - 0.05);

        for (let i = 0; i < frameCount; i++) {
          const t = frameCount > 1 ? (lastT * i) / (frameCount - 1) : 0;
          await seekTo(video, t);
          ctx.drawImage(video, 0, 0, width, height);
          images.push(canvasToFrame(canvas));
          hours.push(frameCount > 1 ? (totalHours * i) / (frameCount - 1) : 0);
          if (onProgress) onProgress(i + 1, frameCount);
        }

        cleanup();
        resolve({ images, hours });
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.src = URL.createObjectURL(file);
  });
}

/**
 * Seek a <video> to a given time and resolve once the frame is actually
 * ready to be drawn (waits for `seeked`, with a timeout fallback since some
 * browsers don't fire it reliably for every seek).
 */
function seekTo(video, t) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    setTimeout(done, 1500); // fallback in case 'seeked' doesn't fire
    video.currentTime = t;
  });
}
