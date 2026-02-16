/*
 * Universal AI inference worker using ONNX Runtime.
 *
 * This worker encapsulates common logic for running inference on arbitrary
 * ONNX models. A manifest may accompany a model to describe input and
 * output tensor names, shapes and normalisation parameters. The worker
 * supports initialisation with either a model URL (for built‑in models)
 * or an ArrayBuffer (for dynamically loaded weights), and exposes a
 * simple messaging interface to the main thread. Long‑running inferences
 * can be aborted by sending an 'abort' action; the worker will report
 * that the request was cancelled and ignore any pending computation.
 *
 * Messages follow the structure:
 *   {
 *     id: <unique identifier for correlating requests>,
 *     action: 'init' | 'infer' | 'abort',
 *     modelPath?: string,       // URL to ONNX weights
 *     modelBuffer?: ArrayBuffer,// raw ONNX weights
 *     manifest?: Object,        // optional manifest describing inputs/outputs
 *     input?: any,              // input tensor data (ArrayBuffer, TypedArray)
 *     dims?: Object             // dimensions or shape metadata
 *   }
 *
 * Responses:
 *   {
 *     id: <id passed in request>,
 *     status?: 'ready' | 'aborted',
 *     result?: ort.Tensor,      // inference output on success
 *     error?: string            // error message on failure
 *   }
 */

// Load the ONNX Runtime library. We do this outside of the message
// handler to avoid repeated imports. If the import fails the worker
// will continue to function but all inference requests will report an
// error.
let ortLoaded = false;
let ortError = null;
let session = null;
let currentManifest = null;
let abortRequested = false;

try {
  importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');
  if (typeof ort !== 'undefined') {
    ortLoaded = true;
  } else {
    ortError = 'ONNX Runtime failed to load';
  }
} catch (err) {
  ortError = err.message || 'Failed to import onnxruntime-web';
}

/**
 * Initialise the inference session. Either `modelPath` or `modelBuffer`
 * must be provided. If a manifest is provided it will be stored
 * alongside the session for later use. Subsequent calls will re‑create
 * the session and overwrite any existing one.
 *
 * @param {string|null} modelPath URL pointing to the ONNX file.
 * @param {ArrayBuffer|null} modelBuffer Raw ONNX weight buffer.
 * @param {Object|null} manifest Optional model manifest describing I/O.
 */
async function initialise(modelPath, modelBuffer, manifest) {
  if (!ortLoaded) {
    throw new Error(ortError || 'ONNX Runtime not loaded');
  }
  session = null;
  currentManifest = manifest || null;
  if (modelPath) {
    session = await ort.InferenceSession.create(modelPath);
  } else if (modelBuffer) {
    session = await ort.InferenceSession.create(modelBuffer);
  } else {
    throw new Error('No modelPath or modelBuffer provided');
  }
}

/**
 * Convert an input payload into an ort.Tensor based on the manifest or
 * supplied dimensions. If the input is a Uint8ClampedArray (e.g. RGBA
 * pixels) we convert it to a normalised float32 Y channel. If the input
 * is already a Float32Array we wrap it directly. Custom preprocessing
 * can be implemented here based on currentManifest.
 *
 * @param {any} input The raw input payload (TypedArray, ArrayBuffer)
 * @param {Object} dims Additional dimension info (width, height, shape)
 * @returns {ort.Tensor}
 */
function createTensorFromInput(input, dims = {}) {
  if (!session) {
    throw new Error('Session is not initialised');
  }
  // Determine input name
  const inputName = session.inputNames ? session.inputNames[0] : Object.keys(session.inputNames || {})[0];
  // Default shape from manifest or dims
  let shape;
  if (currentManifest && currentManifest.input_shape) {
    shape = currentManifest.input_shape;
  } else if (dims && dims.shape) {
    shape = dims.shape;
  }
  if (input instanceof Float32Array) {
    return new ort.Tensor('float32', input, shape);
  }
  if (input instanceof Uint8ClampedArray) {
    // Convert RGBA to grayscale and normalise to [0,1]
    const { width, height } = dims;
    if (!width || !height) {
      throw new Error('Width/height required for Uint8ClampedArray input');
    }
    const out = new Float32Array(width * height);
    for (let i = 0, j = 0; i < input.length; i += 4, j++) {
      // Simple luminance approximation
      out[j] = (input[i] * 0.299 + input[i + 1] * 0.587 + input[i + 2] * 0.114) / 255;
    }
    const tensorShape = shape || [1, 1, height, width];
    return new ort.Tensor('float32', out, tensorShape);
  }
  throw new Error('Unsupported input type');
}

/**
 * Run inference on the current session. Accepts an input payload and
 * optional dimension metadata. Returns the first output tensor. Any
 * errors will propagate to the caller.
 *
 * @param {any} input Raw input payload
 * @param {Object} dims Dimension metadata
 * @returns {Promise<ort.Tensor>}
 */
async function runInference(input, dims) {
  if (!session) {
    throw new Error('Session is not initialised');
  }
  if (abortRequested) {
    throw new Error('Inference aborted');
  }
  const feeds = {};
  const tensor = createTensorFromInput(input, dims);
  const inputName = session.inputNames ? session.inputNames[0] : Object.keys(session.inputNames || {})[0];
  feeds[inputName] = tensor;
  const results = await session.run(feeds);
  const keys = Object.keys(results);
  const firstOut = results[keys[0]];
  return firstOut;
}

self.onmessage = async (event) => {
  const { id, action, modelPath, modelBuffer, manifest, input, dims } = event.data || {};
  if (!id) {
    // Ignore messages without an id (cannot correlate)
    return;
  }
  if (action === 'abort') {
    // Flag cancellation; running inference will throw on next check
    abortRequested = true;
    self.postMessage({ id, status: 'aborted' });
    return;
  }
  if (action === 'init') {
    try {
      abortRequested = false;
      await initialise(modelPath || null, modelBuffer || null, manifest || null);
      self.postMessage({ id, status: 'ready' });
    } catch (err) {
      self.postMessage({ id, error: err.message || String(err) });
    }
    return;
  }
  if (action === 'infer') {
    try {
      abortRequested = false;
      const result = await runInference(input, dims || {});
      // Transfer the result buffer back to main thread
      if (result && result.data && result.data.buffer) {
        self.postMessage({ id, result }, [result.data.buffer]);
      } else {
        self.postMessage({ id, result });
      }
    } catch (err) {
      const msg = err.message || String(err);
      // If aborted we treat it as a normal aborted state
      const status = msg.toLowerCase().includes('abort') ? 'aborted' : undefined;
      self.postMessage({ id, error: msg, status });
    }
    return;
  }
  // Unknown action: respond with error
  self.postMessage({ id, error: 'Unknown action: ' + action });
};