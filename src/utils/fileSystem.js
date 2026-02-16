/*
 * File System Access utilities.
 *
 * This module provides helper functions for reading and writing files
 * using the modern File System Access API when available.  It falls
 * back to simple input and download mechanisms in browsers that do
 * not support the API.  These helpers enable the application to
 * interact with large media files without loading them entirely into
 * memory, a crucial capability for the hybrid Photolab when running
 * offline.  The functions return handles and data in a consistent
 * format so callers can implement their own processing pipelines.
 */

/**
 * Request the user to pick a file from their local file system. When
 * supported, this uses `window.showOpenFilePicker` to obtain a file
 * handle; otherwise it creates a temporary input element.  The
 * returned object always includes the chosen File and (if available)
 * the handle for subsequent reads and writes.
 *
 * @param {{types?: Array<{description?: string, accept?: Record<string,string[]>}>}} opts
 * @returns {Promise<{file: File, handle?: FileSystemFileHandle}>}
 */
export async function openFile(opts = {}) {
  if (window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker(opts);
    const file = await handle.getFile();
    return { file, handle };
  }
  // Fallback: create a hidden input element
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (opts.types && opts.types[0] && opts.types[0].accept) {
      const exts = Object.values(opts.types[0].accept).flat();
      input.accept = exts.join(',');
    }
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      document.body.removeChild(input);
      resolve({ file });
    });
    input.click();
  });
}

/**
 * Read the contents of a file handle as an ArrayBuffer. This helper
 * simplifies consumption of the File System Access API.  If the
 * handle is undefined, the provided File is read directly.
 *
 * @param {FileSystemFileHandle|undefined} handle
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export async function readFile(handle, file) {
  if (handle && handle.getFile) {
    const f = await handle.getFile();
    return f.arrayBuffer();
  }
  return file.arrayBuffer();
}

/**
 * Prompt the user to choose where to save a file and write the
 * provided data to the destination.  On browsers that support the
 * File System Access API, a real file is created; otherwise the
 * data is downloaded as a Blob.  The function accepts either a
 * Uint8Array/ArrayBuffer or Blob/File for the data.
 *
 * @param {Uint8Array|ArrayBuffer|Blob|File} data
 * @param {{suggestedName?: string, mimeType?: string}} opts
 * @returns {Promise<void>}
 */
export async function saveFile(data, opts = {}) {
  const { suggestedName = 'untitled', mimeType = 'application/octet-stream' } = opts;
  const blob = data instanceof Blob || data instanceof File
    ? data
    : new Blob([data], { type: mimeType });
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'Custom File',
          accept: { [mimeType]: [suggestedName.slice(suggestedName.lastIndexOf('.')) || '' ] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  // Fallback: download via anchor element
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Write binary data to an existing file handle.  This is useful when
 * continuing a previous write session without prompting the user again.
 * If the File System Access API is unavailable or the handle does not
 * support createWritable, this function silently resolves without
 * writing.
 *
 * @param {FileSystemFileHandle} handle
 * @param {Uint8Array|ArrayBuffer|Blob|File} data
 * @returns {Promise<void>}
 */
export async function writeFile(handle, data) {
  try {
    if (handle && handle.createWritable) {
      const writable = await handle.createWritable();
      const blob = data instanceof Blob || data instanceof File
        ? data
        : new Blob([data]);
      await writable.write(blob);
      await writable.close();
    }
  } catch (err) {
    console.warn('Failed to write file:', err);
  }
}
