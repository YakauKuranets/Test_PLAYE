# Backend AI MVP

Минимальный backend для Stage 3+ (job-flow, error contract, cancel/timeout и idempotency/list в Stage 4.6).

## Локальный запуск (без Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Запуск через Docker Compose (Stage 4.4)

Из корня репозитория:

```bash
docker compose up --build
```

После старта:
- frontend: `http://127.0.0.1:4173`
- backend: `http://127.0.0.1:8000`

Остановка:

```bash
docker compose down
```

## Endpoint

- `GET /health`
- `POST /detect/objects` — синхронный MVP endpoint, принимает JSON с полем `imageBase64` (data URL).
- `POST /jobs` — создать асинхронную задачу (`task=detect-objects`), поддерживает `idempotencyKey`.
- `GET /jobs` — список задач с фильтрацией (`status`) и пагинацией (`limit`, `cursor`).
- `GET /jobs/{jobId}` — статус задачи.
- `GET /jobs/{jobId}/result` — результат завершённой задачи.
- `POST /jobs/{jobId}/cancel` — отмена задачи (если она ещё не завершена).

Frontend по умолчанию ожидает backend на `http://127.0.0.1:8000`.
Можно переопределить через `window.__AI_BACKEND_URL` или через UI-поле `Backend endpoint (MVP)`.

## Быстрая проверка

```bash
curl http://127.0.0.1:8000/health
```

## Примечания

- В MVP включен CORS (`allow_origins=["*"]`), чтобы фронтенд на другом порту (например `:4173`) мог обращаться к backend на `:8000`.
- `POST /detect/objects` и job-flow возвращают `requestId` и `latencyMs` для трассировки.
- В Stage 4.2 добавлены очистка/ограничение in-memory jobs (`JOBS_TTL_SECONDS`, `JOBS_MAX_ITEMS`) и `jobsInMemory` в `/health`.

## Error contract

При ошибках backend возвращает JSON:

```json
{
  "code": "job_not_found",
  "message": "job not found",
  "requestId": "...",
  "details": {}
}
```

## Тесты

Локально:

```bash
cd backend
python -m unittest tests/test_api.py
```

CI (GitHub Actions): workflow `.github/workflows/backend-tests.yml` запускает backend-тесты при изменениях в `backend/**`.


## Stage 4.5 (job control)

- Добавлены новые terminal-статусы jobs: `canceled` и `timeout`.
- Добавлен endpoint отмены `POST /jobs/{jobId}/cancel`.
- Добавлен server-side timeout выполнения (`JOB_RUN_TIMEOUT_SECONDS`).
- В `/health` добавлено поле `jobRunTimeoutSec`.

> Поле `debugSleepMs` в request используется только для локальной отладки/контрактных тестов (искусственная задержка).


## Stage 4.6 (idempotency + jobs list)

- `POST /jobs` поддерживает `idempotencyKey`: повтор запроса с тем же ключом возвращает существующую задачу.
- Добавлен `GET /jobs` со статус-фильтром (`status`) и пагинацией (`limit`, `cursor`).
- В `/health` добавлено поле `idempotencyKeysInMemory`.
- Добавлены контрактные тесты для idempotency и list/pagination сценариев.


## Stage 4.8.4 (UI ops stabilization)

- Frontend jobs monitor now shows `Last update` and warning state while preserving existing list items on transient fetch errors.
- Jobs retry in UI prefers original snapshot payload (deterministic forensic replay) when available.
- `Copy JSON` action added in jobs monitor for done jobs to export `/jobs/{id}/result` quickly.
