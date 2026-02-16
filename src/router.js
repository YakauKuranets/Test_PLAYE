/*
 * Smart Router for hybrid mode switching.
 *
 * Маршрутизирует AI запросы между локальными моделями (ONNX) и облачным
 * backend (PyTorch+CUDA) в зависимости от режима работы и доступности интернета.
 */

/**
 * Режимы работы роутера
 * @typedef {'auto'|'offline'|'online'} RouterMode
 * - auto: автоматический выбор на основе доступности интернета
 * - offline: принудительно только локальные модели
 * - online: принудительно только облачный backend (с fallback на offline)
 */

export class SmartRouter {
  constructor() {
    /** @type {RouterMode} */
    this.mode = 'auto';
    
    /** @type {boolean} */
    this.online = navigator.onLine;
    
    /** @type {string|null} */
    this.backendUrl = null; // Будет установлен позже из конфига
    
    /** @type {HTMLElement|null} */
    this.indicatorEl = null;
    
    /** @type {Array<Function>} */
    this.listeners = [];
    
    // Подписка на события сети
    this._setupNetworkListeners();
  }

  /**
   * Установить URL облачного backend
   * @param {string} url - URL API endpoint (например, 'http://localhost:8000/api')
   */
  setBackendUrl(url) {
    this.backendUrl = url;
  }

  /**
   * Установить режим работы
   * @param {RouterMode} mode - Режим: 'auto', 'offline', или 'online'
   */
  setMode(mode) {
    if (!['auto', 'offline', 'online'].includes(mode)) {
      console.error('Invalid mode:', mode);
      return;
    }
    this.mode = mode;
    this._notifyListeners();
    this._updateIndicator();
  }

  /**
   * Получить текущий режим работы
   * @returns {RouterMode}
   */
  getMode() {
    return this.mode;
  }

  /**
   * Получить эффективный режим (с учетом доступности сети)
   * @returns {'offline'|'online'}
   */
  getEffectiveMode() {
    if (this.mode === 'offline') {
      return 'offline';
    }
    
    if (this.mode === 'online') {
      // Если пользователь выбрал online, но сети нет - fallback на offline
      if (!this.online) {
        console.warn('Online mode requested but network unavailable. Falling back to offline.');
        return 'offline';
      }
      return 'online';
    }
    
    // Режим 'auto' - решение на основе доступности сети
    return this.online ? 'online' : 'offline';
  }

  /**
   * Проверить доступность облачного backend
   * @returns {Promise<boolean>}
   */
  async checkBackendAvailability() {
    if (!this.backendUrl || !this.online) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

      const response = await fetch(`${this.backendUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (err) {
      console.warn('Backend health check failed:', err.message);
      return false;
    }
  }

  /**
   * Маршрутизировать AI запрос
   * @param {string} task - Тип задачи ('faceEnhance', 'upscale', 'denoise', и т.д.)
   * @param {any} data - Данные для обработки
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<any>} Результат обработки
   */
  async routeAiRequest(task, data, options = {}) {
    const effectiveMode = this.getEffectiveMode();
    
    console.log(`[SmartRouter] Routing task "${task}" in ${effectiveMode} mode`);

    if (effectiveMode === 'offline') {
      return this._routeToLocalModels(task, data, options);
    } else {
      // Попытка использовать облачный backend с fallback на локальные модели
      try {
        return await this._routeToCloudBackend(task, data, options);
      } catch (err) {
        console.error('[SmartRouter] Cloud backend failed, falling back to local:', err);
        return this._routeToLocalModels(task, data, options);
      }
    }
  }

  /**
   * Маршрутизация на локальные модели (ONNX)
   * @private
   */
  async _routeToLocalModels(task, data, options) {
    // Импорт будет позже при интеграции с моделями
    const { runLocalModel } = await import('./models/localRunner.js');
    return runLocalModel(task, data, options);
  }

  /**
   * Маршрутизация на облачный backend
   * @private
   */
  async _routeToCloudBackend(task, data, options) {
    // Для взаимодействия с облачным backend используем API client.
    // Динамический импорт нужен для избежания циклической зависимости
    const { apiClient } = await import('./api/client.js');

    // Если data - это изображение, используем postImage; иначе post (JSON)
    let result;
    if (typeof ImageData !== 'undefined' && data instanceof ImageData) {
      result = await apiClient.postImage(`/ai/${task}`, data, { params: options });
    } else if (data instanceof Blob || data instanceof File) {
      result = await apiClient.postImage(`/ai/${task}`, data, { params: options });
    } else {
      // Отправка JSON (например, параметры поиска)
      result = await apiClient.post(`/ai/${task}`, { ...data, ...options });
    }

    if (!result.success) {
      throw new Error(result.error || 'Unknown backend error');
    }
    // Вернуть только полезные данные
    return result.data;
  }

  /**
   * Конвертация Blob в ImageData
   * @private
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

  /**
   * Установить элемент индикатора для отображения статуса
   * @param {HTMLElement} element
   */
  setIndicator(element) {
    this.indicatorEl = element;
    this._updateIndicator();
  }

  /**
   * Обновить визуальный индикатор
   * @private
   */
  _updateIndicator() {
    if (!this.indicatorEl) return;

    const effectiveMode = this.getEffectiveMode();
    const icon = effectiveMode === 'online' ? '🌐' : '🔌';
    const text = effectiveMode === 'online' ? 'Онлайн' : 'Оффлайн';
    
    this.indicatorEl.textContent = `${icon} ${text}`;
    this.indicatorEl.classList.toggle('online', effectiveMode === 'online');
    this.indicatorEl.classList.toggle('offline', effectiveMode === 'offline');
    
    // Добавить информацию о режиме если не auto
    if (this.mode !== 'auto') {
      this.indicatorEl.title = `Режим: ${this.mode}`;
    } else {
      this.indicatorEl.title = 'Режим: авто';
    }
  }

  /**
   * Настройка слушателей событий сети
   * @private
   */
  _setupNetworkListeners() {
    const updateOnline = () => {
      this.online = navigator.onLine;
      this._updateIndicator();
      this._notifyListeners();
    };

    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
  }

  /**
   * Подписаться на изменения режима
   * @param {Function} callback - Функция вызываемая при изменении
   */
  subscribe(callback) {
    this.listeners.push(callback);
  }

  /**
   * Отписаться от изменений режима
   * @param {Function} callback
   */
  unsubscribe(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  /**
   * Уведомить подписчиков об изменениях
   * @private
   */
  _notifyListeners() {
    const effectiveMode = this.getEffectiveMode();
    this.listeners.forEach(cb => {
      try {
        cb({ mode: this.mode, effectiveMode, online: this.online });
      } catch (err) {
        console.error('Listener error:', err);
      }
    });
  }
}

// Создать глобальный экземпляр роутера
export const smartRouter = new SmartRouter();

/**
 * Инициализировать роутер с элементом индикатора
 * @deprecated Используйте smartRouter напрямую
 */
export function initSmartRouter(indicatorEl) {
  smartRouter.setIndicator(indicatorEl);
}