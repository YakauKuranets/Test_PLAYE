# PLAYE PhotoLab Backend

This directory contains the cloud backend for the PLAYE PhotoLab project. It
provides a FastAPI server for heavy AI processing tasks such as face
enhancement, image upscaling, denoising, object and face detection. The
backend is designed to run on a GPU‑enabled environment and exposes REST
endpoints consumed by the frontend application.

## Structure

```text
backend/
├── app/
│   ├── __init__.py          # Package initialization
│   ├── main.py              # FastAPI application
│   ├── config.py            # Configuration settings
│   ├── api/                 # API routes
│   │   ├── __init__.py
│   │   └── routes.py        # Placeholder API endpoints
│   ├── models/              # Model wrappers (placeholders)
│   │   ├── __init__.py
│   │   ├── face_enhance.py
│   │   ├── upscale.py
│   │   ├── denoise.py
│   │   ├── detect_faces.py
│   │   └── detect_objects.py
│   ├── queue/               # Celery tasks and worker
│   │   ├── __init__.py
│   │   ├── tasks.py
│   │   └── worker.py
│   └── db/                  # Database models
│       ├── __init__.py
│       └── models.py
├── requirements.txt         # Python dependencies
├── Dockerfile               # Docker build file
└── docker-compose.yml       # Compose file for services
```

At this stage the backend contains only placeholder implementations. Future
tasks will implement the API endpoints, load PyTorch models, configure the
database, and set up Celery workers for asynchronous processing.

## Running locally

To run the backend locally (requires Python 3.10):

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

To run with Docker (requires Docker and NVIDIA container runtime):

```bash
cd backend
docker compose up --build

## Authentication

All protected API endpoints require a valid JWT (JSON Web Token). The
backend uses a simple HMAC‑signed token scheme. The secret used to sign
tokens is defined by the ``JWT_SECRET`` setting (see ``config.py``) and can
be overridden via an environment variable of the same name. Clients must
include the token in the ``Authorization`` header using the ``Bearer``
scheme:

```
Authorization: Bearer <your_token>
```

For testing purposes you can generate a token manually. A minimal token
with no additional claims can be created as follows (replace ``secret``
with your ``JWT_SECRET``):

```
import base64, hmac, hashlib, json

header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b'=')
payload = base64.urlsafe_b64encode(json.dumps({"sub": "test"}).encode()).rstrip(b'=')
signing_input = header + b'.' + payload
secret = b'secret'
signature = hmac.new(secret, signing_input, hashlib.sha256).digest()
token = signing_input.decode() + '.' + base64.urlsafe_b64encode(signature).rstrip(b'=').decode()
print(token)
```

Use the printed token in requests to the backend.

## Docker Images

The ``Dockerfile`` provided in this directory builds a GPU‑enabled image
for the backend. To build and run it locally:

```bash
cd backend
docker build -t playe-photolab-backend .
docker run --gpus all -p 8000:8000 playe-photolab-backend
```

Alternatively, use docker compose which also sets up PostgreSQL and
Redis:

```bash
docker compose up --build
```

## Deployment

In production you should build and push the Docker image to a registry and
run it on a server with an NVIDIA GPU and a GPU‑enabled container runtime.
Update the environment variables in ``docker-compose.yml`` (database
credentials, Redis, JWT secret) accordingly. Secure the service using
HTTPS and configure proper CORS origins.

## Load Testing

To perform a simple load test, you can use tools like ``hey`` or
``locust``. For example, after starting the backend you can run:

```bash
hey -n 100 -c 5 -m POST -H "Authorization: Bearer <token>" \
  -d @sample.png http://localhost:8000/api/ai/face-enhance
```

This will send 100 POST requests with 5 concurrent workers. Adjust the
target endpoint and file as needed. For more sophisticated load tests,
consider writing a ``locustfile.py`` script.
```

## Notes

* In production, update `allow_origins` in CORS middleware and database
  credentials in `docker-compose.yml`.
* Models are downloaded and loaded in later tasks.