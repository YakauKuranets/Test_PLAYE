/**
 * API Client for Cloud Backend
 *
 * HTTP клиент для взаимодействия с FastAPI backend. Этот модуль
 * предоставляет универсальный класс для отправки запросов к
 * серверу, а также набор вспомогательных функций для AI эндпоинтов.
 *
 * Код основан на описании в плане реализации этапа 4.
 */

import { smartRouter } from '../router.js';
import { getConfigValue } from '../config.js';

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success
 * @property {any} [data]
 * @property {string} [error]
 */

/**
 * API Client класс
 */
export class ApiClient {
  /**
   * Создать экземпляр клиента
   * @param {string|null} baseUrl Базовый URL. По умолчанию берётся из конфига
   */
  constructor(baseUrl = null) {
    this.baseUrl = baseUrl || getConfigValue('router.backendUrl', 'http://localhost:8000/api');
    this.timeout = getConfigValue('router.backendTimeout', 30000);
  }

  /**
   * Выполнить POST запрос с изображением
   * @param {string} endpoint API endpoint (например, '/ai/face-enhance')
   * @param {Blob|File|ImageData} image Данные изображения
   * @param {Object} options Дополнительные параметры
   * @returns {Promise<ApiResponse>}
   */
  async postImage(endpoint, image, options = {}) {
    const formData = new FormData();

    // Конвертация ImageData в Blob если нужно
    let blob = image;
    if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
      blob = await this._imageDataToBlob(image);
    }

    formData.append('file', blob, 'image.png');

    // Добавить дополнительные параметры
    if (options.params) {
      Object.keys(options.params).forEach(key => {
        formData.append(key, JSON.stringify(options.params[key]));
      });
    }

    return this._request(endpoint, {
      method: 'POST',
      body: formData
    });
  }

  /**
   * Выполнить GET запрос
   * @param {string} endpoint API endpoint
   * @returns {Promise<ApiResponse>}
   */
  async get(endpoint) {
    return this._request(endpoint, { method: 'GET' });
  }

  /**
   * Выполнить POST запрос с JSON
   * @param {string} endpoint API endpoint
   * @param {Object} data JSON данные
   * @returns {Promise<ApiResponse>}
   */
  async post(endpoint, data) {
    return this._request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  /**
   * Внутренний метод для выполнения HTTP запросов
   * @private
   * @param {string} endpoint
   * @param {RequestInit} options
   * @returns {Promise<ApiResponse>}
   */
  async _request(endpoint, options) {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`
        };
      }

      // Определить тип ответа
      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else if (contentType && contentType.startsWith('image/')) {
        const blob = await response.blob();
        data = await this._blobToImageData(blob);
      } else {
        data = await response.blob();
      }

      return {
        success: true,
        data
      };

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timeout'
        };
      }
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Конвертировать ImageData в Blob
   * @private
   * @param {ImageData} imageData
   * @returns {Promise<Blob>}
   */
  async _imageDataToBlob(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  /**
   * Конвертировать Blob в ImageData
   * @private
   * @param {Blob} blob
   * @returns {Promise<ImageData>}
   */
  async _blobToImageData(blob) {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(imageData);
      };
      img.onerror = reject;
      img.src = url;
    });
  }
}

// Singleton instance of the API client
export const apiClient = new ApiClient();

/**
 * Вспомогательные функции для AI эндпоинтов. Они передают
 * изображение в соответствующий endpoint и возвращают результат.
 */
export async function enhanceFace(imageData, options = {}) {
  return apiClient.postImage('/ai/face-enhance', imageData, { params: options });
}

export async function upscaleImage(imageData, factor = 2, options = {}) {
  return apiClient.postImage('/ai/upscale', imageData, { params: { factor, ...options } });
}

export async function denoiseImage(imageData, level = 'medium', options = {}) {
  return apiClient.postImage('/ai/denoise', imageData, { params: { level, ...options } });
}

export async function detectFaces(imageData, options = {}) {
  return apiClient.postImage('/ai/detect-faces', imageData, { params: options });
}

export async function detectObjects(imageData, options = {}) {
  return apiClient.postImage('/ai/detect-objects', imageData, { params: options });
}

/**
 * Batch process images for face enhancement.
 * Выполняет улучшение лиц для массива изображений последовательно.
 * Возвращает массив результатов, каждый элемент содержит ApiResponse от enhanceFace.
 * @param {ImageData[]|Blob[]|File[]} images
 * @param {Object} options
 * @returns {Promise<Array<any>>}
 */
export async function batchEnhanceFaces(images, options = {}) {
  const results = [];
  for (const img of images) {
    try {
      const res = await enhanceFace(img, options);
      results.push(res.data ?? null);
    } catch (err) {
      console.error('batchEnhanceFaces error:', err);
      results.push(null);
    }
  }
  return results;
}

/**
 * Batch upscale images.
 * @param {Array<ImageData|Blob|File>} images
 * @param {number} factor
 * @param {Object} options
 * @returns {Promise<Array<any>>}
 */
export async function batchUpscaleImages(images, factor = 2, options = {}) {
  const results = [];
  for (const img of images) {
    try {
      const res = await upscaleImage(img, factor, options);
      results.push(res.data ?? null);
    } catch (err) {
      console.error('batchUpscaleImages error:', err);
      results.push(null);
    }
  }
  return results;
}

/**
 * Batch denoise images.
 * @param {Array<ImageData|Blob|File>} images
 * @param {string} level
 * @param {Object} options
 * @returns {Promise<Array<any>>}
 */
export async function batchDenoiseImages(images, level = 'medium', options = {}) {
  const results = [];
  for (const img of images) {
    try {
      const res = await denoiseImage(img, level, options);
      results.push(res.data ?? null);
    } catch (err) {
      console.error('batchDenoiseImages error:', err);
      results.push(null);
    }
  }
  return results;
}

/**
 * Batch detect faces for a list of images.
 * @param {Array<ImageData|Blob|File>} images
 * @param {Object} options
 * @returns {Promise<Array<any>>}
 */
export async function batchDetectFaces(images, options = {}) {
  const results = [];
  for (const img of images) {
    try {
      const res = await detectFaces(img, options);
      results.push(res.data ?? null);
    } catch (err) {
      console.error('batchDetectFaces error:', err);
      results.push(null);
    }
  }
  return results;
}

/**
 * Batch detect objects for a list of images.
 * @param {Array<ImageData|Blob|File>} images
 * @param {Object} options
 * @returns {Promise<Array<any>>}
 */
export async function batchDetectObjects(images, options = {}) {
  const results = [];
  for (const img of images) {
    try {
      const res = await detectObjects(img, options);
      results.push(res.data ?? null);
    } catch (err) {
      console.error('batchDetectObjects error:', err);
      results.push(null);
    }
  }
  return results;
}