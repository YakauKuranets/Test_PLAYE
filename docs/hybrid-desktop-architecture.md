# Hybrid Desktop Architecture (Electron + Local Python AI)

Этот документ фиксирует реализацию подхода, который вы предложили: desktop-приложение
с локальным Python backend и моделями на диске пользователя.

## Цели

- Работать оффлайн после первичной установки.
- Использовать локальный GPU через PyTorch.
- Не хранить тяжёлые модели в браузерном IndexedDB.
- Обновлять модели отдельно от UI.

## Минимальная схема

```text
Electron UI
  -> IPC bridge (preload)
  -> Node orchestration (main process)
  -> Local FastAPI (127.0.0.1)
  -> PyTorch models from ./models
```

## Рекомендуемая стратегия зависимостей

1. `backend/requirements.txt` — только обязательный runtime backend.
2. `backend/requirements-ai.txt` — тяжёлый optional стек (`basicsr/gfpgan/...`).
3. Установка optional стека по кнопке/команде, а не при каждом `pip install -r requirements.txt`.

## Поток запуска

1. Electron стартует локальный backend-процесс (`uvicorn app.main:app ...`).
2. UI проверяет `/api/health`.
3. Smart Router выбирает:
   - local python backend (приоритет),
   - browser onnx fallback,
   - cloud fallback (если включено и online).

## Модель обновлений

- Хранить `models/manifest.json` с версиями и checksum.
- Проверять удалённый manifest по расписанию или вручную.
- Обновлять только изменившиеся веса.
- Писать в audit-log: какая модель, версия, источник и checksum.

## Практический roadmap

1. Добавить `electron/` (main/preload) и dev script для совместного запуска UI + backend.
2. Вынести операции скачивания/обновления моделей в отдельный модуль.
3. Добавить UI-экран "Модели" (состояние, размер, версия, обновления).
4. Включить ретраи и контроль свободного места перед скачиванием.
5. Добавить smoke-тест старта: backend поднимается, health доступен, graceful shutdown корректный.



## Статус реализации (текущее состояние)

Сделан минимальный технический каркас:

- `electron/main.js` — старт Electron окна и локального FastAPI backend через `uvicorn`.
- `electron/preload.js` — безопасный мост с базовой информацией о локальном backend.
- `models/manifest.json` — локальный реестр версий моделей.
- `scripts/model-updater.js` — общий модуль проверки/скачивания/валидации моделей (checksum + контроль свободного места).
- `scripts/check-model-updates.js` — CLI-проверка локального/удалённого manifest.
- `scripts/update-models.js` — CLI-обновление моделей из удалённого manifest.

Что ещё не закрыто:

- UI-экран управления моделями (обновить/очистить/статус свободного места).
- Интеграционный smoke для Electron + backend c реальным open-window запуском (пока есть backend-only smoke).

Итого по roadmap: **закрыто 4 из 5 шагов полностью**, осталось **1 из 5 шагов (~20%)**.

Добавлено: `scripts/smoke-backend-start.js` — поднимает локальный FastAPI backend, проверяет `/api/health` и завершает процесс (graceful shutdown).

