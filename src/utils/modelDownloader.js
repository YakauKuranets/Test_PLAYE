/**
 * Model Downloader
 *
 * Загружает AI модели с CDN и сохраняет в IndexedDB. Предоставляет
 * функции для получения списка доступных моделей из реестра, проверки
 * локальной загрузки, скачивания с отображением прогресса и проверки
 * обновлений моделей.
 */

import { MODEL_REGISTRY } from '../models/registry.js';

// CDN URLs для загрузки моделей
// TODO: Заменить на реальные URL когда модели будут готовы
const MODEL_CDN_URLS = {
  'gfpgan-light.onnx':
    'https://huggingface.co/TencentARC/GFPGAN/resolve/main/gfpgan_v1.3.onnx',
  'realesrgan-x2.onnx':
    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.onnx',
  'nafnet-light.onnx':
    'https://github.com/megvii-research/NAFNet/releases/download/v1.0/nafnet_gd.onnx'
};

/**
 * Получить список всех моделей для UI.
 * Возвращает массив объектов с информацией о каждой модели
 * (имя, файл, размер, версия, описание, точность, задача).
 */
export function getAvailableModels() {
  const models = [];
  for (const [task, entry] of Object.entries(MODEL_REGISTRY)) {
    const offline = entry.offline;
    if (!offline || !offline.path) continue; // пропускаем API‑модели
    const modelName = offline.path.split('/').pop();
    models.push({
      task,
      name: offline.name,
      fileName: modelName,
      size: offline.size,
      version: offline.version,
      description: entry.description,
      accuracy: offline.accuracy
    });
  }
  return models;
}

/**
 * Проверить, загружена ли модель в IndexedDB.
 * @param {string} fileName Название файла модели
 * @returns {Promise<boolean>}
 */
export async function isModelDownloaded(fileName) {
  try {
    const db = await openModelsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readonly');
      const store = tx.objectStore('models');
      const request = store.get(fileName);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => resolve(false);
    });
  } catch (err) {
    console.error('Error checking model:', err);
    return false;
  }
}

/**
 * Загрузить модель с отображением прогресса. При успешной загрузке
 * сохраняет файл в IndexedDB.
 * @param {string} fileName Название файла модели
 * @param {Function} onProgress Callback для обновления прогресса (0‑100)
 * @returns {Promise<Blob>}
 */
export async function downloadModel(fileName, onProgress) {
  const url = MODEL_CDN_URLS[fileName];
  if (!url) {
    throw new Error(`Unknown model: ${fileName}`);
  }
  console.log(`[ModelDownloader] Starting download: ${fileName}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const contentLength = response.headers.get('content-length');
  const total = parseInt(contentLength, 10);
  if (!total || isNaN(total)) {
    // Если размер неизвестен, скачиваем без прогресса
    const blob = await response.blob();
    await saveModelToCache(fileName, blob);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = Math.round((received / total) * 100);
    if (onProgress) onProgress(percent);
  }
  const blob = new Blob(chunks);
  await saveModelToCache(fileName, blob);
  console.log(`[ModelDownloader] Download complete: ${fileName}`);
  return blob;
}

/**
 * Сохранить модель в IndexedDB.
 * @param {string} fileName Название файла
 * @param {Blob} blob Данные модели
 * @returns {Promise<void>}
 */
async function saveModelToCache(fileName, blob) {
  const db = await openModelsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    const store = tx.objectStore('models');
    const data = {
      fileName,
      blob,
      downloadedAt: new Date().toISOString(),
      size: blob.size
    };
    const request = store.put(data);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Получить модель из кэша.
 * @param {string} fileName Название файла модели
 * @returns {Promise<Blob|null>} Blob модели или null, если нет
 */
export async function getModelFromCache(fileName) {
  try {
    const db = await openModelsDB();
    return new Promise((resolve) => {
      const tx = db.transaction('models', 'readonly');
      const store = tx.objectStore('models');
      const request = store.get(fileName);
      request.onsuccess = () => resolve(request.result?.blob || null);
      request.onerror = () => resolve(null);
    });
  } catch (err) {
    console.error('Error getting model from cache:', err);
    return null;
  }
}

/**
 * Открыть IndexedDB для хранения моделей. Создаёт базу PlayeModels
 * и хранилище models при необходимости.
 * @returns {Promise<IDBDatabase>}
 */
function openModelsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PlayeModels', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'fileName' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Форматировать размер в байтах в читаемый вид (например, 12.3 MB).
 * @param {number} bytes Размер в байтах
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i]
  );
}

/**
 * Проверить наличие обновлений для моделей. Загрузить манифест из
 * CDN и сравнить версии локальных моделей с удалёнными. Если у
 * скачанной модели доступна более новая версия, вернуть информацию
 * об обновлении.
 * @returns {Promise<Array>} Список моделей с доступными обновлениями
 */
export async function checkModelUpdates() {
  const updates = [];
  try {
    // Загрузить манифест с сервера. При отсутствии интернета fetch
    // выбросит исключение, которое будет обработано ниже.
    const response = await fetch('https://cdn.example.com/models/manifest.json');
    const manifest = await response.json();
    for (const [task, entry] of Object.entries(MODEL_REGISTRY)) {
      const offline = entry.offline;
      if (!offline || !offline.path) continue;
      const modelName = offline.path.split('/').pop();
      const remoteVersion = manifest[modelName]?.version;
      const localVersion = offline.version;
      // Проверяем, загружена ли модель локально
      const downloaded = await isModelDownloaded(modelName);
      if (
        downloaded &&
        remoteVersion &&
        compareVersions(remoteVersion, localVersion) > 0
      ) {
        updates.push({
          task,
          modelName,
          name: offline.name,
          currentVersion: localVersion,
          newVersion: remoteVersion,
          size: manifest[modelName]?.size || offline.size
        });
      }
    }
  } catch (err) {
    console.error('Error checking updates:', err);
    throw new Error('Не удалось проверить обновления. Проверьте подключение к интернету.');
  }
  return updates;
}

/**
 * Сравнить две версии семантической версии вида x.y.z.
 * @param {string} v1
 * @param {string} v2
 * @returns {number} 1 если v1 > v2, -1 если v1 < v2, 0 если равны
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) return 1;
    if (parts1[i] < parts2[i]) return -1;
  }
  return 0;
}