/**
 * Application Configuration
 *
 * Централизованные настройки приложения.
 * Значения можно переопределить через localStorage или environment variables.
 */

/**
 * @typedef {Object} AppConfig
 * @property {Object} router - Настройки роутера
 * @property {string} router.defaultMode - Режим по умолчанию
 * @property {string} router.backendUrl - URL облачного backend
 * @property {number} router.backendTimeout - Timeout для запросов к backend (ms)
 * @property {Object} models - Настройки моделей
 * @property {Object} models.local - Локальные модели
 * @property {Object} models.cloud - Облачные модели
 * @property {Object} storage - Настройки хранилища
 * @property {string} storage.dbName - Имя IndexedDB базы
 * @property {number} storage.dbVersion - Версия схемы базы
 * @property {Object} features - Флаги функциональности
 */

/** @type {AppConfig} */
const DEFAULT_CONFIG = {
  // Router settings
  router: {
    defaultMode: 'auto', // 'auto' | 'offline' | 'online'
    backendUrl: 'http://localhost:8000/api',
    backendTimeout: 30000, // 30 seconds
    healthCheckInterval: 60000, // 1 minute
  },

  // Model settings
  models: {
    local: {
      basePath: '/models',
      // Модели которые будут добавлены в Этапе 2
      available: {
        gfpgan: {
          path: '/models/gfpgan-light.onnx',
          size: 350 * 1024 * 1024, // 350 MB
          version: '1.3.0'
        },
        realesrgan: {
          path: '/models/realesrgan-x2.onnx',
          size: 100 * 1024 * 1024, // 100 MB
          version: '2.0.0'
        },
        nafnet: {
          path: '/models/nafnet-light.onnx',
          size: 50 * 1024 * 1024, // 50 MB
          version: '1.0.0'
        }
      }
    },
    cloud: {
      endpoints: {
        faceEnhance: '/ai/face-enhance',
        upscale: '/ai/upscale',
        denoise: '/ai/denoise',
        detectFaces: '/ai/detect-faces',
        detectObjects: '/ai/detect-objects'
      }
    }
  },

  // Storage settings
  storage: {
    dbName: 'PlayePhotoLab',
    dbVersion: 1,
    stores: {
      cases: 'cases',
      models: 'models',
      cache: 'cache'
    }
  },

  // Feature flags
  features: {
    enableCloudBackend: true,
    enableModelCaching: true,
    enableBatchProcessing: true,
    enableSync: false, // Будет включено в Этапе 4
  },

  // Development settings
  dev: {
    enableDebugLogs: true,
    mockBackendDelay: 2000, // ms
  }
};

/**
 * Загрузить конфигурацию
 * Объединяет дефолтные значения с сохраненными в localStorage
 * @returns {AppConfig}
 */
export function loadConfig() {
  const config = { ...DEFAULT_CONFIG };
  const storage = getLocalStorage();

  if (storage) {
    try {
      // Попытка загрузить из localStorage
      const saved = storage.getItem('appConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Глубокое слияние конфигов
        deepMerge(config, parsed);
      }
    } catch (err) {
      console.warn('[Config] Failed to load from localStorage:', err);
    }
  }
  // Переопределение из environment (если доступно)
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.BACKEND_URL) {
      config.router.backendUrl = process.env.BACKEND_URL;
    }
  }
  return config;
}

/**
 * Сохранить конфигурацию
 * @param {Partial<AppConfig>} updates - Изменения для сохранения
 */
export function saveConfig(updates) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const current = loadConfig();
    const updated = { ...current, ...updates };
    storage.setItem('appConfig', JSON.stringify(updated));
    console.log('[Config] Saved to localStorage');
  } catch (err) {
    console.error('[Config] Failed to save:', err);
  }
}

/**
 * Получить значение из конфига
 * @param {string} path - Путь через точку (например, 'router.backendUrl')
 * @param {any} defaultValue - Значение по умолчанию
 * @returns {any}
 */
export function getConfigValue(path, defaultValue = null) {
  const config = loadConfig();
  const keys = path.split('.');
  let value = config;
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }
  return value;
}

/**
 * Установить значение в конфиге
 * @param {string} path - Путь через точку
 * @param {any} value - Новое значение
 */
export function setConfigValue(path, value) {
  const config = loadConfig();
  const keys = path.split('.');
  const lastKey = keys.pop();
  let target = config;
  for (const key of keys) {
    if (!(key in target) || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target = target[key];
  }
  target[lastKey] = value;
  saveConfig(config);
}

/**
 * Сбросить конфигурацию к значениям по умолчанию
 */
export function resetConfig() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.removeItem('appConfig');
  console.log('[Config] Reset to defaults');
}



function getLocalStorage() {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage;
}

/**
 * Глубокое слияние объектов
 * @private
 */
function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

// Экспорт дефолтной конфигурации (read-only)
export { DEFAULT_CONFIG };