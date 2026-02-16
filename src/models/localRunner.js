/**
 * Local AI Models Runner
 *
 * Модуль для выполнения AI задач с использованием локальных ONNX моделей.
 * Маршрутизирует запросы к соответствующим моделям и обработчикам.
 */

import { ensureAiWorker, initAiModel, runAiInference } from './loader.js';
import { getModelInfo } from './registry.js';

/**
 * Реестр локальных моделей
 * Каждая модель имеет:
 * - path: путь к .onnx файлу
 * - preprocess: функция предобработки входных данных
 * - postprocess: функция постобработки выходных данных
 */
const LOCAL_MODELS = {
  // Face Enhancement - пока заглушка, будет реализовано в Этапе 2
  faceEnhance: {
    path: '/models/gfpgan-light.onnx',
    available: false, // Будет обновлено после инициализации
    preprocess: preprocessGFPGAN,
    postprocess: postprocessImage
  },
  
  // Upscaling
  upscale: {
    path: '/models/realesrgan-x2.onnx',
    available: false,
    preprocess: preprocessRealESRGAN,
    postprocess: postprocessImage
  },
  
  // Denoising
  denoise: {
    path: '/models/nafnet-light.onnx',
    available: false,
    preprocess: preprocessNAFNet,
    postprocess: postprocessImage
  },
  
  // Object Detection - уже есть через COCO-SSD
  detectObjects: {
    available: true,
    handler: detectObjectsLocal
  },
  
  // Face Detection - уже есть через Face Detection API
  detectFaces: {
    available: true,
    handler: detectFacesLocal
  }
};

// -------------------------------------------------------------------------
// Инициализация доступности моделей из реестра
// Получаем информацию о локальных версиях и обновляем LOCAL_MODELS
(() => {
  const offlineTasks = ['faceEnhance', 'upscale', 'denoise'];
  for (const task of offlineTasks) {
    const info = getModelInfo(task, 'offline');
    if (info && info.path) {
      if (LOCAL_MODELS[task]) {
        LOCAL_MODELS[task].path = info.path;
        LOCAL_MODELS[task].available = true;
      }
    }
  }
})();

/**
 * Выполнить AI задачу локально
 * @param {string} task - Название задачи
 * @param {any} data - Входные данные
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<any>} Результат обработки
 */
export async function runLocalModel(task, data, options = {}) {
  const model = LOCAL_MODELS[task];
  
  if (!model) {
    throw new Error(`Unknown local task: ${task}`);
  }
  
  if (!model.available) {
    throw new Error(`Local model for task "${task}" is not available yet. Will be added in Stage 2.`);
  }
  
  console.log(`[LocalRunner] Running task: ${task}`);
  
  // Если у модели есть custom handler (для уже реализованных функций)
  if (model.handler) {
    return model.handler(data, options);
  }
  
  // Иначе используем ONNX pipeline
  return runOnnxModel(model, data, options);
}

/**
 * Выполнить ONNX модель
 * @private
 */
async function runOnnxModel(model, data, options) {
  // Инициализация модели
  await initAiModel(model.path);
  
  // Предобработка
  const preprocessed = model.preprocess(data, options);
  
  // Инференс
  const output = await runAiInference(preprocessed.data, preprocessed.dims);
  
  // Постобработка
  const result = model.postprocess(output, preprocessed, options);
  
  return result;
}

/**
 * Предобработка изображения для ONNX модели
 * @private
 */
function preprocessImage(imageData, options = {}) {
  // Конвертация ImageData в формат для модели
  const { width, height, data } = imageData;
  
  // Нормализация пикселей [0, 255] -> [0, 1] или [-1, 1]
  const normalize = options.normalize || 'zero_one'; // 'zero_one' или 'neg_one_one'
  const float32Data = new Float32Array(width * height * 3);
  
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    
    if (normalize === 'neg_one_one') {
      float32Data[i * 3] = r * 2 - 1;
      float32Data[i * 3 + 1] = g * 2 - 1;
      float32Data[i * 3 + 2] = b * 2 - 1;
    } else {
      float32Data[i * 3] = r;
      float32Data[i * 3 + 1] = g;
      float32Data[i * 3 + 2] = b;
    }
  }
  
  return {
    data: float32Data,
    dims: { width, height, channels: 3 },
    original: imageData
  };
}

/**
 * Постобработка результата модели обратно в ImageData
 * @private
 */
function postprocessImage(output, preprocessed, options = {}) {
  const { width, height } = preprocessed.dims;
  const { data: tensorData } = output;
  
  // Создать ImageData
  const imageData = new ImageData(width, height);
  const { data } = imageData;
  
  // Денормализация
  const normalize = options.normalize || 'zero_one';
  
  for (let i = 0; i < width * height; i++) {
    let r = tensorData[i * 3];
    let g = tensorData[i * 3 + 1];
    let b = tensorData[i * 3 + 2];
    
    if (normalize === 'neg_one_one') {
      r = (r + 1) / 2;
      g = (g + 1) / 2;
      b = (b + 1) / 2;
    }
    
    data[i * 4] = Math.round(Math.max(0, Math.min(255, r * 255)));
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, g * 255)));
    data[i * 4 + 2] = Math.round(Math.max(0, Math.min(255, b * 255)));
    data[i * 4 + 3] = 255; // Alpha
  }
  
  return imageData;
}

/**
 * Предобработка входных данных для GFPGAN (face enhancement)
 * Конвертирует ImageData в формат для модели, используя стандартную нормализацию.
 * @param {ImageData} imageData
 * @param {Object} options
 * @returns {Object}
 */
function preprocessGFPGAN(imageData, options = {}) {
  // GFPGAN ожидает нормализацию в диапазоне [0, 1]
  return preprocessImage(imageData, { ...options, normalize: 'zero_one' });
}

/**
 * Предобработка для Real-ESRGAN (апскейл)
 * @param {ImageData} imageData
 * @param {Object} options
 * @returns {Object}
 */
function preprocessRealESRGAN(imageData, options = {}) {
  // Real-ESRGAN использует нормализацию [0, 1]
  return preprocessImage(imageData, { ...options, normalize: 'zero_one' });
}

/**
 * Предобработка для NAFNet (денойз)
 * @param {ImageData} imageData
 * @param {Object} options
 * @returns {Object}
 */
function preprocessNAFNet(imageData, options = {}) {
  // NAFNet работает в диапазоне [0, 1]
  return preprocessImage(imageData, { ...options, normalize: 'zero_one' });
}

/**
 * Детекция объектов локально (COCO-SSD)
 * @private
 */
async function detectObjectsLocal(imageData, options = {}) {
  // Использовать существующую реализацию из blueprints/ai.js
  // TODO: Импортировать и переиспользовать код детекции
  
  // Пока заглушка
  console.warn('[LocalRunner] detectObjects: using existing COCO-SSD implementation');
  return [];
}

/**
 * Детекция лиц локально (Face Detection API)
 * @private
 */
async function detectFacesLocal(imageData, options = {}) {
  // Использовать существующую реализацию из blueprints/ai.js
  // TODO: Импортировать и переиспользовать код детекции
  
  // Пока заглушка
  console.warn('[LocalRunner] detectFaces: using existing Face Detection API implementation');
  return [];
}

/**
 * Проверить доступность локальной модели
 * @param {string} task - Название задачи
 * @returns {boolean}
 */
export function isLocalModelAvailable(task) {
  const model = LOCAL_MODELS[task];
  return model && model.available;
}

/**
 * Получить список доступных локальных моделей
 * @returns {Array<string>}
 */
export function getAvailableLocalModels() {
  return Object.keys(LOCAL_MODELS).filter(task => LOCAL_MODELS[task].available);
}