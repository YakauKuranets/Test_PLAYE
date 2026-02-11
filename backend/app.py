from __future__ import annotations

import base64
import io
import threading
import time
import uuid
from typing import Dict, List, Literal, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from PIL import Image, ImageFilter


app = FastAPI(title="Test_PLAYE backend AI MVP", version="0.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ApiError(BaseModel):
    code: str
    message: str
    requestId: str
    details: Optional[dict] = None


class DetectRequest(BaseModel):
    imageBase64: str
    minScore: float = 0.35
    debugSleepMs: int = 0


class DetectedObject(BaseModel):
    x: float
    y: float
    width: float
    height: float
    label: str
    score: float


class DetectResponse(BaseModel):
    objects: List[DetectedObject]
    modelVersion: str
    latencyMs: float
    requestId: str


class JobCreateRequest(BaseModel):
    task: Literal["detect-objects"]
    imageBase64: str
    minScore: float = 0.35
    debugSleepMs: int = 0
    idempotencyKey: Optional[str] = None


JobStatusLiteral = Literal["pending", "running", "done", "failed", "canceled", "timeout"]


class JobCreateResponse(BaseModel):
    jobId: str
    status: JobStatusLiteral
    acceptedAt: str
    requestId: str


class JobStatusResponse(BaseModel):
    jobId: str
    status: JobStatusLiteral
    task: str
    createdAt: str
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    error: Optional[str] = None
    requestId: str


class JobListItem(BaseModel):
    jobId: str
    status: JobStatusLiteral
    task: str
    createdAt: str
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    error: Optional[str] = None


class JobListResponse(BaseModel):
    items: List[JobListItem]
    nextCursor: Optional[str] = None
    requestId: str


class JobResultResponse(DetectResponse):
    jobId: str


class JobRecord(BaseModel):
    jobId: str
    status: JobStatusLiteral
    task: str
    createdAt: str
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    error: Optional[str] = None
    result: Optional[DetectResponse] = None
    idempotencyKey: Optional[str] = None


_jobs_lock = threading.Lock()
_jobs: Dict[str, JobRecord] = {}
_jobs_by_idempotency: Dict[str, str] = {}
JOBS_MAX_ITEMS = 200
JOBS_TTL_SECONDS = 1800
JOB_RUN_TIMEOUT_SECONDS = 8.0


def _new_request_id() -> str:
    return str(uuid.uuid4())


def _error_response(status_code: int, code: str, message: str, details: Optional[dict] = None) -> JSONResponse:
    payload = ApiError(code=code, message=message, requestId=_new_request_id(), details=details)
    return JSONResponse(status_code=status_code, content=payload.model_dump())


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return _error_response(
        422,
        "validation_error",
        "Request validation failed",
        {"errors": exc.errors(), "path": str(request.url.path)},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and {"code", "message", "requestId"}.issubset(set(detail.keys())):
        return JSONResponse(status_code=exc.status_code, content=detail)
    return _error_response(
        exc.status_code,
        "http_error",
        str(detail),
        {"path": str(request.url.path)},
    )


def _job_time_to_epoch(value: Optional[str]) -> float:
    if not value:
        return 0.0
    try:
        return time.mktime(time.strptime(value, "%Y-%m-%dT%H:%M:%SZ"))
    except Exception:
        return 0.0


def _cleanup_jobs() -> None:
    now = time.time()
    removable: List[str] = []
    for job_id, record in _jobs.items():
        if record.status in {"done", "failed", "canceled", "timeout"} and record.finishedAt:
            finished_epoch = _job_time_to_epoch(record.finishedAt)
            if finished_epoch and (now - finished_epoch) > JOBS_TTL_SECONDS:
                removable.append(job_id)

    for job_id in removable:
        _jobs.pop(job_id, None)

    if len(_jobs) > JOBS_MAX_ITEMS:
        ordered = sorted(
            _jobs.items(),
            key=lambda item: _job_time_to_epoch(item[1].createdAt),
        )
        overflow = len(_jobs) - JOBS_MAX_ITEMS
        for job_id, _ in ordered[:overflow]:
            _jobs.pop(job_id, None)

    _jobs_by_idempotency.clear()
    for job_id, record in _jobs.items():
        if record.idempotencyKey:
            _jobs_by_idempotency[record.idempotencyKey] = job_id


def _decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("invalid data URL")
    _, encoded = data_url.split(",", 1)
    return base64.b64decode(encoded)


def _heuristic_detect(image: Image.Image, min_score: float) -> List[DetectedObject]:
    gray = image.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    width, height = edges.size

    pixels = edges.load()
    threshold = 40
    xs, ys = [], []
    for y in range(height):
        for x in range(width):
            if pixels[x, y] >= threshold:
                xs.append(x)
                ys.append(y)

    if not xs or not ys:
        return []

    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)

    box_w = max(1, xmax - xmin)
    box_h = max(1, ymax - ymin)
    area_ratio = (box_w * box_h) / max(1, width * height)
    score = max(0.35, min(0.95, area_ratio + 0.25))
    if score < min_score:
        return []

    return [
        DetectedObject(
            x=float(xmin),
            y=float(ymin),
            width=float(box_w),
            height=float(box_h),
            label="foreground",
            score=float(round(score, 3)),
        )
    ]


def _run_detect(payload: DetectRequest) -> DetectResponse:
    started = time.perf_counter()
    if payload.debugSleepMs > 0:
        time.sleep(payload.debugSleepMs / 1000)
    raw = _decode_data_url(payload.imageBase64)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    objects = _heuristic_detect(image, payload.minScore)
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    return DetectResponse(
        objects=objects,
        modelVersion="backend-mvp-edge-heuristic-0.5.0",
        latencyMs=latency_ms,
        requestId=_new_request_id(),
    )


def _mark_job_finished(record: JobRecord, status: JobStatusLiteral, error: Optional[str] = None) -> None:
    record.status = status
    record.error = error
    record.finishedAt = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _process_job(job_id: str, payload: DetectRequest) -> None:
    with _jobs_lock:
        _cleanup_jobs()
        record = _jobs.get(job_id)
        if not record:
            return
        if record.status == "canceled":
            return
        record.status = "running"
        record.startedAt = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    started = time.perf_counter()
    try:
        result = _run_detect(payload)
        elapsed_s = time.perf_counter() - started
        with _jobs_lock:
            record = _jobs.get(job_id)
            if not record:
                return
            if record.status == "canceled":
                return
            if elapsed_s > JOB_RUN_TIMEOUT_SECONDS:
                _mark_job_finished(record, "timeout", "job exceeded processing timeout")
                return
            record.status = "done"
            record.finishedAt = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            record.result = result
    except Exception as exc:  # noqa: BLE001
        with _jobs_lock:
            record = _jobs.get(job_id)
            if not record:
                return
            if record.status == "canceled":
                return
            _mark_job_finished(record, "failed", str(exc))


def _to_job_status_response(record: JobRecord) -> JobStatusResponse:
    return JobStatusResponse(
        jobId=record.jobId,
        status=record.status,
        task=record.task,
        createdAt=record.createdAt,
        startedAt=record.startedAt,
        finishedAt=record.finishedAt,
        error=record.error,
        requestId=_new_request_id(),
    )


@app.get("/health")
def health() -> dict:
    with _jobs_lock:
        _cleanup_jobs()
        total_jobs = len(_jobs)
        total_keys = len(_jobs_by_idempotency)
    return {
        "status": "ok",
        "service": "backend-ai-mvp",
        "version": "0.5.0",
        "jobsInMemory": total_jobs,
        "idempotencyKeysInMemory": total_keys,
        "jobRunTimeoutSec": JOB_RUN_TIMEOUT_SECONDS,
        "requestId": _new_request_id(),
    }


@app.post("/detect/objects", response_model=DetectResponse)
def detect_objects(payload: DetectRequest) -> DetectResponse:
    try:
        return _run_detect(payload)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=ApiError(
                code="invalid_image_payload",
                message=f"invalid image payload: {exc}",
                requestId=_new_request_id(),
                details={"stage": "decode_or_open"},
            ).model_dump(),
        ) from exc


@app.post("/jobs", response_model=JobCreateResponse)
def create_job(payload: JobCreateRequest, background_tasks: BackgroundTasks) -> JobCreateResponse:
    if payload.task != "detect-objects":
        raise HTTPException(
            status_code=400,
            detail=ApiError(
                code="unsupported_task",
                message="unsupported task",
                requestId=_new_request_id(),
                details={"task": payload.task},
            ).model_dump(),
        )

    with _jobs_lock:
        _cleanup_jobs()

        if payload.idempotencyKey:
            existing_job_id = _jobs_by_idempotency.get(payload.idempotencyKey)
            if existing_job_id:
                existing = _jobs.get(existing_job_id)
                if existing:
                    return JobCreateResponse(
                        jobId=existing.jobId,
                        status=existing.status,
                        acceptedAt=existing.createdAt,
                        requestId=_new_request_id(),
                    )

        job_id = _new_request_id()
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        record = JobRecord(
            jobId=job_id,
            status="pending",
            task=payload.task,
            createdAt=now,
            idempotencyKey=payload.idempotencyKey,
        )
        _jobs[job_id] = record
        if payload.idempotencyKey:
            _jobs_by_idempotency[payload.idempotencyKey] = job_id

    detect_payload = DetectRequest(
        imageBase64=payload.imageBase64,
        minScore=payload.minScore,
        debugSleepMs=payload.debugSleepMs,
    )
    background_tasks.add_task(_process_job, job_id, detect_payload)

    return JobCreateResponse(jobId=job_id, status="pending", acceptedAt=now, requestId=_new_request_id())


@app.get("/jobs", response_model=JobListResponse)
def list_jobs(status: Optional[JobStatusLiteral] = None, limit: int = 20, cursor: Optional[str] = None) -> JobListResponse:
    if limit < 1 or limit > 100:
        raise HTTPException(
            status_code=400,
            detail=ApiError(
                code="invalid_pagination",
                message="limit must be between 1 and 100",
                requestId=_new_request_id(),
                details={"limit": limit},
            ).model_dump(),
        )

    offset = 0
    if cursor:
        try:
            offset = int(cursor)
            if offset < 0:
                raise ValueError("negative cursor")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=400,
                detail=ApiError(
                    code="invalid_cursor",
                    message="cursor must be a non-negative integer",
                    requestId=_new_request_id(),
                    details={"cursor": cursor},
                ).model_dump(),
            ) from exc

    with _jobs_lock:
        _cleanup_jobs()
        records = list(_jobs.values())

    records.sort(key=lambda item: _job_time_to_epoch(item.createdAt), reverse=True)
    if status is not None:
        records = [item for item in records if item.status == status]

    page = records[offset : offset + limit]
    next_cursor = None
    if offset + limit < len(records):
        next_cursor = str(offset + limit)

    items = [
        JobListItem(
            jobId=record.jobId,
            status=record.status,
            task=record.task,
            createdAt=record.createdAt,
            startedAt=record.startedAt,
            finishedAt=record.finishedAt,
            error=record.error,
        )
        for record in page
    ]

    return JobListResponse(items=items, nextCursor=next_cursor, requestId=_new_request_id())


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str) -> JobStatusResponse:
    with _jobs_lock:
        _cleanup_jobs()
        record = _jobs.get(job_id)
        if not record:
            raise HTTPException(
                status_code=404,
                detail=ApiError(
                    code="job_not_found",
                    message="job not found",
                    requestId=_new_request_id(),
                    details={"jobId": job_id},
                ).model_dump(),
            )

        return _to_job_status_response(record)


@app.post("/jobs/{job_id}/cancel", response_model=JobStatusResponse)
def cancel_job(job_id: str) -> JobStatusResponse:
    with _jobs_lock:
        _cleanup_jobs()
        record = _jobs.get(job_id)
        if not record:
            raise HTTPException(
                status_code=404,
                detail=ApiError(
                    code="job_not_found",
                    message="job not found",
                    requestId=_new_request_id(),
                    details={"jobId": job_id},
                ).model_dump(),
            )

        if record.status in {"done", "failed", "timeout"}:
            raise HTTPException(
                status_code=409,
                detail=ApiError(
                    code="job_not_cancelable",
                    message="job already completed",
                    requestId=_new_request_id(),
                    details={"jobId": job_id, "status": record.status},
                ).model_dump(),
            )

        if record.status != "canceled":
            _mark_job_finished(record, "canceled", "job canceled by user")

        return _to_job_status_response(record)


@app.get("/jobs/{job_id}/result", response_model=JobResultResponse)
def get_job_result(job_id: str) -> JobResultResponse:
    with _jobs_lock:
        _cleanup_jobs()
        record = _jobs.get(job_id)
        if not record:
            raise HTTPException(
                status_code=404,
                detail=ApiError(
                    code="job_not_found",
                    message="job not found",
                    requestId=_new_request_id(),
                    details={"jobId": job_id},
                ).model_dump(),
            )
        if record.status == "failed":
            raise HTTPException(
                status_code=409,
                detail=ApiError(
                    code="job_failed",
                    message=record.error or "job failed",
                    requestId=_new_request_id(),
                    details={"jobId": job_id},
                ).model_dump(),
            )
        if record.status == "timeout":
            raise HTTPException(
                status_code=409,
                detail=ApiError(
                    code="job_timeout",
                    message=record.error or "job timeout",
                    requestId=_new_request_id(),
                    details={"jobId": job_id},
                ).model_dump(),
            )
        if record.status == "canceled":
            raise HTTPException(
                status_code=409,
                detail=ApiError(
                    code="job_canceled",
                    message=record.error or "job canceled",
                    requestId=_new_request_id(),
                    details={"jobId": job_id},
                ).model_dump(),
            )
        if record.status != "done" or not record.result:
            raise HTTPException(
                status_code=409,
                detail=ApiError(
                    code="job_not_completed",
                    message="job not completed",
                    requestId=_new_request_id(),
                    details={"jobId": job_id, "status": record.status},
                ).model_dump(),
            )

        result = record.result
        return JobResultResponse(
            jobId=record.jobId,
            objects=result.objects,
            modelVersion=result.modelVersion,
            latencyMs=result.latencyMs,
            requestId=result.requestId,
        )
