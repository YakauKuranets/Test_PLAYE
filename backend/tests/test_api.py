import base64
import io
import time
import unittest

import app as backend_app
from fastapi.testclient import TestClient
from PIL import Image


class BackendApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(backend_app.app)

    def _image_data_url(self):
        image = Image.new("RGB", (64, 64), color=(220, 220, 220))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG")
        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{encoded}"

    def _create_job(self, **overrides):
        payload = {
            "task": "detect-objects",
            "imageBase64": self._image_data_url(),
            "minScore": 0.35,
        }
        payload.update(overrides)
        return self.client.post("/jobs", json=payload)

    def _wait_terminal_status(self, job_id, loops=60):
        status_payload = None
        for _ in range(loops):
            status_response = self.client.get(f"/jobs/{job_id}")
            self.assertEqual(status_response.status_code, 200)
            status_payload = status_response.json()
            if status_payload["status"] in {"done", "failed", "timeout", "canceled"}:
                break
            time.sleep(0.05)
        return status_payload

    def test_health_contract(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertIn("jobsInMemory", payload)
        self.assertIn("idempotencyKeysInMemory", payload)
        self.assertIn("jobRunTimeoutSec", payload)
        self.assertIn("requestId", payload)

    def test_jobs_happy_path(self):
        response = self._create_job()
        self.assertEqual(response.status_code, 200)
        created = response.json()
        job_id = created["jobId"]

        status_payload = self._wait_terminal_status(job_id)
        self.assertIsNotNone(status_payload)
        self.assertEqual(status_payload["status"], "done")

        result_response = self.client.get(f"/jobs/{job_id}/result")
        self.assertEqual(result_response.status_code, 200)
        result = result_response.json()
        self.assertEqual(result["jobId"], job_id)
        self.assertIn("requestId", result)
        self.assertIn("latencyMs", result)

    def test_job_not_completed_contract(self):
        response = self._create_job(debugSleepMs=400)
        self.assertEqual(response.status_code, 200)
        job_id = response.json()["jobId"]

        result_response = self.client.get(f"/jobs/{job_id}/result")
        self.assertEqual(result_response.status_code, 409)
        payload = result_response.json()
        self.assertEqual(payload["code"], "job_not_completed")
        self.assertIn("requestId", payload)

    def test_cancel_job_contract(self):
        response = self._create_job(debugSleepMs=600)
        self.assertEqual(response.status_code, 200)
        job_id = response.json()["jobId"]

        cancel_response = self.client.post(f"/jobs/{job_id}/cancel")
        self.assertEqual(cancel_response.status_code, 200)
        canceled = cancel_response.json()
        self.assertEqual(canceled["status"], "canceled")

        status_response = self.client.get(f"/jobs/{job_id}")
        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.json()["status"], "canceled")

        result_response = self.client.get(f"/jobs/{job_id}/result")
        self.assertEqual(result_response.status_code, 409)
        self.assertEqual(result_response.json()["code"], "job_canceled")

    def test_timeout_contract(self):
        previous_timeout = backend_app.JOB_RUN_TIMEOUT_SECONDS
        backend_app.JOB_RUN_TIMEOUT_SECONDS = 0.01
        try:
            response = self._create_job(debugSleepMs=150)
            self.assertEqual(response.status_code, 200)
            job_id = response.json()["jobId"]

            status_payload = self._wait_terminal_status(job_id, loops=40)
            self.assertIsNotNone(status_payload)
            self.assertEqual(status_payload["status"], "timeout")

            result_response = self.client.get(f"/jobs/{job_id}/result")
            self.assertEqual(result_response.status_code, 409)
            self.assertEqual(result_response.json()["code"], "job_timeout")
        finally:
            backend_app.JOB_RUN_TIMEOUT_SECONDS = previous_timeout

    def test_create_job_idempotency_reuses_existing_job(self):
        first = self._create_job(idempotencyKey="key-123", debugSleepMs=300)
        self.assertEqual(first.status_code, 200)
        first_payload = first.json()

        second = self._create_job(idempotencyKey="key-123", debugSleepMs=300)
        self.assertEqual(second.status_code, 200)
        second_payload = second.json()

        self.assertEqual(first_payload["jobId"], second_payload["jobId"])
        self.assertEqual(first_payload["acceptedAt"], second_payload["acceptedAt"])

    def test_list_jobs_filter_and_pagination(self):
        for index in range(3):
            response = self._create_job(idempotencyKey=f"list-{index}", debugSleepMs=250)
            self.assertEqual(response.status_code, 200)

        page_1 = self.client.get("/jobs", params={"limit": 1})
        self.assertEqual(page_1.status_code, 200)
        payload_1 = page_1.json()
        self.assertEqual(len(payload_1["items"]), 1)
        self.assertIn("requestId", payload_1)
        self.assertIn("nextCursor", payload_1)

        page_2 = self.client.get("/jobs", params={"limit": 1, "cursor": payload_1["nextCursor"]})
        self.assertEqual(page_2.status_code, 200)
        payload_2 = page_2.json()
        self.assertEqual(len(payload_2["items"]), 1)

        self.assertNotEqual(payload_1["items"][0]["jobId"], payload_2["items"][0]["jobId"])

        canceled_job = self._create_job(debugSleepMs=500)
        self.assertEqual(canceled_job.status_code, 200)
        canceled_id = canceled_job.json()["jobId"]
        cancel_response = self.client.post(f"/jobs/{canceled_id}/cancel")
        self.assertEqual(cancel_response.status_code, 200)

        filtered = self.client.get("/jobs", params={"status": "canceled", "limit": 20})
        self.assertEqual(filtered.status_code, 200)
        filtered_payload = filtered.json()
        self.assertGreaterEqual(len(filtered_payload["items"]), 1)
        self.assertTrue(all(item["status"] == "canceled" for item in filtered_payload["items"]))

    def test_list_jobs_invalid_cursor_contract(self):
        response = self.client.get("/jobs", params={"cursor": "not-a-number"})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["code"], "invalid_cursor")
        self.assertIn("requestId", payload)

    def test_job_not_found_error_contract(self):
        response = self.client.get("/jobs/does-not-exist")
        self.assertEqual(response.status_code, 404)
        payload = response.json()
        self.assertEqual(payload["code"], "job_not_found")
        self.assertIn("requestId", payload)
        self.assertIn("message", payload)


if __name__ == "__main__":
    unittest.main()
