/**
 * Capability detection utilities for AI runtimes.
 *
 * Provides functions to detect whether the current environment supports
 * WebGPU, WebGL2, WebGL, or only CPU (wasm). This information can be
 * displayed to the user and used to select the most efficient backend.
 */

/**
 * Detect the highest available graphics API.
 *
 * @returns {'webgpu'|'webgl2'|'webgl'|'wasm'} A string representing the
 *   best available compute backend.  'webgpu' is highest and 'wasm' is
 *   lowest.  WebGL2 is preferred over WebGL if supported.
 */
export function detectCapabilities() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    return 'webgpu';
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    try {
      if (canvas.getContext && canvas.getContext('webgl2')) {
        return 'webgl2';
      }
      if (canvas.getContext && canvas.getContext('webgl')) {
        return 'webgl';
      }
    } catch (err) {
      // ignore errors and fall back
    }
  }
  return 'wasm';
}