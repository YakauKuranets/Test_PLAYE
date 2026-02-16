/**
 * CloudStorage module
 *
 * Класс, обеспечивающий взаимодействие с облачным хранилищем
 * для синхронизации дел (cases) и других ресурсов. Реализация
 * предназначена для этапа 4 и использует ApiClient для запросов.
 */

import { apiClient } from './client.js';

/**
 * Class representing cloud storage for cases.
 */
export class CloudStorage {
  constructor() {
    // Возможные настройки можно добавить позже
  }

  /**
   * Загрузить (создать или обновить) дело на сервере
   * @param {Object} caseData - Полные данные дела
   * @returns {Promise<ApiResponse>}
   */
  async uploadCase(caseData) {
    return apiClient.post('/cases', caseData);
  }

  /**
   * Скачать список дел с сервера
   * @returns {Promise<ApiResponse>}
   */
  async downloadCases() {
    return apiClient.get('/cases');
  }

  /**
   * Синхронизировать локальные дела с сервером
   * @param {Array<Object>} localCases - список локальных дел
   * @returns {Promise<Array<Object>>} - список дел после синхронизации
   */
  async syncCases(localCases = []) {
    // Получить удалённые дела с сервера
    const remoteRes = await this.downloadCases();
    if (!remoteRes.success) {
      throw new Error(remoteRes.error || 'Failed to download cases');
    }
    const remoteCases = Array.isArray(remoteRes.data) ? remoteRes.data : [];
    // Создать карту merged по id
    const mergedMap = new Map();
    // Добавить все удалённые дела
    for (const remote of remoteCases) {
      if (remote && remote.id) {
        mergedMap.set(remote.id, remote);
      }
    }
    // Объединить с локальными делами, выбирая более новую версию
    for (const local of localCases || []) {
      if (!local || !local.id) continue;
      const existing = mergedMap.get(local.id);
      const chosen = this.resolveConflict(local, existing);
      mergedMap.set(local.id, chosen);
      // Если выбранная версия — локальная (значит, она новее или удалённая отсутствует)
      // — отправить её на сервер.  Это синхронизирует удалённое хранилище с локальными
      // обновлениями. Ошибки загрузки игнорируем, чтобы не блокировать синхронизацию.
      if (chosen === local && (!existing || (new Date(local.updatedAt || local.updated_at || 0).getTime() > new Date(existing?.updatedAt || existing?.updated_at || 0).getTime()))) {
        try {
          await this.uploadCase(local);
        } catch (err) {
          console.warn('Failed to upload case to remote:', err);
        }
      }
    }
    // Вернуть объединённый список
    return Array.from(mergedMap.values());
  }

  /**
   * Разрешение конфликта между локальным и удалённым делом
   * @param {Object} localCase - локальная версия
   * @param {Object} remoteCase - серверная версия
   * @returns {Object} выбранная версия
   */
  resolveConflict(localCase, remoteCase) {
    // Простая стратегия: выбираем дело с более новой датой обновления
    if (!localCase && remoteCase) return remoteCase;
    if (!remoteCase && localCase) return localCase;
    if (!localCase && !remoteCase) return null;
    const localTime = new Date(localCase.updatedAt || localCase.updated_at || 0).getTime();
    const remoteTime = new Date(remoteCase.updatedAt || remoteCase.updated_at || 0).getTime();
    return localTime >= remoteTime ? localCase : remoteCase;
  }
}

// Singleton instance for convenience
export const cloudStorage = new CloudStorage();