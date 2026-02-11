export const createAiBlueprint = () => ({
  name: "ai",
  init: ({ elements, actions, state }) => {
    const overlay = elements.aiOverlay;
    const context = overlay.getContext("2d");
    let faceDetector = null;
    let trackingLoopId = null;
    let trackingActive = false;
    let backendJobsAutoRefreshId = null;
    let detectObjectsInProgress = false;

    const trackingState = {
      nextTrackId: 1,
      tracks: [],
    };

    const sceneState = {
      previousLumaSample: null,
      detections: [],
    };

    const hypothesisState = {
      imageBitmap: null,
      runCount: 0,
    };

    const setHypothesisStatus = (text) => {
      if (!elements.aiHypothesisStatus) return;
      elements.aiHypothesisStatus.textContent = text;
    };

    const clearHypothesisCanvas = (canvas) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const drawBitmapCentered = (canvas, bitmap) => {
      if (!canvas || !bitmap) return;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const ratio = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const targetWidth = Math.max(1, Math.round(bitmap.width * ratio));
      const targetHeight = Math.max(1, Math.round(bitmap.height * ratio));
      const offsetX = Math.floor((canvas.width - targetWidth) / 2);
      const offsetY = Math.floor((canvas.height - targetHeight) / 2);
      ctx.drawImage(bitmap, offsetX, offsetY, targetWidth, targetHeight);
    };

    const drawHypothesisWatermark = (canvas) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 6);
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = "#ffb347";
      ctx.font = "700 26px Inter, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ГИПОТЕЗА", 0, 0);
      ctx.restore();
    };

    const addPixelNoise = (canvas, amount = 8) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * amount;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      }
      ctx.putImageData(frame, 0, 0);
    };

    const renderHypothesisResult = () => {
      const sourceCanvas = elements.aiHypothesisOriginalCanvas;
      const resultCanvas = elements.aiHypothesisResultCanvas;
      if (!sourceCanvas || !resultCanvas) return;
      if (!hypothesisState.imageBitmap) {
        setHypothesisStatus("Гипотеза: сначала загрузите исходное фото.");
        return;
      }

      hypothesisState.runCount += 1;
      const ctx = resultCanvas.getContext("2d");
      ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

      const jitterX = (Math.random() - 0.5) * 8;
      const jitterY = (Math.random() - 0.5) * 8;
      const scale = 1 + Math.random() * 0.05;
      const hue = (Math.random() - 0.5) * 6;

      ctx.save();
      ctx.filter = `contrast(${1.08 + Math.random() * 0.2}) brightness(${1.02 + Math.random() * 0.1}) saturate(${1.04 + Math.random() * 0.12}) hue-rotate(${hue}deg)`;
      ctx.translate(resultCanvas.width / 2 + jitterX, resultCanvas.height / 2 + jitterY);
      ctx.scale(scale, scale);
      ctx.translate(-resultCanvas.width / 2, -resultCanvas.height / 2);
      ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, resultCanvas.width, resultCanvas.height);
      ctx.restore();

      addPixelNoise(resultCanvas, 10);
      drawHypothesisWatermark(resultCanvas);

      setHypothesisStatus(`Гипотеза: сгенерирован снимок #${hypothesisState.runCount}. Если не подошло — нажмите снова.`);
      actions.recordLog("ai-face-hypothesis-generate", "Сгенерирован гипотетический снимок лица", {
        run: hypothesisState.runCount,
        mode: "lazy-hypothesis",
      });
    };

    const resetHypothesisPanel = () => {
      hypothesisState.imageBitmap = null;
      hypothesisState.runCount = 0;
      if (elements.aiHypothesisInput) {
        elements.aiHypothesisInput.value = "";
      }
      clearHypothesisCanvas(elements.aiHypothesisOriginalCanvas);
      clearHypothesisCanvas(elements.aiHypothesisResultCanvas);
      setHypothesisStatus("Гипотеза: загрузите исходное фото.");
    };

    const loadHypothesisSource = async (event) => {
      const file = event?.target?.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setHypothesisStatus("Гипотеза: поддерживаются только изображения.");
        return;
      }

      try {
        const bitmap = await createImageBitmap(file);
        hypothesisState.imageBitmap = bitmap;
        hypothesisState.runCount = 0;
        drawBitmapCentered(elements.aiHypothesisOriginalCanvas, bitmap);
        drawBitmapCentered(elements.aiHypothesisResultCanvas, bitmap);
        drawHypothesisWatermark(elements.aiHypothesisResultCanvas);
        setHypothesisStatus("Гипотеза: исходник загружен. Нажмите «Сгенерировать снимок».");
        actions.recordLog("ai-face-hypothesis-source", "Загружен исходник для гипотезы лица", {
          fileName: file.name,
          width: bitmap.width,
          height: bitmap.height,
        });
      } catch (error) {
        setHypothesisStatus(`Гипотеза: ошибка загрузки (${error?.message || "unknown"}).`);
      }
    };

    const ensureAnalysisCanvas = () => {
      if (!state.aiAnalysisCanvas) {
        state.aiAnalysisCanvas = document.createElement("canvas");
        state.aiAnalysisContext = state.aiAnalysisCanvas.getContext("2d", {
          willReadFrequently: true,
        });
      }
      state.aiAnalysisCanvas.width = elements.video.videoWidth;
      state.aiAnalysisCanvas.height = elements.video.videoHeight;
    };

    const updateOverlaySize = () => {
      if (!elements.video.videoWidth || !elements.video.videoHeight) return;
      overlay.width = elements.video.videoWidth;
      overlay.height = elements.video.videoHeight;
    };

    const clearOverlay = () => {
      context.clearRect(0, 0, overlay.width, overlay.height);
    };

    const setStatus = (text) => {
      elements.aiStatus.textContent = text;
    };

    const setBackendStatus = (text) => {
      if (!elements.aiBackendStatus) return;
      elements.aiBackendStatus.textContent = text;
    };

    const markBackendStatus = (isOnline, details = "") => {
      if (isOnline) {
        setBackendStatus(`Backend: online${details ? ` | ${details}` : ""}`);
      } else {
        setBackendStatus(`Backend: offline${details ? ` | ${details}` : ""}`);
      }
    };

    const setBackendJobStatus = (text) => {
      if (!elements.aiBackendJobStatus) return;
      elements.aiBackendJobStatus.textContent = text;
    };

    const backendJobsView = {
      cursor: null,
      prevCursors: [],
      nextCursor: null,
      filter: "all",
      lastPageSize: 0,
      activeJobId: null,
      idempotencyCache: {},
      payloadByJobId: {},
      resultByJobId: {},
      pendingRetryPayload: null,
    };

    const resolveBackendJobsFilter = () => {
      const value = elements.aiBackendJobsFilter?.value || backendJobsView.filter || "all";
      return value === "all" ? null : value;
    };

    const updateBackendJobDetails = (text) => {
      if (!elements.aiBackendJobsDetail) return;
      elements.aiBackendJobsDetail.textContent = text;
    };

    const setBackendJobsWarning = (text, { ok = false } = {}) => {
      if (!elements.aiBackendJobsWarning) return;
      elements.aiBackendJobsWarning.textContent = `Warning: ${text}`;
      elements.aiBackendJobsWarning.classList.toggle("is-ok", ok);
    };

    const markBackendJobsUpdatedNow = () => {
      if (!elements.aiBackendJobsUpdated) return;
      const now = new Date();
      elements.aiBackendJobsUpdated.textContent = `Last update: ${now.toLocaleTimeString()}`;
    };

    const formatBackendJobDetails = (job, extras = []) => {
      const detail = [
        `Job details: ${job?.jobId || "-"}`,
        `status=${job?.status || "unknown"}`,
        job?.createdAt ? `created=${job.createdAt}` : null,
        job?.startedAt ? `started=${job.startedAt}` : null,
        job?.finishedAt ? `finished=${job.finishedAt}` : null,
        ...extras,
      ].filter(Boolean).join(" | ");
      updateBackendJobDetails(detail);
    };

    const canRetryJob = (status) => ["failed", "timeout", "canceled"].includes(status);

    const renderBackendJobsList = (items = []) => {
      if (!elements.aiBackendJobsList) return;
      elements.aiBackendJobsList.innerHTML = "";
      if (!items.length) {
        const item = document.createElement("li");
        item.textContent = "Backend jobs не найдены для выбранного фильтра.";
        elements.aiBackendJobsList.appendChild(item);
        return;
      }

      items.forEach((job) => {
        const item = document.createElement("li");
        item.className = "backend-job-item";
        if (job?.jobId && job.jobId === backendJobsView.activeJobId) {
          item.classList.add("is-active");
        }

        const status = job?.status || "unknown";
        const header = document.createElement("div");
        header.className = "backend-job-item__header";

        const idNode = document.createElement("span");
        idNode.className = "backend-job-id";
        idNode.textContent = job?.jobId || "-";

        const badge = document.createElement("span");
        badge.className = `backend-job-badge status-${status}`;
        badge.textContent = status;

        header.appendChild(idNode);
        header.appendChild(badge);

        const meta = document.createElement("div");
        meta.className = "backend-job-meta";
        meta.textContent = job?.error ? `error: ${job.error}` : `task: ${job?.task || "detect-objects"}`;

        const actionsRow = document.createElement("div");
        actionsRow.className = "backend-job-actions";

        const detailsButton = document.createElement("button");
        detailsButton.type = "button";
        detailsButton.className = "backend-job-action";
        detailsButton.textContent = "Details";
        detailsButton.addEventListener("click", () => {
          backendJobsView.activeJobId = job?.jobId || null;
          formatBackendJobDetails(job, [job?.error ? `error=${job.error}` : null]);
          refreshBackendJobsPanel({ log: false });
        });
        actionsRow.appendChild(detailsButton);

        if (status === "done") {
          const resultButton = document.createElement("button");
          resultButton.type = "button";
          resultButton.className = "backend-job-action";
          resultButton.textContent = "Open result";
          resultButton.addEventListener("click", () => {
            openBackendJobResult(job);
          });
          actionsRow.appendChild(resultButton);

          const copyJsonButton = document.createElement("button");
          copyJsonButton.type = "button";
          copyJsonButton.className = "backend-job-action";
          copyJsonButton.textContent = "Copy JSON";
          copyJsonButton.addEventListener("click", () => {
            copyBackendJobResultJson(job);
          });
          actionsRow.appendChild(copyJsonButton);
        }

        if (["pending", "running"].includes(status)) {
          const cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.className = "backend-job-action danger";
          cancelButton.textContent = "Cancel";
          cancelButton.addEventListener("click", () => {
            cancelBackendJob(job?.jobId);
          });
          actionsRow.appendChild(cancelButton);
        }

        if (canRetryJob(status)) {
          const retryButton = document.createElement("button");
          retryButton.type = "button";
          retryButton.className = "backend-job-action";
          retryButton.textContent = "Retry";
          retryButton.addEventListener("click", () => {
            retryBackendJob(job);
          });
          actionsRow.appendChild(retryButton);
        }

        item.appendChild(header);
        item.appendChild(meta);
        item.appendChild(actionsRow);
        elements.aiBackendJobsList.appendChild(item);
      });
    };

    const updateBackendJobsPaginationUi = () => {
      if (elements.aiBackendJobsPrevButton) {
        elements.aiBackendJobsPrevButton.disabled = backendJobsView.prevCursors.length === 0;
      }
      if (elements.aiBackendJobsNextButton) {
        elements.aiBackendJobsNextButton.disabled = !backendJobsView.nextCursor;
      }
      if (elements.aiBackendJobsPagination) {
        const pageNumber = backendJobsView.prevCursors.length + 1;
        const filterLabel = resolveBackendJobsFilter() || "all";
        elements.aiBackendJobsPagination.textContent = `Jobs page: ${pageNumber} | filter: ${filterLabel} | items: ${backendJobsView.lastPageSize}`;
      }
      if (elements.aiBackendJobsDetail && !backendJobsView.activeJobId) {
        updateBackendJobDetails("Job details: —");
      }
    };

    const buildBackendIdempotencyKey = () => {
      const caseId = state.caseMeta?.id || elements.caseId?.value || "case-unknown";
      const sourceKey = state.selectedImportedFileKey || state.currentFile?.__playlistKey || state.currentFile?.name || "source-unknown";
      const timeBucket = Math.floor((elements.video?.currentTime || 0) * 2) / 2;
      const requestWindow = Math.floor(Date.now() / 2000);
      return ["detect-objects", caseId, sourceKey, `t${timeBucket.toFixed(1)}`, `w${requestWindow}`].join("|");
    };

    const cancelBackendJob = async (jobId) => {
      if (!jobId) return;
      try {
        const endpointBase = getBackendApiBase();
        const response = await withTimeout(
          fetch(`${endpointBase}/jobs/${jobId}/cancel`, { method: "POST" }),
          6000,
          "Превышен таймаут отмены backend job"
        );
        if (!response.ok) {
          const message = await parseBackendError(response, `Backend job cancel ${response.status}`);
          throw new Error(message);
        }
        const payload = await response.json();
        backendJobsView.activeJobId = jobId;
        setBackendJobStatus(`Backend job ${jobId}: ${payload?.status || "canceled"}`);
        formatBackendJobDetails(payload, ["updated=cancel"]);
        actions.recordLog("ai-backend-job-cancel", "Backend job отменен из jobs monitor", {
          jobId,
          status: payload?.status || "canceled",
        });
        await refreshBackendJobsPanel({ log: true });
      } catch (error) {
        setBackendJobStatus(`Backend job ${jobId}: cancel error (${error?.message || "unknown"})`);
      }
    };

    const openBackendJobResult = async (job) => {
      const jobId = job?.jobId;
      if (!jobId) return;
      const endpointBase = getBackendApiBase();
      try {
        const response = await withTimeout(
          fetch(`${endpointBase}/jobs/${jobId}/result`, { method: "GET" }),
          6000,
          "Превышен таймаут получения backend job result"
        );
        if (!response.ok) {
          const message = await parseBackendError(response, `Backend job result ${response.status}`);
          throw new Error(message);
        }

        const payload = await response.json();
        backendJobsView.resultByJobId[jobId] = payload;
        const sourceMeta = backendJobsView.payloadByJobId[jobId]?.sourceMeta || null;
        const objects = Array.isArray(payload?.objects)
          ? payload.objects.map((item) => ({
              x: Number(item.x || 0),
              y: Number(item.y || 0),
              width: Number(item.width || 0),
              height: Number(item.height || 0),
              label: item.label || "object",
              score: typeof item.score === "number" ? item.score : null,
            }))
          : [];
        updateOverlaySize();
        renderBoxes(objects, "#34d399");
        renderResultList(
          elements.aiObjectList,
          objects.map((box, index) => {
            const size = `${Math.round(box.width)}x${Math.round(box.height)} px`;
            const confidence = typeof box.score === "number" ? ` (${Math.round(box.score * 100)}%)` : "";
            return `Объект ${index + 1}: ${box.label || "object"}${confidence}, ${size}`;
          }),
          "Объекты не найдены."
        );

        backendJobsView.activeJobId = jobId;
        setBackendJobStatus(`Backend job ${jobId}: result loaded`);
        formatBackendJobDetails(job, [
          `objects=${objects.length}`,
          payload?.modelVersion ? `model=${payload.modelVersion}` : null,
          payload?.requestId ? `requestId=${payload.requestId}` : null,
          typeof payload?.latencyMs === "number" ? `latency=${payload.latencyMs}ms` : null,
          sourceMeta?.sourceType ? `sourceType=${sourceMeta.sourceType}` : null,
          typeof sourceMeta?.videoTimeSec === "number" ? `videoTime=${sourceMeta.videoTimeSec}s` : null,
          sourceMeta?.sourceKey ? `sourceKey=${sourceMeta.sourceKey}` : null,
        ]);
        actions.recordLog("ai-backend-job-open-result", "Открыт результат backend job из jobs monitor", {
          jobId,
          objects: objects.length,
          modelVersion: payload?.modelVersion || null,
          latencyMs: payload?.latencyMs || null,
          requestId: payload?.requestId || null,
          sourceMeta,
        });
      } catch (error) {
        setBackendJobStatus(`Backend job ${jobId}: result error (${error?.message || "unknown"})`);
      }
    };

    const copyBackendJobResultJson = async (job) => {
      const jobId = job?.jobId;
      if (!jobId) return;
      const cachedPayload = backendJobsView.resultByJobId[jobId] || null;
      try {
        let payload = cachedPayload;
        if (!payload) {
          const endpointBase = getBackendApiBase();
          const response = await withTimeout(
            fetch(`${endpointBase}/jobs/${jobId}/result`, { method: "GET" }),
            6000,
            "Превышен таймаут получения backend job result"
          );
          if (!response.ok) {
            const message = await parseBackendError(response, `Backend job result ${response.status}`);
            throw new Error(message);
          }
          payload = await response.json();
          backendJobsView.resultByJobId[jobId] = payload;
        }

        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        setBackendJobStatus(`Backend job ${jobId}: result JSON copied`);
      } catch (error) {
        setBackendJobStatus(`Backend job ${jobId}: copy JSON error (${error?.message || "unknown"})`);
      }
    };

    const retryBackendJob = async (job) => {
      const jobId = job?.jobId || "unknown";
      if (detectObjectsInProgress) {
        setBackendJobStatus(`Backend job ${jobId}: retry skipped (дождитесь завершения текущей детекции)`);
        return;
      }
      const snapshotPayload = backendJobsView.payloadByJobId[job?.jobId || ""] || null;
      const hasSnapshot = Boolean(snapshotPayload?.imageBase64);
      backendJobsView.pendingRetryPayload = snapshotPayload;
      backendJobsView.activeJobId = job?.jobId || null;
      formatBackendJobDetails(job, ["retry=scheduled", hasSnapshot ? "source=original-snapshot" : "source=current-frame-fallback"]);
      setBackendJobStatus(`Backend job ${jobId}: retry ${hasSnapshot ? "по исходному snapshot" : "на текущем кадре (fallback)"}...`);
      actions.recordLog("ai-backend-job-retry", "Повтор backend job из jobs monitor", {
        sourceJobId: job?.jobId || null,
        sourceStatus: job?.status || null,
        retryMode: hasSnapshot ? "original-snapshot" : "current-frame-fallback",
      });
      if (state.aiProvider !== "backend") {
        elements.aiProviderSelect.value = "backend";
        applyAiProvider("backend", { log: false });
      }
      await detectObjectsDemo();
    };

    const fetchBackendJobsPage = async ({ cursor = backendJobsView.cursor, pushHistory = false, log = false } = {}) => {
      const endpointBase = getBackendApiBase();
      const params = new URLSearchParams();
      const filter = resolveBackendJobsFilter();
      if (filter) {
        params.set("status", filter);
      }
      params.set("limit", "8");
      if (cursor) {
        params.set("cursor", cursor);
      }

      const url = `${endpointBase}/jobs?${params.toString()}`;
      const response = await withTimeout(
        fetch(url, { method: "GET" }),
        6000,
        "Превышен таймаут получения backend jobs list"
      );

      if (!response.ok) {
        const message = await parseBackendError(response, `Backend jobs list ${response.status}`);
        throw new Error(message);
      }

      const payload = await response.json();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (pushHistory && backendJobsView.cursor !== null) {
        backendJobsView.prevCursors.push(backendJobsView.cursor);
      }
      backendJobsView.cursor = cursor || null;
      backendJobsView.nextCursor = payload?.nextCursor || null;
      backendJobsView.lastPageSize = items.length;
      renderBackendJobsList(items);
      updateBackendJobsPaginationUi();
      markBackendJobsUpdatedNow();
      setBackendJobsWarning("none", { ok: true });
      if (log) {
        actions.recordLog("ai-backend-jobs-list", "Получена страница backend jobs", {
          filter: filter || "all",
          cursor: backendJobsView.cursor,
          nextCursor: backendJobsView.nextCursor,
          items: items.length,
        });
      }
      return payload;
    };

    const refreshBackendJobsPanel = async ({ log = false } = {}) => {
      if (!elements.aiBackendJobsList) return;
      try {
        await fetchBackendJobsPage({ cursor: backendJobsView.cursor, pushHistory: false, log });
      } catch (error) {
        setBackendJobStatus(`Backend jobs: ошибка списка (${error?.message || "unknown"})`);
        updateBackendJobDetails(`Job details: warning | list-refresh-failed | ${error?.message || "unknown"}`);
        setBackendJobsWarning(`list refresh failed | ${error?.message || "unknown"}`);
      }
    };

    const applyAiProvider = (provider, { log = true } = {}) => {
      state.aiProvider = provider;
      state.aiRuntimeInfo = {
        provider,
        modelVersion: runtimeAdapters[provider]?.modelVersion || "unknown",
      };
      setStatus(`AI runtime provider: ${provider}`);
      if (provider === "backend") {
        pingBackendHealth({ log });
        refreshBackendJobsPanel({ log: false });
        if (!backendJobsAutoRefreshId) {
          backendJobsAutoRefreshId = window.setInterval(() => {
            refreshBackendJobsPanel({ log: false });
          }, 5000);
        }
      } else if (backendJobsAutoRefreshId) {
        window.clearInterval(backendJobsAutoRefreshId);
        backendJobsAutoRefreshId = null;
      }
      if (log) {
        actions.recordLog("ai-provider-change", "Изменен AI runtime provider", {
          provider,
          modelVersion: state.aiRuntimeInfo.modelVersion,
        });
      }
    };
    const formatCapabilityStatus = (capabilities) => {
      const parts = [
        `WebGPU: ${capabilities.webgpu ? "yes" : "no"}`,
        `WebGL2: ${capabilities.webgl2 ? "yes" : "no"}`,
        `WebGL: ${capabilities.webgl ? "yes" : "no"}`,
        `FaceDetector: ${capabilities.faceDetector ? "yes" : "no"}`,
        `Fallback: ${capabilities.fallback}`,
      ];
      return `Capability: ${parts.join(" | ")}`;
    };

    const runCapabilityCheck = ({ log = true } = {}) => {
      const canvas = document.createElement("canvas");
      const hasWebGL2 = Boolean(canvas.getContext("webgl2"));
      const hasWebGL = hasWebGL2 || Boolean(canvas.getContext("webgl"));
      const hasWebGPU = Boolean(navigator.gpu);
      const hasFaceDetector = "FaceDetector" in window;
      const fallback = hasWebGPU ? "webgpu" : hasWebGL ? "webgl" : "cpu";

      state.aiCapabilities = {
        checkedAt: new Date().toISOString(),
        webgpu: hasWebGPU,
        webgl2: hasWebGL2,
        webgl: hasWebGL,
        faceDetector: hasFaceDetector,
        fallback,
      };

      if (elements.aiCapabilityStatus) {
        elements.aiCapabilityStatus.textContent = formatCapabilityStatus(state.aiCapabilities);
      }
      setStatus(`AI capability check завершен. Активный fallback: ${fallback.toUpperCase()}`);

      if (log) {
        actions.recordLog("ai-capability-check", "Проверены AI/GPU capability и fallback", {
          ...state.aiCapabilities,
        });
      }

      return state.aiCapabilities;
    };


    const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
      let timerId;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timerId = window.setTimeout(() => {
              reject(new Error(timeoutMessage));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (typeof timerId === "number") {
          window.clearTimeout(timerId);
        }
      }
    };

    const applyAiSuperResolution = () => {
      const factor = Number.parseFloat(elements.aiSrFactor.value) || 2;
      state.aiSuperResolutionFactor = factor;
      state.aiSuperResolutionActive = true;
      actions.updateZoom();
      setStatus(`AI super-resolution (demo) активирован: ${factor}x`);
      actions.recordLog("ai-super-resolution-apply", "AI super-resolution (demo) включен", {
        factor,
      });
    };

    const resetAiSuperResolution = () => {
      const wasActive = state.aiSuperResolutionActive;
      state.aiSuperResolutionActive = false;
      state.aiSuperResolutionFactor = 1;
      actions.updateZoom();
      if (wasActive) {
        setStatus("AI super-resolution (demo) отключен.");
        actions.recordLog("ai-super-resolution-reset", "AI super-resolution (demo) выключен");
      }
    };

    const renderResultList = (listElement, rows, fallbackText) => {
      listElement.innerHTML = "";
      if (!rows.length) {
        const item = document.createElement("li");
        item.textContent = fallbackText;
        listElement.appendChild(item);
        return;
      }
      rows.forEach((row) => {
        const item = document.createElement("li");
        item.textContent = row;
        listElement.appendChild(item);
      });
    };

    const renderBoxes = (boxes, color) => {
      clearOverlay();
      context.strokeStyle = color;
      context.lineWidth = Math.max(2, overlay.width * 0.002);
      boxes.forEach(({ x, y, width, height }) => {
        context.strokeRect(x, y, width, height);
      });
    };

    const renderTracks = () => {
      clearOverlay();
      context.lineWidth = Math.max(2, overlay.width * 0.002);
      context.font = "12px Inter, system-ui, sans-serif";

      trackingState.tracks.forEach((track) => {
        const { box, id, history } = track;
        context.strokeStyle = "#34d399";
        context.strokeRect(box.x, box.y, box.width, box.height);

        context.fillStyle = "rgba(15, 23, 42, 0.8)";
        const label = `ID ${id}`;
        context.fillRect(box.x, Math.max(0, box.y - 16), 48, 14);
        context.fillStyle = "#a7f3d0";
        context.fillText(label, box.x + 6, Math.max(11, box.y - 5));

        if (history.length > 1) {
          context.strokeStyle = "rgba(52, 211, 153, 0.5)";
          context.beginPath();
          history.forEach((point, index) => {
            if (index === 0) {
              context.moveTo(point.x, point.y);
            } else {
              context.lineTo(point.x, point.y);
            }
          });
          context.stroke();
        }
      });
    };

    const ensureFaceDetector = () => {
      if (!("FaceDetector" in window)) {
        setStatus("FaceDetector не поддерживается в этом браузере.");
        actions.recordLog("ai-face-unsupported", "FaceDetector API недоступен");
        return null;
      }
      if (!faceDetector) {
        faceDetector = new FaceDetector({
          fastMode: true,
          maxDetectedFaces: 10,
        });
      }
      return faceDetector;
    };

    const detectObjectsFromFrame = () => {
      if (elements.video.readyState < 2) {
        return [];
      }

      updateOverlaySize();
      ensureAnalysisCanvas();
      const width = state.aiAnalysisCanvas.width;
      const height = state.aiAnalysisCanvas.height;
      if (!width || !height) return [];

      state.aiAnalysisContext.drawImage(elements.video, 0, 0, width, height);
      const frame = state.aiAnalysisContext.getImageData(0, 0, width, height);
      const data = frame.data;

      const cellSize = 24;
      const cols = Math.max(1, Math.floor(width / cellSize));
      const rows = Math.max(1, Math.floor(height / cellSize));
      const scores = new Array(cols * rows).fill(0);

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          let score = 0;
          let samples = 0;
          const startX = col * cellSize;
          const startY = row * cellSize;
          const endX = Math.min(width - 2, startX + cellSize - 1);
          const endY = Math.min(height - 2, startY + cellSize - 1);

          for (let y = startY; y < endY; y += 3) {
            for (let x = startX; x < endX; x += 3) {
              const idx = (y * width + x) * 4;
              const rightIdx = (y * width + (x + 1)) * 4;
              const downIdx = ((y + 1) * width + x) * 4;

              const lum =
                data[idx] * 0.2126 +
                data[idx + 1] * 0.7152 +
                data[idx + 2] * 0.0722;
              const lumRight =
                data[rightIdx] * 0.2126 +
                data[rightIdx + 1] * 0.7152 +
                data[rightIdx + 2] * 0.0722;
              const lumDown =
                data[downIdx] * 0.2126 +
                data[downIdx + 1] * 0.7152 +
                data[downIdx + 2] * 0.0722;

              score += Math.abs(lum - lumRight) + Math.abs(lum - lumDown);
              samples += 1;
            }
          }

          const normalized = samples ? score / samples : 0;
          scores[row * cols + col] = normalized;
        }
      }

      const threshold = 28;
      const visited = new Set();
      const clusters = [];
      const neighbors = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];

      const visitCluster = (startCol, startRow) => {
        const queue = [[startCol, startRow]];
        let queueIndex = 0;
        let minCol = startCol;
        let maxCol = startCol;
        let minRow = startRow;
        let maxRow = startRow;
        let points = 0;

        while (queueIndex < queue.length) {
          const [col, row] = queue[queueIndex];
          queueIndex += 1;
          const key = `${col}:${row}`;
          if (visited.has(key)) continue;
          visited.add(key);
          const idx = row * cols + col;
          if (scores[idx] < threshold) continue;

          points += 1;
          minCol = Math.min(minCol, col);
          maxCol = Math.max(maxCol, col);
          minRow = Math.min(minRow, row);
          maxRow = Math.max(maxRow, row);

          neighbors.forEach(([dx, dy]) => {
            const nextCol = col + dx;
            const nextRow = row + dy;
            if (
              nextCol >= 0 &&
              nextCol < cols &&
              nextRow >= 0 &&
              nextRow < rows &&
              !visited.has(`${nextCol}:${nextRow}`)
            ) {
              queue.push([nextCol, nextRow]);
            }
          });
        }

        if (points < 4) return null;
        return {
          x: minCol * cellSize,
          y: minRow * cellSize,
          width: Math.min(width - minCol * cellSize, (maxCol - minCol + 1) * cellSize),
          height: Math.min(height - minRow * cellSize, (maxRow - minRow + 1) * cellSize),
          points,
        };
      };

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const idx = row * cols + col;
          if (scores[idx] < threshold || visited.has(`${col}:${row}`)) continue;
          const cluster = visitCluster(col, row);
          if (cluster && cluster.width * cluster.height > 3200) {
            clusters.push(cluster);
          }
        }
      }

      return clusters
        .sort((a, b) => b.points - a.points)
        .slice(0, 8)
        .map(({ x, y, width: boxWidth, height: boxHeight }) => ({
          x,
          y,
          width: boxWidth,
          height: boxHeight,
        }));
    };

    const maybeCreateObjectMarker = (count, source) => {
      if (!elements.aiObjectMarkerToggle.checked) return;
      const time = elements.video.currentTime;
      const entry = {
        timestamp: new Date().toISOString(),
        time,
        timecode: actions.formatTime(time),
        type: "AI: объекты",
        note: `${source}: найдено объектов ${count}`,
      };
      state.markers.unshift(entry);
      actions.appendMarkerEntry(entry);
      actions.recordLog("ai-object-marker", `Добавлен маркер объектов: ${entry.timecode}`, {
        count,
        source,
      });
      if (actions.refreshTimeline) {
        actions.refreshTimeline();
      }
    };

    const refreshSceneList = () => {
      renderResultList(
        elements.aiSceneList,
        sceneState.detections.map((scene, index) =>
          `Сцена ${index + 1}: ${scene.timecode} | Δ ${scene.delta.toFixed(1)}`
        ),
        "Авто‑сцены не обнаружены."
      );
    };

    const runAutoSceneDelta = () => {
      if (elements.video.readyState < 2) {
        return { error: "Видео не готово для авто‑сцен." };
      }
      ensureAnalysisCanvas();
      const width = state.aiAnalysisCanvas.width;
      const height = state.aiAnalysisCanvas.height;
      if (!width || !height) {
        return { error: "Не удалось инициализировать кадр анализа." };
      }

      state.aiAnalysisContext.drawImage(elements.video, 0, 0, width, height);
      const frame = state.aiAnalysisContext.getImageData(0, 0, width, height);
      const data = frame.data;

      let sum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 16) {
        const lum = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sum += lum;
        count += 1;
      }

      const averageLuma = count ? sum / count : 0;
      const threshold = Number.parseFloat(elements.aiSceneThreshold.value) || 28;
      return {
        averageLuma,
        threshold,
      };
    };

    const runFaceDetectorDemo = async () => {
      if (elements.video.readyState < 2) {
        return { error: "Видео не готово для анализа." };
      }

      const activeDetector = ensureFaceDetector();
      if (!activeDetector) {
        return { error: "FaceDetector API недоступен" };
      }

      const faces = await activeDetector.detect(elements.video);
      const boxes = faces.map((face) => face.boundingBox);
      return {
        faces,
        boxes,
      };
    };

    const getBackendApiBase = () => {
      const fromInput = elements.aiBackendUrlInput?.value?.trim();
      if (fromInput) {
        return fromInput.replace(/\/$/, "");
      }
      const saved = localStorage.getItem("aiBackendUrl");
      if (saved && saved.trim()) {
        return saved.trim().replace(/\/$/, "");
      }
      const explicit = window.__AI_BACKEND_URL;
      if (typeof explicit === "string" && explicit.trim()) {
        return explicit.trim().replace(/\/$/, "");
      }
      return "http://127.0.0.1:8000";
    };

    const persistBackendApiBase = () => {
      if (!elements.aiBackendUrlInput) return;
      const value = elements.aiBackendUrlInput.value.trim();
      if (!value) {
        localStorage.removeItem("aiBackendUrl");
        return;
      }
      localStorage.setItem("aiBackendUrl", value.replace(/\/$/, ""));
    };

    const canvasToJpegDataUrl = (canvas, quality = 0.85) =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Не удалось получить blob из кадра"));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Не удалось прочитать blob кадра"));
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          quality
        );
      });

    const parseBackendError = async (response, fallbackPrefix) => {
      try {
        const payload = await response.json();
        const code = payload?.code || "backend_error";
        const message = payload?.message || fallbackPrefix;
        return `${fallbackPrefix} [${code}]: ${message}`;
      } catch (_error) {
        const text = await response.text();
        return `${fallbackPrefix}: ${text.slice(0, 160)}`;
      }
    };

    const pingBackendHealth = async ({ log = false } = {}) => {
      const endpointBase = getBackendApiBase();
      const endpoint = `${endpointBase}/health`;
      try {
        const response = await withTimeout(
          fetch(endpoint, { method: "GET" }),
          4000,
          "Превышен таймаут проверки backend /health"
        );
        if (!response.ok) {
          markBackendStatus(false, `HTTP ${response.status}`);
          if (log) {
            actions.recordLog("ai-backend-health", "Backend health-check завершился ошибкой", {
              endpoint,
              status: response.status,
            });
          }
          return false;
        }
        const payload = await response.json();
        markBackendStatus(true, payload.service || "ok");
        if (log) {
          actions.recordLog("ai-backend-health", "Backend health-check OK", {
            endpoint,
            service: payload.service,
            version: payload.version,
          });
        }
        return true;
      } catch (error) {
        markBackendStatus(false, error?.message || "network error");
        if (log) {
          actions.recordLog("ai-backend-health", "Backend health-check недоступен", {
            endpoint,
            message: error?.message || "unknown",
          });
        }
        return false;
      }
    };

    const createRuntimeAdapters = () => {
      const mockAdapter = {
        id: "mock",
        modelVersion: "demo-mock-1.0.0",
        detectFaces: async () => runFaceDetectorDemo(),
        detectObjects: async () => ({ objects: detectObjectsFromFrame() }),
        detectScenes: async () => runAutoSceneDelta(),
      };

      let tfObjectModel = null;
      let tfObjectModelPromise = null;

      const loadTfObjectModel = async () => {
        if (tfObjectModel) return tfObjectModel;
        if (tfObjectModelPromise) return tfObjectModelPromise;

        actions.recordLog("ai-model-load-start", "Начата загрузка модели coco-ssd", {
          provider: "tfjs",
          model: "coco-ssd",
          variant: "lite_mobilenet_v2",
        });
        setStatus("TFJS: загрузка модели coco-ssd...");

        tfObjectModelPromise = (async () => {
          try {
            await withTimeout(
              import("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.esm.min.js"),
              15000,
              "Превышен таймаут загрузки TensorFlow.js"
            );
            const cocoSsd = await withTimeout(
              import("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.esm.js"),
              15000,
              "Превышен таймаут загрузки coco-ssd"
            );
            tfObjectModel = await withTimeout(
              cocoSsd.load({ base: "lite_mobilenet_v2" }),
              20000,
              "Превышен таймаут инициализации модели coco-ssd"
            );
            actions.recordLog("ai-model-load-ok", "Модель coco-ssd загружена", {
              provider: "tfjs",
              model: "coco-ssd",
              variant: "lite_mobilenet_v2",
            });
            setStatus("TFJS: модель coco-ssd готова.");
            return tfObjectModel;
          } catch (error) {
            tfObjectModelPromise = null;
            actions.recordLog("ai-model-load-fail", "Ошибка загрузки модели coco-ssd", {
              provider: "tfjs",
              model: "coco-ssd",
              message: error?.message || "unknown",
            });
            setStatus("TFJS: не удалось загрузить модель, включён fallback на mock.");
            throw error;
          }
        })();

        return tfObjectModelPromise;
      };

      const tfjsAdapter = {
        id: "tfjs",
        modelVersion: "coco-ssd-2.2.3",
        detectFaces: async () => {
          const result = await mockAdapter.detectFaces();
          return {
            ...result,
            provider: "tfjs",
            emulated: true,
            note: "Для лиц используется demo fallback. Реальная модель подключена для detectObjects.",
          };
        },
        detectObjects: async () => {
          if (elements.video.readyState < 2) {
            return {
              objects: [],
              modelVersion: "coco-ssd-2.2.3",
            };
          }

          const model = await loadTfObjectModel();
          const detections = await withTimeout(
            model.detect(elements.video),
            8000,
            "Превышен таймаут выполнения detectObjects"
          );
          const objects = detections.map((detection) => {
            const [x, y, width, height] = detection.bbox;
            return {
              x,
              y,
              width,
              height,
              label: detection.class,
              score: detection.score,
            };
          });

          return {
            objects,
            modelVersion: "coco-ssd-2.2.3",
          };
        },
        detectScenes: async () => {
          const result = await mockAdapter.detectScenes();
          return {
            ...result,
            provider: "tfjs",
            emulated: true,
            note: "Для авто-сцен используется demo fallback.",
          };
        },
      };

      let onnxObjectDetector = null;
      let onnxObjectDetectorPromise = null;

      const loadOnnxObjectDetector = async () => {
        if (onnxObjectDetector) return onnxObjectDetector;
        if (onnxObjectDetectorPromise) return onnxObjectDetectorPromise;

        actions.recordLog("ai-model-load-start", "Начата загрузка ONNX DETR модели", {
          provider: "onnx",
          model: "Xenova/detr-resnet-50",
        });
        setStatus("ONNX: загрузка DETR модели...");

        onnxObjectDetectorPromise = (async () => {
          try {
            const transformers = await withTimeout(
              import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2"),
              20000,
              "Превышен таймаут загрузки transformers.js"
            );
            const { pipeline, env } = transformers;
            env.allowLocalModels = false;
            env.useBrowserCache = true;

            onnxObjectDetector = await withTimeout(
              pipeline("object-detection", "Xenova/detr-resnet-50"),
              35000,
              "Превышен таймаут инициализации ONNX DETR модели"
            );
            actions.recordLog("ai-model-load-ok", "ONNX DETR модель загружена", {
              provider: "onnx",
              model: "Xenova/detr-resnet-50",
            });
            setStatus("ONNX: DETR модель готова.");
            return onnxObjectDetector;
          } catch (error) {
            onnxObjectDetectorPromise = null;
            actions.recordLog("ai-model-load-fail", "Ошибка загрузки ONNX DETR модели", {
              provider: "onnx",
              model: "Xenova/detr-resnet-50",
              message: error?.message || "unknown",
            });
            setStatus("ONNX: не удалось загрузить модель, включён fallback на mock.");
            throw error;
          }
        })();

        return onnxObjectDetectorPromise;
      };

      const onnxAdapter = {
        id: "onnx",
        modelVersion: "Xenova/detr-resnet-50",
        detectFaces: async () => {
          const result = await mockAdapter.detectFaces();
          return {
            ...result,
            provider: "onnx",
            emulated: true,
            note: "Для лиц используется demo fallback. Реальная ONNX модель подключена для detectObjects.",
          };
        },
        detectObjects: async () => {
          if (elements.video.readyState < 2) {
            return {
              objects: [],
              modelVersion: "Xenova/detr-resnet-50",
            };
          }

          ensureAnalysisCanvas();
          state.aiAnalysisContext.drawImage(
            elements.video,
            0,
            0,
            state.aiAnalysisCanvas.width,
            state.aiAnalysisCanvas.height
          );

          const detector = await loadOnnxObjectDetector();
          const detections = await withTimeout(
            detector(state.aiAnalysisCanvas, { threshold: 0.35 }),
            12000,
            "Превышен таймаут ONNX detectObjects"
          );

          const objects = detections.map((detection) => {
            const box = detection.box || {};
            const x = Number(box.xmin ?? 0);
            const y = Number(box.ymin ?? 0);
            const xmax = Number(box.xmax ?? x);
            const ymax = Number(box.ymax ?? y);
            return {
              x,
              y,
              width: Math.max(0, xmax - x),
              height: Math.max(0, ymax - y),
              label: detection.label || "object",
              score: typeof detection.score === "number" ? detection.score : null,
            };
          });

          return {
            objects,
            modelVersion: "Xenova/detr-resnet-50",
          };
        },
        detectScenes: async () => {
          const result = await mockAdapter.detectScenes();
          return {
            ...result,
            provider: "onnx",
            emulated: true,
            note: "Для авто-сцен используется demo fallback.",
          };
        },
      };

      const backendAdapter = {
        id: "backend",
        modelVersion: "backend-mvp-1.0.0",
        detectFaces: async () => {
          const result = await mockAdapter.detectFaces();
          return {
            ...result,
            provider: "backend",
            emulated: true,
            note: "Для лиц backend-MVP пока использует demo fallback.",
          };
        },
        detectObjects: async () => {
          if (elements.video.readyState < 2) {
            setBackendJobStatus("Backend job: видео не готово.");
            return {
              objects: [],
              modelVersion: "backend-mvp-1.0.0",
            };
          }

          const retryPayload = backendJobsView.pendingRetryPayload;
          const useSnapshotRetry = Boolean(retryPayload?.imageBase64);

          let imageBase64 = "";
          let minScore = 0.35;
          let sourceMeta = null;
          if (useSnapshotRetry) {
            imageBase64 = retryPayload.imageBase64;
            minScore = typeof retryPayload.minScore === "number" ? retryPayload.minScore : 0.35;
            sourceMeta = retryPayload.sourceMeta || null;
            setStatus("Backend: retry с исходным snapshot задачи...");
            setBackendJobStatus("Backend job: retry/create...");
          } else {
            ensureAnalysisCanvas();
            state.aiAnalysisContext.drawImage(
              elements.video,
              0,
              0,
              state.aiAnalysisCanvas.width,
              state.aiAnalysisCanvas.height
            );
            imageBase64 = await canvasToJpegDataUrl(state.aiAnalysisCanvas, 0.82);
            setStatus("Backend: постановка задачи в очередь...");
            setBackendJobStatus("Backend job: создание...");
          }

          const endpointBase = getBackendApiBase();
          const jobsEndpoint = `${endpointBase}/jobs`;
          const idempotencyKey = useSnapshotRetry
            ? [retryPayload.idempotencyKey || buildBackendIdempotencyKey(), "retry", Date.now()].join("|")
            : buildBackendIdempotencyKey();
          const createBody = {
            task: "detect-objects",
            imageBase64,
            minScore,
            idempotencyKey,
          };
          const createResponse = await withTimeout(
            fetch(jobsEndpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(createBody),
            }),
            10000,
            "Превышен таймаут обращения к backend /jobs"
          );
          backendJobsView.pendingRetryPayload = null;

          if (!createResponse.ok) {
            setBackendJobStatus(`Backend job: ошибка create (${createResponse.status})`);
            const message = await parseBackendError(createResponse, `Backend job create ${createResponse.status}`);
            throw new Error(message);
          }

          const jobCreate = await createResponse.json();
          const jobId = jobCreate.jobId;
          if (!jobId) {
            setBackendJobStatus("Backend job: backend не вернул jobId");
            throw new Error("Backend не вернул jobId");
          }

          const previousForKey = backendJobsView.idempotencyCache[idempotencyKey] || null;
          const reusedByKey = Boolean(previousForKey && previousForKey === jobId);
          const reusedByStatus = jobCreate.status && jobCreate.status !== "pending";
          const reusedJob = reusedByKey || reusedByStatus;
          backendJobsView.idempotencyCache[idempotencyKey] = jobId;
          backendJobsView.activeJobId = jobId;
          backendJobsView.payloadByJobId[jobId] = {
            idempotencyKey,
            imageBase64,
            minScore,
            sourceMeta: sourceMeta || {
              caseId: state.caseMeta?.id || elements.caseId?.value || null,
              sourceKey: state.selectedImportedFileKey || state.currentFile?.__playlistKey || state.currentFile?.name || null,
              videoTimeSec: Number((elements.video?.currentTime || 0).toFixed(3)),
              capturedAt: new Date().toISOString(),
              sourceType: useSnapshotRetry ? "retry-snapshot" : "live-frame",
            },
          };

          actions.recordLog("ai-backend-job-create", "Создан backend job для детекции объектов", {
            endpoint: jobsEndpoint,
            jobId,
            idempotencyKey,
            reusedJob,
            sourceType: useSnapshotRetry ? "retry-snapshot" : "live-frame",
          });
          if (reusedJob) {
            setBackendJobStatus(`Backend job ${jobId}: reused (${jobCreate.status || "pending"})`);
            updateBackendJobDetails(`Job details: ${jobId} | reused by idempotencyKey | status=${jobCreate.status || "pending"}`);
          } else {
            setBackendJobStatus(`Backend job ${jobId}: ${jobCreate.status || "pending"}`);
            updateBackendJobDetails(`Job details: ${jobId} | created | idempotency=${idempotencyKey}`);
          }
          refreshBackendJobsPanel({ log: false });

          const pollDeadline = Date.now() + 30000;
          let statusPayload = null;
          let waitMs = 250;
          while (Date.now() < pollDeadline) {
            const statusResponse = await withTimeout(
              fetch(`${endpointBase}/jobs/${jobId}`, { method: "GET" }),
              5000,
              "Превышен таймаут проверки backend job status"
            );
            if (!statusResponse.ok) {
              setBackendJobStatus(`Backend job ${jobId}: ошибка status (${statusResponse.status})`);
              const message = await parseBackendError(statusResponse, `Backend job status ${statusResponse.status}`);
              throw new Error(message);
            }
            statusPayload = await statusResponse.json();

            if (statusPayload.status === "done") {
              break;
            }
            if (statusPayload.status === "failed") {
              setBackendJobStatus(`Backend job ${jobId}: failed`);
              throw new Error(statusPayload.error || "Backend job завершился ошибкой");
            }
            if (statusPayload.status === "timeout") {
              setBackendJobStatus(`Backend job ${jobId}: timeout`);
              throw new Error("Backend job завершился со статусом timeout");
            }
            if (statusPayload.status === "canceled") {
              setBackendJobStatus(`Backend job ${jobId}: canceled`);
              throw new Error("Backend job был отменен");
            }

            setStatus(`Backend job ${jobId}: ${statusPayload.status}`);
            setBackendJobStatus(`Backend job ${jobId}: ${statusPayload.status}`);
            await new Promise((resolve) => window.setTimeout(resolve, waitMs));
            waitMs = Math.min(1200, waitMs + 150);
          }

          if (!statusPayload || statusPayload.status !== "done") {
            setBackendJobStatus(`Backend job ${jobId}: timeout`);
            throw new Error("Превышен таймаут ожидания результата backend job");
          }

          const resultResponse = await withTimeout(
            fetch(`${endpointBase}/jobs/${jobId}/result`, { method: "GET" }),
            6000,
            "Превышен таймаут получения backend job result"
          );

          if (!resultResponse.ok) {
            setBackendJobStatus(`Backend job ${jobId}: ошибка result (${resultResponse.status})`);
            const message = await parseBackendError(resultResponse, `Backend job result ${resultResponse.status}`);
            throw new Error(message);
          }

          const payload = await resultResponse.json();
          if (typeof payload.latencyMs === "number") {
            markBackendStatus(true, `job ${jobId} | ${payload.latencyMs}ms`);
            setBackendJobStatus(`Backend job ${jobId}: done | ${payload.latencyMs}ms`);
          } else {
            markBackendStatus(true, `job ${jobId} done`);
            setBackendJobStatus(`Backend job ${jobId}: done`);
          }
          const objects = Array.isArray(payload.objects)
            ? payload.objects.map((item) => ({
                x: Number(item.x || 0),
                y: Number(item.y || 0),
                width: Number(item.width || 0),
                height: Number(item.height || 0),
                label: item.label || "object",
                score: typeof item.score === "number" ? item.score : null,
              }))
            : [];

          backendJobsView.resultByJobId[jobId] = payload;
          refreshBackendJobsPanel({ log: false });
          backendJobsView.activeJobId = jobId;

          return {
            objects,
            modelVersion: payload.modelVersion || "backend-mvp-1.0.0",
            backend: {
              endpoint: jobsEndpoint,
              latencyMs: payload.latencyMs,
              requestId: payload.requestId || null,
              jobId,
              idempotencyKey,
            },
          };
        },
        detectScenes: async () => {
          const result = await mockAdapter.detectScenes();
          return {
            ...result,
            provider: "backend",
            emulated: true,
            note: "Для авто-сцен backend-MVP пока использует demo fallback.",
          };
        },
      };

      const createProxyAdapter = (id) => ({
        id,
        modelVersion: `${id}-proxy-1.0.0`,
        detectFaces: async () => {
          const result = await mockAdapter.detectFaces();
          return {
            ...result,
            provider: id,
            emulated: true,
          };
        },
        detectObjects: async () => {
          const result = await mockAdapter.detectObjects();
          return {
            ...result,
            provider: id,
            emulated: true,
          };
        },
        detectScenes: async () => {
          const result = await mockAdapter.detectScenes();
          return {
            ...result,
            provider: id,
            emulated: true,
          };
        },
      });

      return {
        mock: mockAdapter,
        tfjs: tfjsAdapter,
        onnx: onnxAdapter,
        backend: backendAdapter,
        torch: createProxyAdapter("torch"),
      };
    };

    const runtimeAdapters = createRuntimeAdapters();

    const runModelInference = async (task, payload = {}) => {
      const provider = state.aiProvider || "mock";
      const adapter = runtimeAdapters[provider] || runtimeAdapters.mock;
      const method = adapter[task];
      if (typeof method !== "function") {
        const fallback = runtimeAdapters.mock[task];
        const fallbackResult =
          typeof fallback === "function" ? await fallback(payload) : { error: "Метод адаптера недоступен" };
        actions.recordLog("ai-adapter-fallback", "Fallback к mock adapter для AI задачи", {
          provider,
          task,
        });
        return {
          ...fallbackResult,
          provider: "mock",
          fallback: true,
        };
      }
      try {
        const result = await method(payload);
        return {
          ...result,
          provider,
          modelVersion: result?.modelVersion || adapter.modelVersion || "unknown",
        };
      } catch (error) {
        const fallback = runtimeAdapters.mock[task];
        const fallbackResult =
          typeof fallback === "function" ? await fallback(payload) : { error: "Ошибка AI adapter и fallback недоступен" };
        actions.recordLog("ai-adapter-error", "Ошибка в AI adapter, выполнен fallback к mock", {
          provider,
          task,
          message: error?.message || "unknown",
        });
        return {
          ...fallbackResult,
          provider: "mock",
          fallback: true,
          fallbackReason: "adapter-error",
        };
      }
    };

    const runMockInferencePipeline = async (task, payload = {}) => {
      const startedAt = performance.now();
      const context = {
        task,
        payload,
        provider: state.aiProvider || "mock",
      };

      const preprocessed = {
        ...context,
        preparedAt: new Date().toISOString(),
      };

      const inferenceResult = await runModelInference(task, preprocessed.payload);

      const durationMs = Number((performance.now() - startedAt).toFixed(2));
      const result = {
        ...inferenceResult,
        pipeline: {
          preprocessed: true,
          postprocessed: true,
          durationMs,
          task,
          provider: inferenceResult.provider || context.provider,
          latencyMs: inferenceResult?.backend?.latencyMs || null,
          requestId: inferenceResult?.backend?.requestId || null,
          jobId: inferenceResult?.backend?.jobId || null,
        },
      };

      actions.recordLog("ai-mock-pipeline-run", "Выполнен mock‑pipeline инференса", {
        task,
        provider: result.pipeline.provider,
        modelVersion: result.modelVersion,
        durationMs,
        hasError: Boolean(result.error),
      });

      return result;
    };

    const detectAutoScenes = async () => {
      const { averageLuma, threshold, provider, emulated, pipeline, error } =
        await runMockInferencePipeline("detectScenes");
      if (error) {
        setStatus(error);
        return;
      }

      if (sceneState.previousLumaSample === null) {
        sceneState.previousLumaSample = averageLuma;
        setStatus("Авто‑сцены: базовый кадр зафиксирован.");
        actions.recordLog("ai-auto-scenes-baseline", "Авто‑сцены: базовый кадр зафиксирован", {
          luma: averageLuma,
        });
        return;
      }

      const delta = Math.abs(averageLuma - sceneState.previousLumaSample);
      sceneState.previousLumaSample = averageLuma;
      if (delta < threshold) {
        setStatus(`Авто‑сцены: переход не найден (Δ ${delta.toFixed(1)}).`);
        return;
      }

      const time = elements.video.currentTime;
      const sceneEntry = {
        timestamp: new Date().toISOString(),
        time,
        timecode: actions.formatTime(time),
        delta,
      };
      sceneState.detections.unshift(sceneEntry);
      sceneState.detections = sceneState.detections.slice(0, 25);
      refreshSceneList();

      const marker = {
        timestamp: sceneEntry.timestamp,
        time: sceneEntry.time,
        timecode: sceneEntry.timecode,
        type: "AI: сцена",
        note: `Авто‑сцена (Δ ${delta.toFixed(1)})`,
      };
      state.markers.unshift(marker);
      actions.appendMarkerEntry(marker);
      if (actions.refreshTimeline) {
        actions.refreshTimeline();
      }

      actions.recordLog("ai-auto-scenes-detect", "Обнаружен авто‑переход сцены (demo)", {
        delta,
        threshold,
        provider,
        emulated,
        pipeline: {
          durationMs: pipeline?.durationMs,
        },
        timecode: sceneEntry.timecode,
      });
      setStatus(`Авто‑сцена обнаружена: ${sceneEntry.timecode}`);
    };

    const clearAutoScenes = () => {
      sceneState.previousLumaSample = null;
      sceneState.detections = [];
      refreshSceneList();
      setStatus("Авто‑сцены очищены.");
      actions.recordLog("ai-auto-scenes-clear", "Список авто‑сцен очищен");
    };

    const detectFaces = async () => {
      setStatus("Идёт поиск лиц...");
      try {
        const { faces, boxes, provider, emulated, pipeline, error } = await runMockInferencePipeline("detectFaces");
        if (error) {
          setStatus(error);
          return;
        }
        updateOverlaySize();
        renderBoxes(boxes, "#38bdf8");

        renderResultList(
          elements.aiFaceList,
          faces.map((face, index) => {
            const box = face.boundingBox;
            return `Лицо ${index + 1}: ${Math.round(box.width)}x${Math.round(
              box.height
            )} px`;
          }),
          "Лица не найдены."
        );

        setStatus(`Найдено лиц: ${faces.length}`);
        actions.recordLog("ai-face-detect", "Демо детекция лиц", {
          count: faces.length,
          provider,
          emulated,
          pipeline: {
            durationMs: pipeline?.durationMs,
          },
        });

        if (elements.aiFaceMarkerToggle.checked) {
          const time = elements.video.currentTime;
          const entry = {
            timestamp: new Date().toISOString(),
            time,
            timecode: actions.formatTime(time),
            type: "AI: лица",
            note: `Найдено лиц: ${faces.length}`,
          };
          state.markers.unshift(entry);
          actions.appendMarkerEntry(entry);
          actions.recordLog("ai-face-marker", `Добавлен маркер лиц: ${entry.timecode}`, {
            count: faces.length,
          });
          if (actions.refreshTimeline) {
            actions.refreshTimeline();
          }
        }
      } catch (error) {
        setStatus("Ошибка анализа лиц.");
        actions.recordLog("ai-face-error", "Ошибка демо-анализа лиц", {
          message: error?.message,
        });
      }
    };

    const DETECT_OBJECTS_TIMEOUT_MS = 45000;

    const detectObjectsDemo = async () => {
      if (detectObjectsInProgress) {
        setStatus("AI детекция уже выполняется, дождитесь завершения текущего запроса.");
        return;
      }

      detectObjectsInProgress = true;
      if (elements.aiObjectDetectButton) {
        elements.aiObjectDetectButton.disabled = true;
      }
      try {
        const { objects = [], provider, emulated, pipeline, error, fallback } = await withTimeout(
          runMockInferencePipeline("detectObjects"),
          DETECT_OBJECTS_TIMEOUT_MS,
          "Превышен общий таймаут AI детекции объектов"
        );
        if (error) {
          setStatus(`AI ошибка: ${error}`);
          return;
        }
        if (fallback) {
          setStatus("AI adapter недоступен, использован fallback mock.");
        }
        if (!objects.length && elements.video.readyState < 2) {
          setStatus("Видео не готово для анализа.");
          return;
        }

        renderBoxes(objects, "#34d399");
        renderResultList(
          elements.aiObjectList,
          objects.map((box, index) => {
            const size = `${Math.round(box.width)}x${Math.round(box.height)} px`;
            if (box.label) {
              const confidence = typeof box.score === "number" ? ` (${Math.round(box.score * 100)}%)` : "";
              return `Объект ${index + 1}: ${box.label}${confidence}, ${size}`;
            }
            return `Объект ${index + 1}: ${size}`;
          }),
          "Объекты не найдены."
        );

        setStatus(`Найдено объектов (${emulated ? "demo" : provider}): ${objects.length}`);
        actions.recordLog("ai-object-detect", emulated ? "Демо детекция объектов" : "AI детекция объектов", {
          count: objects.length,
          provider,
          emulated,
          backend: {
            endpoint: window.__AI_BACKEND_URL || getBackendApiBase(),
            requestId: pipeline?.requestId || null,
            jobId: pipeline?.jobId || null,
            latencyMs: pipeline?.latencyMs || null,
          },
          pipeline: {
            durationMs: pipeline?.durationMs,
          },
        });
        maybeCreateObjectMarker(objects.length, "single-detect");
      } catch (error) {
        setStatus(`AI детекция прервана: ${error?.message || "unknown"}`);
        setBackendJobStatus(`Backend job: detect error (${error?.message || "unknown"})`);
        actions.recordLog("ai-object-detect-error", "Ошибка AI детекции объектов", {
          message: error?.message || "unknown",
          provider: state.aiProvider || "mock",
        });
      } finally {
        detectObjectsInProgress = false;
        backendJobsView.pendingRetryPayload = null;
        if (elements.aiObjectDetectButton) {
          elements.aiObjectDetectButton.disabled = false;
        }
      }
    };

    const boxCenter = (box) => ({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });

    const distance = (a, b) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const updateTracking = (detections) => {
      const maxDistance = 90;
      const matchedTrackIds = new Set();
      const matchedDetectionIds = new Set();
      const newTrackIds = [];

      detections.forEach((detection, detectionIndex) => {
        const detectionCenter = boxCenter(detection);
        let bestTrack = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        trackingState.tracks.forEach((track) => {
          if (matchedTrackIds.has(track.id)) return;
          const trackCenter = boxCenter(track.box);
          const dist = distance(detectionCenter, trackCenter);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestTrack = track;
          }
        });

        if (bestTrack && bestDistance <= maxDistance) {
          bestTrack.box = detection;
          bestTrack.lastSeenTime = elements.video.currentTime;
          bestTrack.missed = 0;
          bestTrack.history.push(detectionCenter);
          bestTrack.history = bestTrack.history.slice(-12);
          matchedTrackIds.add(bestTrack.id);
          matchedDetectionIds.add(detectionIndex);
          return;
        }

        const newTrack = {
          id: trackingState.nextTrackId,
          box: detection,
          missed: 0,
          lastSeenTime: elements.video.currentTime,
          history: [detectionCenter],
        };
        trackingState.nextTrackId += 1;
        trackingState.tracks.push(newTrack);
        matchedTrackIds.add(newTrack.id);
        matchedDetectionIds.add(detectionIndex);
        newTrackIds.push(newTrack.id);
      });

      trackingState.tracks = trackingState.tracks
        .map((track) => {
          if (matchedTrackIds.has(track.id)) return track;
          return {
            ...track,
            missed: track.missed + 1,
          };
        })
        .filter((track) => track.missed <= 8);

      return newTrackIds;
    };

    const refreshTrackList = () => {
      renderResultList(
        elements.aiObjectList,
        trackingState.tracks.map((track) => {
          const { id, box, lastSeenTime } = track;
          return `Track #${id}: ${Math.round(box.width)}x${Math.round(
            box.height
          )} px @ ${actions.formatTime(lastSeenTime)}`;
        }),
        "Треки не обнаружены."
      );
    };

    const stopObjectTracking = (reason = "manual") => {
      trackingActive = false;
      if (trackingLoopId) {
        cancelAnimationFrame(trackingLoopId);
      }
      trackingLoopId = null;
      elements.aiTrackStartButton.disabled = false;
      elements.aiTrackStopButton.disabled = true;
      actions.recordLog("ai-object-track-stop", "Трекинг объектов остановлен (demo)", {
        reason,
      });
    };

    const trackFrame = () => {
      if (!trackingActive) return;
      if (elements.video.ended) {
        stopObjectTracking("video-ended");
        setStatus("Трекинг остановлен: видео завершено.");
        return;
      }

      if (!elements.video.paused && elements.video.readyState >= 2) {
        const detections = detectObjectsFromFrame();
        const newTrackIds = updateTracking(detections);
        refreshTrackList();
        renderTracks();
        setStatus(`Трекинг объектов (demo): активных треков ${trackingState.tracks.length}`);

        if (newTrackIds.length > 0) {
          actions.recordLog("ai-object-track-update", "Созданы новые треки объектов", {
            newTrackIds,
            activeTracks: trackingState.tracks.length,
          });
          maybeCreateObjectMarker(trackingState.tracks.length, "tracking-new-tracks");
        }
      }

      trackingLoopId = requestAnimationFrame(trackFrame);
    };

    const startObjectTracking = () => {
      if (trackingActive) return;
      if (elements.video.readyState < 2) {
        setStatus("Видео не готово для трекинга.");
        return;
      }

      trackingState.tracks = [];
      trackingState.nextTrackId = 1;
      elements.aiTrackStartButton.disabled = true;
      elements.aiTrackStopButton.disabled = false;
      setStatus("Трекинг объектов запущен (demo).");
      actions.recordLog("ai-object-track-start", "Трекинг объектов запущен (demo)");

      trackingActive = true;
      trackFrame();
    };

    elements.aiFaceDetectButton.addEventListener("click", () => {
      detectFaces();
    });

    elements.aiObjectDetectButton.addEventListener("click", () => {
      detectObjectsDemo();
    });

    elements.aiProviderSelect.addEventListener("change", () => {
      applyAiProvider(elements.aiProviderSelect.value);
    });

    elements.aiCapabilityCheckButton.addEventListener("click", () => {
      runCapabilityCheck();
    });

    if (elements.aiBackendCheckButton) {
      elements.aiBackendCheckButton.addEventListener("click", () => {
        persistBackendApiBase();
        pingBackendHealth({ log: true });
      });
    }

    if (elements.aiBackendUrlInput) {
      elements.aiBackendUrlInput.addEventListener("change", () => {
        persistBackendApiBase();
        backendJobsView.cursor = null;
        backendJobsView.prevCursors = [];
        backendJobsView.nextCursor = null;
        backendJobsView.activeJobId = null;
        if (state.aiProvider === "backend") {
          pingBackendHealth({ log: true });
          refreshBackendJobsPanel({ log: true });
        }
      });
    }

    if (elements.aiBackendJobsFilter) {
      elements.aiBackendJobsFilter.addEventListener("change", () => {
        backendJobsView.filter = elements.aiBackendJobsFilter.value || "all";
        backendJobsView.cursor = null;
        backendJobsView.prevCursors = [];
        backendJobsView.nextCursor = null;
        backendJobsView.activeJobId = null;
        refreshBackendJobsPanel({ log: true });
      });
    }

    if (elements.aiBackendJobsRefreshButton) {
      elements.aiBackendJobsRefreshButton.addEventListener("click", () => {
        refreshBackendJobsPanel({ log: true });
      });
    }

    if (elements.aiBackendJobsPrevButton) {
      elements.aiBackendJobsPrevButton.addEventListener("click", () => {
        if (!backendJobsView.prevCursors.length) return;
        const prevCursor = backendJobsView.prevCursors.pop() || null;
        fetchBackendJobsPage({ cursor: prevCursor, pushHistory: false, log: true }).catch((error) => {
          setBackendJobStatus(`Backend jobs: ошибка prev (${error?.message || "unknown"})`);
          setBackendJobsWarning(`prev page failed | ${error?.message || "unknown"}`);
        });
      });
    }

    if (elements.aiBackendJobsNextButton) {
      elements.aiBackendJobsNextButton.addEventListener("click", () => {
        if (!backendJobsView.nextCursor) return;
        fetchBackendJobsPage({ cursor: backendJobsView.nextCursor, pushHistory: true, log: true }).catch((error) => {
          setBackendJobStatus(`Backend jobs: ошибка next (${error?.message || "unknown"})`);
          setBackendJobsWarning(`next page failed | ${error?.message || "unknown"}`);
        });
      });
    }

    if (elements.aiHypothesisInput) {
      elements.aiHypothesisInput.addEventListener("change", (event) => {
        loadHypothesisSource(event);
      });
    }

    if (elements.aiHypothesisGenerateButton) {
      elements.aiHypothesisGenerateButton.addEventListener("click", () => {
        renderHypothesisResult();
      });
    }

    if (elements.aiHypothesisResetButton) {
      elements.aiHypothesisResetButton.addEventListener("click", () => {
        resetHypothesisPanel();
      });
    }

    elements.aiTrackStartButton.addEventListener("click", () => {
      startObjectTracking();
    });

    elements.aiTrackStopButton.addEventListener("click", () => {
      stopObjectTracking("manual");
      setStatus("Трекинг объектов остановлен.");
    });

    elements.aiSrApplyButton.addEventListener("click", () => {
      applyAiSuperResolution();
    });

    elements.aiSrResetButton.addEventListener("click", () => {
      resetAiSuperResolution();
    });

    elements.aiSrFactor.addEventListener("change", () => {
      const factor = Number.parseFloat(elements.aiSrFactor.value) || 2;
      actions.recordLog("ai-super-resolution-factor", "Изменен AI SR фактор (demo)", {
        factor,
      });
      if (state.aiSuperResolutionActive) {
        state.aiSuperResolutionFactor = factor;
        actions.updateZoom();
        setStatus(`AI super-resolution (demo) обновлён: ${factor}x`);
      }
    });

    elements.aiScenesDetectButton.addEventListener("click", () => {
      detectAutoScenes();
    });

    elements.aiScenesClearButton.addEventListener("click", () => {
      clearAutoScenes();
    });

    elements.aiSceneThreshold.addEventListener("change", () => {
      const threshold = Number.parseFloat(elements.aiSceneThreshold.value) || 28;
      actions.recordLog("ai-auto-scenes-threshold", "Изменен порог авто‑сцен (demo)", {
        threshold,
      });
    });

    elements.video.addEventListener("pause", () => {
      if (trackingActive) {
        setStatus("Трекинг на паузе (ожидание воспроизведения).");
      }
    });

    elements.video.addEventListener("loadedmetadata", () => {
      updateOverlaySize();
      clearOverlay();
      trackingState.tracks = [];
      sceneState.previousLumaSample = null;
      sceneState.detections = [];
      refreshTrackList();
      refreshSceneList();
      renderResultList(elements.aiFaceList, [], "Лица не найдены.");
    });

    if (elements.aiBackendUrlInput) {
      elements.aiBackendUrlInput.value = getBackendApiBase();
    }
    if (elements.aiBackendJobsFilter) {
      elements.aiBackendJobsFilter.value = "all";
      backendJobsView.filter = "all";
    }
    setBackendStatus("Backend: не проверен.");
    setBackendJobStatus("Backend job: нет активной задачи.");
    updateBackendJobDetails("Job details: —");
    if (elements.aiBackendJobsUpdated) {
      elements.aiBackendJobsUpdated.textContent = "Last update: —";
    }
    setBackendJobsWarning("none", { ok: true });
    renderBackendJobsList([]);
    updateBackendJobsPaginationUi();
    elements.aiProviderSelect.value = state.aiProvider || "mock";
    applyAiProvider(elements.aiProviderSelect.value, { log: false });
    refreshBackendJobsPanel({ log: false });
    runCapabilityCheck({ log: false });

    renderResultList(elements.aiFaceList, [], "Лица не найдены.");
    renderResultList(elements.aiObjectList, [], "Объекты не найдены.");
    refreshSceneList();
    elements.aiSrFactor.value = "2";
    elements.aiSceneThreshold.value = "28";
    resetHypothesisPanel();

    const observer = new ResizeObserver(() => {
      updateOverlaySize();
      if (trackingState.tracks.length) {
        renderTracks();
      }
    });
    observer.observe(elements.viewerSurface);

    window.addEventListener("beforeunload", () => {
      if (backendJobsAutoRefreshId) {
        window.clearInterval(backendJobsAutoRefreshId);
        backendJobsAutoRefreshId = null;
      }
    });
  },
});
