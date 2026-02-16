/*
 * Model loader and super‑resolution helper.
 *
 * This module provides functions to dynamically load the ONNX Runtime
 * library and initialise ONNX models stored in the `/models` directory.
 * The primary consumer is the hypothesis blueprint, which requests
 * super‑resolution on a per‑frame basis. If no model is available the
 * fallback remains a simple scale operation.
 */

// Cache for loaded sessions keyed by model name.
const modelCache = {};
// Cache for dynamic models loaded at runtime (via gear menu).
// When the user uploads a custom model, an object URL is created
// and stored on `window.dynamicModels`. This cache stores
// corresponding inference sessions so they are not reloaded.
const dynamicModelCache = {};

// -----------------------------------------------------------------------------
// Universal AI worker management
//
// This section introduces helper functions to interact with a dedicated
// WebWorker (aiOrtWorker.js) for running ONNX models. The worker lazily
// initialises and caches a session per model and exposes an `abort`
// message to cancel long‑running inference operations. Consumers should
// call ensureAiWorker() once to obtain an interface and then use
// initAiModel() / runAiInference() to execute models without blocking the
// UI.

// Promise resolving to the worker interface once initialised. We wrap
// the worker in a simple RPC pattern to correlate requests via ids.
let __aiWorkerPromise;

// Internal utility to generate unique ids for worker requests.
function _generateWorkerId() {
  return 'ai_' + Math.random().toString(36).slice(2) + Date.now();
}

/**
 * Ensure a single instance of the AI worker is created. Returns a promise
 * resolving to an object with `post` and `cancel` methods. The `post`
 * method accepts a message payload and returns a promise that resolves
 * with the worker response. The `cancel` method sends an abort signal.
 */
export function ensureAiWorker() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('AI worker is only available in browser context'));
  }
  if (__aiWorkerPromise) {
    return __aiWorkerPromise;
  }
  __aiWorkerPromise = new Promise((resolve, reject) => {
    try {
      // Instantiate the worker relative to the current script. We do not
      // use `type: "module"` here because the worker uses importScripts.
      const worker = new Worker('workers/aiOrtWorker.js');
      const pending = {};
      worker.onmessage = (ev) => {
        const { id, status, result, error } = ev.data || {};
        if (id && pending[id]) {
          const { resolve: res, reject: rej } = pending[id];
          delete pending[id];
          if (error) {
            rej(new Error(error));
          } else {
            res({ status, result });
          }
        }
      };
      const post = (msg) => {
        return new Promise((res, rej) => {
          const id = msg.id || _generateWorkerId();
          pending[id] = { resolve: res, reject: rej };
          try {
            worker.postMessage({ ...msg, id });
          } catch (err) {
            delete pending[id];
            rej(err);
          }
        });
      };
      const cancel = () => {
        // Send a cancellation message; no id required
        worker.postMessage({ id: _generateWorkerId(), action: 'abort' });
      };
      resolve({ post, cancel });
    } catch (err) {
      reject(err);
    }
  });
  return __aiWorkerPromise;
}

/**
 * Initialise the AI worker with a specific model and manifest. Must be
 * called before running inference. Multiple calls will re‑initialise the
 * worker with new weights; this can be used to switch models at runtime.
 *
 * @param {string|ArrayBuffer} modelSource URL or ArrayBuffer for the ONNX model
 * @param {Object|null} manifest Manifest describing inputs/outputs
 * @returns {Promise<'ready'>}
 */
export async function initAiModel(modelSource, manifest = null) {
  const worker = await ensureAiWorker();
  if (typeof modelSource === 'string') {
    const { status } = await worker.post({ action: 'init', modelPath: modelSource, manifest });
    return status;
  } else if (modelSource instanceof ArrayBuffer) {
    const { status } = await worker.post({ action: 'init', modelBuffer: modelSource, manifest });
    return status;
  }
  throw new Error('modelSource must be a URL string or ArrayBuffer');
}

/**
 * Run inference on the currently initialised model in the AI worker.
 * If dimensions are required (for RGBA inputs) they should be passed via
 * the dims parameter. Returns the output tensor provided by the worker.
 *
 * @param {TypedArray|ArrayBuffer} input Input data for the model
 * @param {Object} dims Dimension metadata (e.g. { width, height, shape })
 * @returns {Promise<ort.Tensor>}
 */
export async function runAiInference(input, dims = {}) {
  const worker = await ensureAiWorker();
  const { result } = await worker.post({ action: 'infer', input, dims });
  return result;
}

/**
 * Abort any ongoing inference in the AI worker. The current request will
 * reject with an aborted status but subsequent calls can proceed.
 */
export async function cancelAiInference() {
  const worker = await ensureAiWorker();
  worker.cancel();
}

// -----------------------------------------------------------------------------
// IndexedDB persistent storage for ONNX models
//
// To improve offline performance and avoid repeatedly downloading large model
// binaries, this section implements a lightweight cache in the browser's
// IndexedDB. Models are stored by name along with an optional version
// number. When a model is registered via persistModel() it will be saved
// to IDB and loaded on next startup. Applications should implement a
// versioning strategy to invalidate old entries (e.g. bump the version
// when updating weights). The key schema used is `{ name, version }`.

const MODEL_DB_NAME = 'aiModels';
const MODEL_STORE_NAME = 'models';

// -----------------------------------------------------------------------------
// Internal utility to fetch a binary resource with progress reporting.  If
// `window.updateModelProgress` is defined it will be called with a value
// between 0 and 1.  Otherwise progress is ignored.  Returns an ArrayBuffer.
async function fetchWithProgress(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch model: ${response.status}`);
  }
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader ? response.body.getReader() : null;
  if (!reader) {
    // No streaming support; read all at once
    const buf = await response.arrayBuffer();
    if (typeof window !== 'undefined' && window.updateModelProgress) {
      window.updateModelProgress(1);
    }
    return buf;
  }
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0 && typeof window !== 'undefined' && window.updateModelProgress) {
      window.updateModelProgress(received / total);
    }
  }
  // Concatenate all chunks into a single ArrayBuffer
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  if (typeof window !== 'undefined' && window.updateModelProgress) {
    window.updateModelProgress(1);
  }
  return buffer.buffer;
}

/**
 * Open (or create) the IndexedDB database for storing models.
 * @returns {Promise<IDBDatabase>}
 */
function openModelDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }
    const req = indexedDB.open(MODEL_DB_NAME, 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) {
        // Key path combines name and version into a single string for uniqueness
        db.createObjectStore(MODEL_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onerror = () => reject(req.error || new Error('Failed to open model DB'));
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * Persist an ONNX model into IndexedDB. The file is read as an ArrayBuffer
 * and stored with the given name and version. Any existing entry with the
 * same id will be overwritten.
 *
 * @param {string} name Unique name for the model
 * @param {File|Blob} file The ONNX file to store
 * @param {number} version Optional version number (default 1)
 * @returns {Promise<void>}
 */
export async function persistModel(name, file, version = 1) {
  const db = await openModelDb();
  const buffer = await file.arrayBuffer();
  const id = `${name}@${version}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MODEL_STORE_NAME);
    const putReq = store.put({ id, name, version, buffer });
    putReq.onsuccess = () => resolve();
    putReq.onerror = () => reject(putReq.error || new Error('Failed to store model'));
  });
}

/**
 * Retrieve a model from IndexedDB by name and version. If no exact match
 * is found, the function returns null. Consumers may implement fallback
 * logic to load a different version.
 *
 * @param {string} name Model name
 * @param {number} version Optional version to load (default 1)
 * @returns {Promise<ArrayBuffer|null>}
 */
export async function loadModelFromIdb(name, version = 1) {
  const db = await openModelDb();
  const id = `${name}@${version}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MODEL_STORE_NAME, 'readonly');
    const store = tx.objectStore(MODEL_STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result;
      resolve(entry ? entry.buffer : null);
    };
    getReq.onerror = () => reject(getReq.error || new Error('Failed to load model from IDB'));
  });
}

/**
 * Dynamically inject the onnxruntime‑web script into the document.
 * The returned promise resolves once the global `ort` object is
 * available. Multiple calls will return the same promise, so the
 * script is only loaded once.
 *
 * Note: the CDN URL is used here rather than bundling the runtime,
 * because downloading via npm is not available in this environment.
 * When running the application in a real browser the script will be
 * fetched from jsDelivr.
 */
export function ensureOnnxRuntime() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ONNX runtime can only be loaded in a browser context'));
  }
  if (window.__ortPromise) {
    return window.__ortPromise;
  }
  window.__ortPromise = new Promise((resolve, reject) => {
    // If the global `ort` object is already present, resolve immediately.
    if (window.ort) {
      resolve();
      return;
    }
    // Try loading the runtime from a list of candidate URLs.  The first
    // successfully loaded script will resolve the promise.  If all fail,
    // the promise rejects with the last encountered error.  This allows
    // offline deployments to provide their own copy under `libs/ort.min.js`.
    const candidates = [
      'libs/ort.min.js',
      'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js',
    ];
    let idx = 0;
    const tryLoad = () => {
      if (idx >= candidates.length) {
        reject(new Error('Failed to load ONNX Runtime'));
        return;
      }
      const url = candidates[idx++];
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => {
        // Attempt the next candidate on failure
        script.remove();
        tryLoad();
      };
      document.head.appendChild(script);
    };
    tryLoad();
  });
  return window.__ortPromise;
}

/**
 * Load an ONNX model by name from the local `/models` directory.
 * Supported model names map to file names defined in the `modelPaths`
 * dictionary. Returns an `ort.InferenceSession` ready for inference.
 *
 * @param {string} name Name of the model to load (e.g. 'superres').
 * @returns {Promise<InferenceSession|null>}
 */
export async function loadModel(name) {
  await ensureOnnxRuntime();
  // If a dynamic model has been registered by the user via the gear menu,
  // load it first. The global `window.dynamicModels` stores a mapping
  // from model name to object URL created when the file was uploaded.
  if (typeof window !== 'undefined' && window.dynamicModels && window.dynamicModels[name]) {
    if (dynamicModelCache[name]) {
      return dynamicModelCache[name];
    }
    try {
      const session = await ort.InferenceSession.create(window.dynamicModels[name]);
      // Attach manifest from the global store if it exists. This allows
      // callers to query input/output names, tiling behaviour etc. If
      // no manifest is provided the session will work with default
      // behaviour.  See registerModel() below.
      if (typeof window !== 'undefined' && window.modelManifests) {
        const m = window.modelManifests[name];
        if (m) {
          session.__manifest = m;
        }
      }
      dynamicModelCache[name] = session;
      return session;
    } catch (err) {
      console.error('Ошибка загрузки пользовательской модели', err);
      return null;
    }
  }
  // Otherwise use built-in models from the configuration table.
  if (modelCache[name]) {
    return modelCache[name];
  }
  // Map friendly names to model files. Additional models can be added
  // here without changing the interface.
  const modelPaths = {
    superres: 'models/super_resolution.onnx',
    superres2x: 'models/super_resolution_2x.onnx',
    // New offline models for hybrid mode. These files are placeholders and
    // should be replaced with actual ONNX weights for RetinaFace, GFPGAN
    // Lite and ArcFace. They currently point to copies of the super
    // resolution model to allow the application to load without errors.
    retinaface: 'models/retinaface.onnx',
    gfpgan_lite: 'models/gfpgan_lite.onnx',
    arcface: 'models/arcface.onnx',
  };
  const path = modelPaths[name];
  if (!path) {
    console.warn(`Модель '${name}' не найдена в конфигурации.`);
    return null;
  }
  // Before loading from the network/file system, attempt to retrieve the
  // weights from IndexedDB. This supports offline use and avoids
  // repeatedly downloading the same model. The version defaults to 1.
  try {
    const cachedBuf = await loadModelFromIdb(name, 1);
    if (cachedBuf) {
      const session = await ort.InferenceSession.create(cachedBuf);
      modelCache[name] = session;
      return session;
    }
  } catch (err) {
    console.warn('IndexedDB lookup for model failed', err);
  }
  try {
    // Fetch the model weights with progress reporting, then create the session
    const buffer = await fetchWithProgress(path);
    const session = await ort.InferenceSession.create(buffer);
    // Persist to IndexedDB asynchronously; ignore errors
    (async () => {
      try {
        const blob = new Blob([buffer]);
        await persistModel(name, blob, 1);
      } catch (_) {
        /* ignored */
      }
    })();
    modelCache[name] = session;
    return session;
  } catch (err) {
    console.error('Ошибка загрузки модели', err);
    return null;
  }
}

/**
 * Perform super‑resolution on an ImageData object using the given
 * model name. If the model cannot be loaded or inference fails, the
 * function returns null and the caller should fall back to a simple
 * scale operation.
 *
 * The returned object contains a Uint8ClampedArray representing the
 * RGBA pixel data and the new width/height. The conversion uses a
 * naive YCbCr → RGB transformation and nearest neighbour upsampling for
 * chroma channels. This is sufficient for demonstration but can be
 * improved for production use.
 *
 * @param {ImageData} imageData The source image data to upscale.
 * @param {string} modelName Name of the model to use (default 'superres').
 * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number}|null>}
 */
export async function superResolve(imageData, modelName = 'superres') {
  // Ensure runtime and session are ready. Attempt to use the AI worker if
  // available; fall back to direct ORT inference otherwise. The worker
  // approach avoids blocking the main thread during heavy inference.
  await ensureOnnxRuntime();
  const { width, height, data } = imageData;
  // Precompute Y, Cb and Cr channels for later fusion. Y is normalized
  const yData = new Float32Array(width * height);
  const cbData = new Float32Array(width * height);
  const crData = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    yData[j] = y / 255;
    cbData[j] = (b - y) / 255;
    crData[j] = (r - y) / 255;
  }
  // Determine model path and manifest
  const modelPaths = {
    superres: 'models/super_resolution.onnx',
    superres2x: 'models/super_resolution_2x.onnx',
  };
  const path = modelPaths[modelName];
  let outputTensor;
  let session;
  try {
    // Try using the AI worker for inference. Initialise worker with
    // model path and manifest if available on the session.
    const maybeSession = await loadModel(modelName);
    const manifest = maybeSession ? maybeSession.__manifest : null;
    // If there is no worker support, initAiModel will throw and we will
    // fall back to direct inference below.
    await initAiModel(path, manifest);
    outputTensor = await runAiInference(yData, { shape: [1, 1, height, width], width, height });
  } catch (workerErr) {
    // Worker not available or failed: fall back to direct inference
    try {
      session = await loadModel(modelName);
      if (!session) {
        return null;
      }
      const inputName = session.inputNames ? session.inputNames[0] : 'input';
      const tensor = new ort.Tensor('float32', yData, [1, 1, height, width]);
      const feeds = {};
      feeds[inputName] = tensor;
      const output = await session.run(feeds);
      const firstKey = Object.keys(output)[0];
      outputTensor = output[firstKey];
    } catch (err) {
      console.error('Ошибка инференса модели супер‑резолюции', err);
      return null;
    }
  }
  // Extract output dimensions and data
  const outData = outputTensor.data;
  const outDims = outputTensor.dims;
  // dims could be [1,1,outHeight,outWidth] or [outHeight,outWidth]
  const outHeight = outDims[outDims.length - 2];
  const outWidth = outDims[outDims.length - 1];
  // Upsample Cb and Cr using nearest neighbour
  const cbOut = new Float32Array(outWidth * outHeight);
  const crOut = new Float32Array(outWidth * outHeight);
  const ratioX = outWidth / width;
  const ratioY = outHeight / height;
  for (let y = 0; y < outHeight; y++) {
    const inY = Math.floor(y / ratioY);
    for (let x = 0; x < outWidth; x++) {
      const inX = Math.floor(x / ratioX);
      const srcIdx = inY * width + inX;
      const dstIdx = y * outWidth + x;
      cbOut[dstIdx] = cbData[srcIdx];
      crOut[dstIdx] = crData[srcIdx];
    }
  }
  // Convert back to RGBA
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let i = 0; i < outWidth * outHeight; i++) {
    const Y = outData[i] * 255;
    const Cb = cbOut[i] * 255;
    const Cr = crOut[i] * 255;
    let r = Y + 1.402 * Cr;
    let b = Y + 1.772 * Cb;
    let g = Y - 0.344136 * Cb - 0.714136 * Cr;
    rgba[i * 4] = r < 0 ? 0 : r > 255 ? 255 : r;
    rgba[i * 4 + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    rgba[i * 4 + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    rgba[i * 4 + 3] = 255;
  }
  return { data: rgba, width: outWidth, height: outHeight };
}

/**
 * Register a new model and its optional manifest.  This helper should be
 * called by UI code (e.g. the gear menu) when the user uploads a
 * custom model or when downloading from the catalog.  It stores the
 * model URL in `window.dynamicModels` and the optional manifest in
 * `window.modelManifests`.  If a model with the same name already
 * exists it will be overwritten.  Once registered the model can be
 * loaded via `loadModel(name)`, and the manifest can be retrieved via
 * `getModelManifest(name)`.
 *
 * @param {string} name Friendly name of the model.
 * @param {string|Blob|File} source URL or Blob/File representing the ONNX model.
 * @param {object} [manifest] Optional manifest describing input/output names,
 *   tile size, scale factor etc.  The manifest is stored but not
 *   validated here; consumers should validate fields as needed.
 */
export function registerModel(name, source, manifest) {
  if (typeof window === 'undefined') return;
  if (!window.dynamicModels) window.dynamicModels = {};
  if (!window.modelManifests) window.modelManifests = {};
  // Create an object URL if source is a Blob/File.  Otherwise assume it
  // is a string URL already accessible to the browser.  The caller is
  // responsible for revoking any previously created URLs.
  let url;
  if (typeof source === 'string') {
    url = source;
  } else if (source instanceof Blob || source instanceof File) {
    url = URL.createObjectURL(source);
  } else {
    throw new Error('registerModel: invalid source type');
  }
  window.dynamicModels[name] = url;
  if (manifest) {
    window.modelManifests[name] = manifest;
  }
}

/**
 * Retrieve the manifest associated with a model.  Manifests are optional
 * objects that describe the expected input and output names, data
 * ordering, output scale factor, tiling recommendations, etc.  They are
 * stored on `window.modelManifests` when a model is registered via
 * `registerModel`.  If no manifest is found for the model this function
 * returns null.
 *
 * @param {string} name Name of the model.
 * @returns {object|null}
 */
export function getModelManifest(name) {
  if (typeof window === 'undefined') return null;
  return (window.modelManifests && window.modelManifests[name]) || null;
}

// -----------------------------------------------------------------------------
// FFmpeg support (stub)
//
// The following functions prepare the environment for FFmpeg.js and provide a
// simple transcoding helper. Full transcoding requires the @ffmpeg/ffmpeg
// library, which can be loaded on demand via a CDN. This stub loads the
// library if available and falls back to returning the original file when
// conversion is not possible or the runtime is unavailable. The
// implementation below does not transcode; it is provided as an example
// structure for future expansion.

/**
 * Dynamically load FFmpeg.js from jsDelivr CDN. When loaded, the global
 * `FFmpeg` constructor is available (via `FFmpeg.createFFmpeg`). If the
 * library is already loaded, the promise resolves immediately. Errors
 * propagate via rejection.
 */
export function ensureFfmpeg() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('FFmpeg can only be loaded in a browser context'));
  }
  if (window.__ffmpegPromise) {
    return window.__ffmpegPromise;
  }
  window.__ffmpegPromise = new Promise((resolve, reject) => {
    if (window.FFmpeg) {
      resolve();
      return;
    }
    // Try local and remote sources for FFmpeg.js.  This allows offline
    // deployments to bundle ffmpeg.min.js under /libs.  The first source
    // that loads successfully resolves the promise.
    const candidates = [
      'libs/ffmpeg.min.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.10.1/dist/ffmpeg.min.js',
    ];
    let i = 0;
    const tryLoad = () => {
      if (i >= candidates.length) {
        reject(new Error('Failed to load FFmpeg.js'));
        return;
      }
      const url = candidates[i++];
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        tryLoad();
      };
      document.head.appendChild(script);
    };
    tryLoad();
  });
  return window.__ffmpegPromise;
}

/**
 * Transcode a media file to WebM/VP9 using FFmpeg.js. The returned promise
 * resolves to a new File containing the transcoded data, or the original
 * file if transcoding fails or is unsupported. This is a placeholder
 * implementation: actual transcoding logic should be added when the
 * library is available in the production environment.
 *
 * @param {File} file The input media file
 * @returns {Promise<File>} The transcoded file or original file
 */
export async function transcodeToWebM(file) {
  try {
    await ensureFfmpeg();
    if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
      return file;
    }
    const { createFFmpeg, fetchFile } = window.FFmpeg;
    // Create a new FFmpeg instance with logging disabled. Running multiple
    // instances concurrently can quickly exhaust memory, so this function
    // should not be called repeatedly for large files. For extremely large
    // videos consider server‑side transcoding instead.
    const ffmpeg = createFFmpeg({ log: false });
    await ffmpeg.load();
    // Write input file to the in‑memory filesystem. Use a fixed name to
    // simplify command invocation.
    const inputName = 'input';
    const outputName = 'output.webm';
    const data = await fetchFile(file);
    await ffmpeg.FS('writeFile', inputName, data);
    // Execute FFmpeg to transcode to VP9+Opus WebM. Adjust bitrate for
    // reasonable quality without creating huge files. If audio is absent the
    // codec selection will be ignored gracefully.
    await ffmpeg.run(
      '-i', inputName,
      '-c:v', 'libvpx-vp9',
      '-b:v', '1M',
      '-c:a', 'libopus',
      '-b:a', '128k',
      outputName
    );
    const outputData = ffmpeg.FS('readFile', outputName);
    // Create a new File object. Retain the base name but change extension.
    const newName = file.name.replace(/\.[^/.]+$/, '') + '.webm';
    const newFile = new File([outputData.buffer], newName, { type: 'video/webm' });
    return newFile;
  } catch (err) {
    console.warn('FFmpeg unavailable or failed to load or transcode:', err);
    return file;
  }
}

// -----------------------------------------------------------------------------
// TensorFlow.js and object detection support
//
// These helpers dynamically load the TensorFlow.js library and the COCO‑SSD
// object detection model. They return promises that resolve once the
// corresponding global objects are available. Using dynamic imports avoids
// increasing the bundle size and allows the app to gracefully degrade if
// external CDNs are blocked. The object detection model can be executed in
// a WebWorker (see workers/objectDetectionWorker.js) or on the main thread.

/**
 * Ensure that the TensorFlow.js runtime is loaded. The library is fetched
 * from a CDN and attached to the global `tf` object. Multiple calls will
 * share a promise so the script is only inserted once. If the runtime
 * already exists (window.tf), the promise resolves immediately.
 *
 * @returns {Promise<void>}
 */
export function ensureTf() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('TensorFlow.js can only be loaded in a browser context'));
  }
  if (window.__tfPromise) {
    return window.__tfPromise;
  }
  window.__tfPromise = new Promise((resolve, reject) => {
    if (window.tf) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    // Load a pinned version of TensorFlow.js. Avoid using the latest tag to
    // reduce the risk of breaking changes. The version here is fairly
    // conservative and should remain compatible for the foreseeable future.
    script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.16.0/dist/tf.min.js';
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject(new Error('Failed to load TensorFlow.js'));
    };
    document.head.appendChild(script);
  });
  return window.__tfPromise;
}

/**
 * Ensure that the COCO‑SSD model loader is available. This function loads
 * both TensorFlow.js (if necessary) and the COCO‑SSD library, which will
 * attach a global `cocoSsd` object. Subsequent calls return the same
 * promise and avoid reloading the scripts.
 *
 * @returns {Promise<void>}
 */
export function ensureCocoModel() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('COCO‑SSD can only be loaded in a browser context'));
  }
  if (window.__cocoPromise) {
    return window.__cocoPromise;
  }
  window.__cocoPromise = (async () => {
    await ensureTf();
    if (window.cocoSsd) {
      return;
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load COCO‑SSD model'));
      document.head.appendChild(script);
    });
  })();
  return window.__cocoPromise;
}

/**
 * Load the COCO‑SSD model and return it. This helper wraps the model
 * creation in a single place. If TensorFlow.js or the model are not
 * available, the promise rejects. The loaded model should be used in a
 * WebWorker for performance, but this function is kept for completeness.
 *
 * @returns {Promise<any>} A loaded object detection model
 */
export async function loadCocoModel() {
  await ensureCocoModel();
  if (!window.cocoSsd) {
    throw new Error('COCO‑SSD library not available');
  }
  return window.cocoSsd.load();
}

// -----------------------------------------------------------------------------
// Three.js support for 3D reconstruction
//
// When rendering simple 3D height maps on the fly, we rely on the Three.js
// library. This helper loads Three.js from a CDN and returns once the
// `THREE` global is available. As with other loaders, the promise is
// memoised. The version is pinned to ensure stability.

export function ensureThree() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Three.js can only be loaded in a browser context'));
  }
  if (window.__threePromise) {
    return window.__threePromise;
  }
  window.__threePromise = new Promise((resolve, reject) => {
    if (window.THREE) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Three.js'));
    document.head.appendChild(script);
  });
  return window.__threePromise;
}