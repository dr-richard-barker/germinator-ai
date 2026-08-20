/**
 * @fileoverview Shared canvas → analysis-frame conversion, used by both the
 * image-file loader (app.js) and the video-frame extractor (ui/video-extractor.js)
 * so both input paths produce identical frame objects for the pipeline.
 */

/**
 * Convert a canvas (already drawn with a frame) into the float RGB buffer
 * shape the pipeline expects.
 * @param {HTMLCanvasElement} canvas
 * @returns {{data: Float32Array, width: number, height: number, channels: number}}
 */
export function canvasToFrame(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const rgba = imageData.data;

  const n = width * height;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    data[i * 3]     = rgba[i * 4]     / 255.0;
    data[i * 3 + 1] = rgba[i * 4 + 1] / 255.0;
    data[i * 3 + 2] = rgba[i * 4 + 2] / 255.0;
  }
  return { data, width, height, channels: 3 };
}
