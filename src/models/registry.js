/**
 * AI Models Registry
 *
 * Централизованный реестр всех доступных AI моделей.
 * Для каждой задачи определяет локальную (ONNX) и облачную (PyTorch) версии.
 */

/**
 * @typedef {Object} ModelVersion
 * @property {string} name - Название модели
 * @property {string} version - Версия
 * @property {string} [path] - Путь к локальной модели
 * @property {string} [endpoint] - API endpoint для облачной модели
 * @property {number} size - Размер в байтах
 * @property {string} accuracy - Точность (например, '85%', '99%')
 * @property {number} [maxFactor] - Максимальный фактор (для апскейла)
 * @property {Object} requirements - Системные требования
 */

/**
 * @typedef {Object} ModelEntry
 * @property {string} task - Название задачи
 * @property {string} description - Описание задачи
 * @property {ModelVersion} offline - Оффлайн версия
 * @property {ModelVersion} online - Онлайн версия
 */

/** @type {Record<string, ModelEntry>} */
export const MODEL_REGISTRY = {
  // ========================================================================
  // FACE ENHANCEMENT - Улучшение качества лиц
  // ========================================================================
  faceEnhance: {
    task: 'faceEnhance',
    description: 'Улучшение качества и восстановление деталей лица',
    
    offline: {
      name: 'GFPGAN-v1.3-light',
      version: '1.3.0',
      path: '/models/gfpgan-light.onnx',
      size: 350 * 1024 * 1024, // 350 MB
      accuracy: '85%',
      requirements: {
        minMemory: 2 * 1024 * 1024 * 1024, // 2 GB RAM
        preferredBackend: 'wasm', // 'wasm' | 'webgl' | 'webgpu'
      },
      metadata: {
        inputSize: [512, 512],
        outputSize: [512, 512],
        normalize: 'zero_one',
        channels: 3
      }
    },
    
    online: {
      name: 'RestoreFormer++',
      version: '2.0.0',
      endpoint: '/ai/face-enhance',
      size: 2 * 1024 * 1024 * 1024, // 2 GB
      accuracy: '99%',
      requirements: {
        gpu: 'CUDA',
        minVRAM: 4 * 1024 * 1024 * 1024 // 4 GB VRAM
      },
      metadata: {
        inputSize: [1024, 1024],
        outputSize: [1024, 1024],
        batchSize: 4
      }
    }
  },
  
  // ========================================================================
  // UPSCALE - Увеличение разрешения
  // ========================================================================
  upscale: {
    task: 'upscale',
    description: 'Увеличение разрешения изображения',
    
    offline: {
      name: 'Real-ESRGAN-x2',
      version: '2.0.0',
      path: '/models/realesrgan-x2.onnx',
      size: 100 * 1024 * 1024, // 100 MB
      accuracy: '88%',
      maxFactor: 2,
      requirements: {
        minMemory: 1 * 1024 * 1024 * 1024, // 1 GB RAM
        preferredBackend: 'wasm'
      },
      metadata: {
        tileSize: 256, // Обработка по тайлам для больших изображений
        overlap: 16
      }
    },
    
    online: {
      name: 'Real-ESRGAN-x4',
      version: '2.1.0',
      endpoint: '/ai/upscale',
      size: 500 * 1024 * 1024, // 500 MB
      accuracy: '95%',
      maxFactor: 4,
      requirements: {
        gpu: 'CUDA',
        minVRAM: 6 * 1024 * 1024 * 1024 // 6 GB VRAM
      },
      metadata: {
        tileSize: 512,
        overlap: 32,
        batchSize: 2
      }
    }
  },
  
  // ========================================================================
  // DENOISE - Шумоподавление
  // ========================================================================
  denoise: {
    task: 'denoise',
    description: 'Удаление шума из изображения',
    
    offline: {
      name: 'NAFNet-light',
      version: '1.0.0',
      path: '/models/nafnet-light.onnx',
      size: 50 * 1024 * 1024, // 50 MB
      accuracy: '82%',
      requirements: {
        minMemory: 512 * 1024 * 1024, // 512 MB RAM
        preferredBackend: 'wasm'
      },
      metadata: {
        inputSize: [512, 512],
        levels: ['light', 'medium'] // Уровни шумоподавления
      }
    },
    
    online: {
      name: 'NAFNet-heavy',
      version: '1.1.0',
      endpoint: '/ai/denoise',
      size: 400 * 1024 * 1024, // 400 MB
      accuracy: '94%',
      requirements: {
        gpu: 'CUDA',
        minVRAM: 4 * 1024 * 1024 * 1024 // 4 GB VRAM
      },
      metadata: {
        inputSize: [1024, 1024],
        levels: ['light', 'medium', 'heavy'],
        batchSize: 4
      }
    }
  },
  
  // ========================================================================
  // OBJECT DETECTION - Детекция объектов
  // ========================================================================
  detectObjects: {
    task: 'detectObjects',
    description: 'Обнаружение объектов на изображении',
    
    offline: {
      name: 'COCO-SSD',
      version: '2.2.2',
      path: null, // Загружается через TensorFlow.js CDN
      size: 50 * 1024 * 1024, // ~50 MB
      accuracy: '75%',
      requirements: {
        minMemory: 256 * 1024 * 1024 // 256 MB RAM
      },
      metadata: {
        classes: 80, // COCO dataset classes
        minScore: 0.5
      }
    },
    
    online: {
      name: 'YOLOv8-Large',
      version: '8.0.0',
      endpoint: '/ai/detect-objects',
      size: 300 * 1024 * 1024, // 300 MB
      accuracy: '92%',
      requirements: {
        gpu: 'CUDA',
        minVRAM: 2 * 1024 * 1024 * 1024 // 2 GB VRAM
      },
      metadata: {
        classes: 80,
        minScore: 0.3,
        batchSize: 8
      }
    }
  },
  
  // ========================================================================
  // FACE DETECTION - Детекция лиц
  // ========================================================================
  detectFaces: {
    task: 'detectFaces',
    description: 'Обнаружение лиц на изображении',
    
    offline: {
      name: 'Face Detection API',
      version: 'browser',
      path: null, // Встроенный API браузера
      size: 0,
      accuracy: '80%',
      requirements: {
        browser: ['chrome', 'edge'] // Поддерживается не везде
      },
      metadata: {
        maxDetections: 10,
        fastMode: true
      }
    },
    
    online: {
      name: 'RetinaFace',
      version: '1.0.0',
      endpoint: '/ai/detect-faces',
      size: 100 * 1024 * 1024, // 100 MB
      accuracy: '96%',
      requirements: {
        gpu: 'CUDA',
        minVRAM: 2 * 1024 * 1024 * 1024 // 2 GB VRAM
      },
      metadata: {
        maxDetections: 100,
        landmarks: 5, // Количество ключевых точек
        batchSize: 16
      }
    }
  }
};

/**
 * Получить информацию о модели
 * @param {string} task - Название задачи
 * @param {'offline'|'online'} mode - Режим
 * @returns {ModelVersion|null}
 */
export function getModelInfo(task, mode) {
  const entry = MODEL_REGISTRY[task];
  if (!entry) return null;
  return entry[mode] || null;
}

/**
 * Проверить доступность модели
 * @param {string} task - Название задачи
 * @param {'offline'|'online'} mode - Режим
 * @returns {Promise<boolean>}
 */
export async function checkModelAvailability(task, mode) {
  const model = getModelInfo(task, mode);
  if (!model) return false;
  
  if (mode === 'offline') {
    // Для оффлайн моделей проверяем наличие файла или API
    if (model.path) {
      // Проверка наличия .onnx файла
      try {
        const response = await fetch(model.path, { method: 'HEAD' });
        return response.ok;
      } catch {
        return false;
      }
    } else {
      // Встроенные API (Face Detection, COCO-SSD через CDN)
      return true; // Предполагаем что доступны
    }
  } else {
    // Для онлайн моделей проверяем endpoint
    // Это будет сделано через SmartRouter.checkBackendAvailability()
    return true; // Предполагаем что backend сам проверит доступность
  }
}

/**
 * Получить список всех задач
 * @returns {Array<string>}
 */
export function getAllTasks() {
  return Object.keys(MODEL_REGISTRY);
}

/**
 * Получить список задач доступных в режиме
 * @param {'offline'|'online'} mode - Режим
 * @returns {Promise<Array<string>>}
 */
export async function getAvailableTasks(mode) {
  const tasks = getAllTasks();
  const available = [];
  
  for (const task of tasks) {
    const isAvailable = await checkModelAvailability(task, mode);
    if (isAvailable) {
      available.push(task);
    }
  }
  
  return available;
}

/**
 * Получить требования к системе для модели
 * @param {string} task - Название задачи
 * @param {'offline'|'online'} mode - Режим
 * @returns {Object|null}
 */
export function getModelRequirements(task, mode) {
  const model = getModelInfo(task, mode);
  return model ? model.requirements : null;
}

/**
 * Сравнить модели (оффлайн vs онлайн)
 * @param {string} task - Название задачи
 * @returns {Object} Сравнение характеристик
 */
export function compareModels(task) {
  const entry = MODEL_REGISTRY[task];
  if (!entry) return null;
  
  const { offline, online } = entry;
  
  return {
    task,
    description: entry.description,
    comparison: {
      size: {
        offline: formatBytes(offline.size),
        online: formatBytes(online.size),
        ratio: (online.size / offline.size).toFixed(1) + 'x'
      },
      accuracy: {
        offline: offline.accuracy,
        online: online.accuracy,
        diff: (parseFloat(online.accuracy) - parseFloat(offline.accuracy)).toFixed(1) + '%'
      },
      maxFactor: {
        offline: offline.maxFactor || 'N/A',
        online: online.maxFactor || 'N/A'
      }
    }
  };
}

/**
 * Форматировать байты в читаемый вид
 * @private
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 10) / 10 + ' ' + sizes[i];
}