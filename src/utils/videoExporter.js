/*
 * Video export utilities (streaming).
 *
 * This module provides a skeletal implementation of a streaming video
 * exporter using the WebCodecs API. It is designed to encode a series
 * of decoded frames into a video file without loading the entire
 * processed clip into memory. When supported by the browser, frames
 * can be read lazily from a decoder, processed via WebWorkers or
 * offscreen canvases, and passed to a VideoEncoder for streaming
 * output. The encoded chunks can then be written to disk via the
 * File System Access API or downloaded as a Blob.
 *
 * NOTE: This implementation is intentionally lightweight and does not
 * perform actual encoding. It exposes hooks where application code can
 * insert decoding, processing and encoding logic. Browsers that lack
 * WebCodecs support should fall back to existing in‑memory export
 * mechanisms or libraries such as ffmpeg.wasm.
 */

/**
 * Export a sequence of frames to a video file using WebCodecs. Frames
 * are expected to be ImageBitmap instances or objects implementing
 * the VideoFrame interface. The function accepts an async generator
 * which yields processed frames one by one. This allows consumers to
 * process arbitrarily large videos without storing all frames in RAM.
 *
 * Usage example:
 *   const frameGenerator = async function* () {
 *     for await (const frame of decodeAndProcessVideo(inputFile)) {
 *       // perform per‑frame AI processing here
 *       yield frame;
 *     }
 *   };
 *   await exportVideoStream(frameGenerator(), {
 *     width: 1920,
 *     height: 1080,
 *     fps: 25,
 *     fileName: 'processed.mp4',
 *     onProgress: (p) => console.log(p)
 *   });
 *
 * @param {AsyncGenerator<VideoFrame|ImageBitmap>} frameIterator Async iterator yielding processed frames
 * @param {{width:number,height:number,fps:number,fileName?:string,onProgress?:(p:{written:number,total:number})=>void}} opts
 */
export async function exportVideoStream(frameIterator, opts) {
  const { width, height, fps, fileName = 'export.mp4', onProgress } = opts || {};
  if (!('VideoEncoder' in window)) {
    throw new Error('WebCodecs VideoEncoder API is not available in this browser');
  }
  // Placeholder: allocate a writable stream via the File System Access API
  let writable;
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }] });
    writable = await handle.createWritable();
  } else {
    // Fallback: accumulate into a Blob
    writable = {
      chunks: [],
      async write(chunk) { this.chunks.push(chunk); },
      async close() {
        const blob = new Blob(this.chunks, { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      },
    };
  }
  // Configure the encoder. Real implementations should choose the codec
  // and container based on browser capabilities. For demonstration the
  // config is left minimal.
  const encoder = new VideoEncoder({
    output: async (chunk, meta) => {
      // Write encoded chunk to file. In a real encoder the chunk data
      // should be multiplexed into MP4/WebM containers. This example
      // writes raw annexB payloads which many players cannot parse.
      await writable.write(chunk.byteLength ? chunk : new Uint8Array(chunk.byteLength));
    },
    error: (err) => console.error('VideoEncoder error:', err),
  });
  encoder.configure({
    codec: 'vp09.00.10.08', // default codec; consider avc1 or other widely supported codecs
    width,
    height,
    framerate: fps || 25,
  });
  // Iterate through frames and encode them
  let frameCount = 0;
  for await (const frame of frameIterator) {
    if (!(frame instanceof VideoFrame)) {
      // Convert ImageBitmap to VideoFrame
      const vf = new VideoFrame(frame, { timestamp: frameCount * (1e6 / (fps || 25)) });
      encoder.encode(vf);
      vf.close();
    } else {
      encoder.encode(frame);
    }
    frameCount++;
    if (typeof onProgress === 'function') {
      onProgress({ written: frameCount, total: -1 });
    }
  }
  await encoder.flush();
  await writable.close();
}