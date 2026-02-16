/*
 * Image processing worker.
 *
 * This WebWorker offloads heavy per‑pixel operations away from the main
 * thread. It supports simple spatial denoising (box blur) and deblurring
 * (sharpen) algorithms. When receiving a message the worker expects an
 * object containing:
 *   - id: unique request identifier used to correlate replies
 *   - type: processing type ('denoise' or 'deblur')
 *   - width: image width
 *   - height: image height
 *   - data: Uint8ClampedArray buffer with RGBA pixel data
 *
 * The worker returns a message with the same id and a `result` field
 * containing a Uint8ClampedArray of processed pixels. If the type is
 * unknown, the original data is returned. The worker does not modify
 * alpha values.
 */

/**
 * Apply a simple 3×3 box blur to the image data. This averages each
 * pixel with its eight neighbours. Border pixels are clamped to the
 * nearest valid coordinates. Alpha values are preserved. The algorithm
 * runs in O(n) and uses separate input and output arrays to avoid
 * overwriting data mid‑computation.
 *
 * @param {Uint8ClampedArray} data The RGBA pixel array
 * @param {number} width Width of the image
 * @param {number} height Height of the image
 * @returns {Uint8ClampedArray} Blurred pixel array
 */
function boxBlur(data, width, height) {
  const out = new Uint8ClampedArray(data.length);
  // Precompute offsets for neighbouring pixels
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0], [0,  0], [1,  0],
    [-1,  1], [0,  1], [1,  1],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy] of offsets) {
        const ix = Math.min(width - 1, Math.max(0, x + dx));
        const iy = Math.min(height - 1, Math.max(0, y + dy));
        const idx = (iy * width + ix) * 4;
        r += data[idx];
        g += data[idx + 1];
        b += data[idx + 2];
        a += data[idx + 3];
      }
      const outIdx = (y * width + x) * 4;
      out[outIdx] = r / 9;
      out[outIdx + 1] = g / 9;
      out[outIdx + 2] = b / 9;
      out[outIdx + 3] = a / 9;
    }
  }
  return out;
}

/**
 * Apply a simple 3×3 sharpen filter to the image data. This uses a
 * kernel that emphasises the center pixel while subtracting the values
 * of its four neighbours. The resulting values are clamped to the
 * valid [0,255] range. Alpha values are preserved.
 *
 * @param {Uint8ClampedArray} data The RGBA pixel array
 * @param {number} width Width of the image
 * @param {number} height Height of the image
 * @returns {Uint8ClampedArray} Sharpened pixel array
 */
function sharpen(data, width, height) {
  const out = new Uint8ClampedArray(data.length);
  // Sharpen kernel: emphasizes the center pixel and subtracts neighbours
  const kernel = [
    [0, -1, 0],
    [-1, 5, -1],
    [0, -1, 0],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ix = Math.min(width - 1, Math.max(0, x + kx));
          const iy = Math.min(height - 1, Math.max(0, y + ky));
          const idx = (iy * width + ix) * 4;
          const weight = kernel[ky + 1][kx + 1];
          r += data[idx] * weight;
          g += data[idx + 1] * weight;
          b += data[idx + 2] * weight;
          a += data[idx + 3] * weight;
        }
      }
      const outIdx = (y * width + x) * 4;
      // Clamp values to [0,255]
      out[outIdx] = Math.max(0, Math.min(255, r));
      out[outIdx + 1] = Math.max(0, Math.min(255, g));
      out[outIdx + 2] = Math.max(0, Math.min(255, b));
      out[outIdx + 3] = Math.max(0, Math.min(255, a));
    }
  }
  return out;
}

self.onmessage = (event) => {
  const { id, type, width, height, data } = event.data;
  let result;
  try {
    if (type === 'denoise') {
      result = boxBlur(new Uint8ClampedArray(data), width, height);
    } else if (type === 'deblur') {
      result = sharpen(new Uint8ClampedArray(data), width, height);
    } else {
      // Unknown type: return original data
      result = new Uint8ClampedArray(data);
    }
  } catch (err) {
    // On error, return original data
    result = new Uint8ClampedArray(data);
  }
  // Post back the result. We use Transferable to avoid copying large buffers.
  self.postMessage({ id, result }, [result.buffer]);
};