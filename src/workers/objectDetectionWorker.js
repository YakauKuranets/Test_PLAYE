/*
 * Object detection worker.
 *
 * This WebWorker loads TensorFlow.js and the COCO‑SSD model on demand and
 * performs object detection on raw image data. It receives messages
 * containing an identifier, the image dimensions and a flat Uint8ClampedArray
 * representing RGBA pixels. The worker responds with the same identifier
 * and an array of bounding boxes and class names. By running detection in
 * a worker the main thread remains responsive while processing heavy
 * computations.
 */

let model = null;
let tfReady = false;

/**
 * Load TensorFlow.js and COCO‑SSD. This function is called once before
 * performing any detections. Subsequent calls return immediately. In case
 * the libraries fail to load, the promise will reject and detections will
 * not run.
 */
async function loadModel() {
  if (model) return model;
  if (!tfReady) {
    // Load TensorFlow.js core library
    await new Promise((resolve, reject) => {
      try {
        // tfjs library attaches global `tf` when loaded
        importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.16.0/dist/tf.min.js');
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    tfReady = true;
  }
  // Load COCO‑SSD model library
  await new Promise((resolve, reject) => {
    try {
      importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js');
      resolve();
    } catch (err) {
      reject(err);
    }
  });
  if (typeof cocoSsd === 'undefined') {
    throw new Error('cocoSsd library not available in worker');
  }
  // Load the actual detection model
  model = await cocoSsd.load();
  return model;
}

/**
 * Perform detection on raw pixel data. Input data is expected to be an
 * Uint8ClampedArray containing RGBA values. The function constructs a
 * Tensor from the data and runs the detection model. Results are
 * simplified to contain only bounding boxes (x, y, width, height) and the
 * class name.
 *
 * @param {Uint8ClampedArray} data RGBA pixel data
 * @param {number} width Width of the image
 * @param {number} height Height of the image
 * @returns {Promise<Array<{bbox: [number, number, number, number], class: string, score: number}>>}
 */
async function detect(data, width, height) {
  const m = await loadModel();
  // Convert RGBA to tensor. tf.browser.fromPixels can take a canvas or
  // ImageData object, but inside a worker we can construct a tensor
  // directly. We reshape to [height, width, 3] and drop the alpha
  // channel.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  const imgTensor = tf.tensor3d(rgb, [height, width, 3]);
  const predictions = await m.detect(imgTensor);
  imgTensor.dispose();
  // Simplify the predictions
  return predictions.map((p) => ({
    bbox: p.bbox,
    class: p.class,
    score: p.score,
  }));
}

self.onmessage = async (event) => {
  const { id, width, height, data } = event.data;
  try {
    const preds = await detect(new Uint8ClampedArray(data), width, height);
    self.postMessage({ id, predictions: preds });
  } catch (err) {
    // On error, return an empty array so the main thread can continue.
    self.postMessage({ id, predictions: [], error: err.message });
  }
};