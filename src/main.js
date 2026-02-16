import { Orchestrator } from "./orchestrator.js";
import { formatTime, toHex, hashFileStream } from "./utils.js";
import { createPlaylistBlueprint } from "./blueprints/playlist.js";
import { createPlayerBlueprint } from "./blueprints/player.js";
import { createScreenshotBlueprint } from "./blueprints/screenshot.js";
import { createClipBlueprint } from "./blueprints/clip.js";
import { createQualityBlueprint } from "./blueprints/quality.js";
import { createMotionBlueprint } from "./blueprints/motion.js";
import { createForensicBlueprint } from "./blueprints/forensic.js";
import { createTimelineBlueprint } from "./blueprints/timeline.js";
import { createAiBlueprint } from "./blueprints/ai.js";
import { createHypothesisBlueprint } from "./blueprints/hypothesis.js";
import { createCompareBlueprint } from "./blueprints/compare.js";
import { createPhotoBlueprint } from "./blueprints/photo.js";
import { create3DReconstructionBlueprint } from "./blueprints/reconstruction3d.js";
// Import SmartRouter instance for hybrid mode management
import { smartRouter } from "./router.js";
// Registry functions for AI models (Stage 2)
import {
  getAllTasks as getModelTasks,
  checkModelAvailability as checkModelAvailabilityOffline,
  MODEL_REGISTRY,
} from "./models/registry.js";
import { detectCapabilities } from "./utils/capabilities.js";
import { syncCases, updateModels, seedRemote } from "./utils/sync.js";
// Import cloud storage for remote case synchronisation (Stage 4)
import { cloudStorage } from "./api/cloudStorage.js";
// Import mock backend functions for Stage 3.  These simulate a cloud
// backend processing queue with asynchronous tasks.
import {
  submitTask,
  pollTask,
  cancelTask,
  getAllTasks,
} from "./backend/mockBackend.js";

// Import model downloader utilities (New stage: model loading & updates)
import {
  getAvailableModels,
  isModelDownloaded,
  downloadModel,
  formatBytes,
  checkModelUpdates,
} from "./utils/modelDownloader.js";

const elements = {
  appRoot: document.getElementById("app-root"),
  compactToggle: document.getElementById("compact-toggle"),
  fileInput: document.getElementById("file-input"),
  playlist: document.getElementById("playlist"),
  video: document.getElementById("video"),
  viewerSurface: document.getElementById("viewer-surface"),
  speedInput: document.getElementById("speed"),
  speedValue: document.getElementById("speed-value"),
  frameBack: document.getElementById("frame-back"),
  frameForward: document.getElementById("frame-forward"),
  screenshotButton: document.getElementById("screenshot"),
  captureCanvas: document.getElementById("capture"),
  markInButton: document.getElementById("mark-in"),
  markOutButton: document.getElementById("mark-out"),
  clipInValue: document.getElementById("clip-in"),
  clipOutValue: document.getElementById("clip-out"),
  exportClipButton: document.getElementById("export-clip"),
  enhanceInput: document.getElementById("enhance"),
  exposureInput: document.getElementById("exposure"),
  temperatureInput: document.getElementById("temperature"),
  denoiseInput: document.getElementById("denoise"),
  temporalDenoiseToggle: document.getElementById("temporal-denoise"),
  temporalWindowInput: document.getElementById("temporal-window"),
  denoiseProfile: document.getElementById("denoise-profile"),
  clarityInput: document.getElementById("clarity"),
  sharpnessInput: document.getElementById("sharpness"),
  lowlightBoostToggle: document.getElementById("lowlight-boost"),
  upscaleToggle: document.getElementById("upscale"),
  upscaleFactor: document.getElementById("upscale-factor"),
  grayscaleToggle: document.getElementById("grayscale"),
  bypassFiltersToggle: document.getElementById("bypass-filters"),
  resetFiltersButton: document.getElementById("reset-filters"),
  stabilizationToggle: document.getElementById("stabilization-toggle"),
  stabilizationAutoToggle: document.getElementById("stabilization-auto-toggle"),
  stabilizationStrength: document.getElementById("stabilization-strength"),
  stabilizationSmoothing: document.getElementById("stabilization-smoothing"),
  stabilizationOffsetX: document.getElementById("stabilization-offset-x"),
  stabilizationOffsetY: document.getElementById("stabilization-offset-y"),
  stabilizationProfileLight: document.getElementById("stabilization-profile-light"),
  stabilizationProfileMedium: document.getElementById("stabilization-profile-medium"),
  stabilizationProfileStrong: document.getElementById("stabilization-profile-strong"),
  presetLowlightButton: document.getElementById("preset-lowlight"),
  presetNightButton: document.getElementById("preset-night"),
  presetDetailButton: document.getElementById("preset-detail"),
  presetUltraLowlightButton: document.getElementById("preset-ultra-lowlight"),
  motionStart: document.getElementById("motion-start"),
  motionStop: document.getElementById("motion-stop"),
  motionIndicator: document.getElementById("motion-indicator"),
  motionMarkerToggle: document.getElementById("motion-marker-toggle"),
  motionSensitivity: document.getElementById("motion-sensitivity"),
  motionSensitivityValue: document.getElementById("motion-sensitivity-value"),
  motionCooldown: document.getElementById("motion-cooldown"),
  motionCooldownValue: document.getElementById("motion-cooldown-value"),
  temporalPreview: document.getElementById("temporal-preview"),
  aiOverlay: document.getElementById("ai-overlay"),
  aiFaceDetectButton: document.getElementById("ai-face-detect"),
  aiObjectDetectButton: document.getElementById("ai-object-detect"),
  aiProviderSelect: document.getElementById("ai-provider-select"),
  aiCapabilityCheckButton: document.getElementById("ai-capability-check"),
  aiCapabilityStatus: document.getElementById("ai-capability-status"),
  aiTrackStartButton: document.getElementById("ai-track-start"),
  aiTrackStopButton: document.getElementById("ai-track-stop"),
  aiSrFactor: document.getElementById("ai-sr-factor"),
  aiSrApplyButton: document.getElementById("ai-sr-apply"),
  aiSrResetButton: document.getElementById("ai-sr-reset"),
  aiSceneThreshold: document.getElementById("ai-scene-threshold"),
  aiScenesDetectButton: document.getElementById("ai-scenes-detect"),
  aiScenesClearButton: document.getElementById("ai-scenes-clear"),
  aiFaceMarkerToggle: document.getElementById("ai-face-marker-toggle"),
  aiObjectMarkerToggle: document.getElementById("ai-object-marker-toggle"),
  aiStatus: document.getElementById("ai-status"),
  aiFaceList: document.getElementById("ai-face-list"),
  aiObjectList: document.getElementById("ai-object-list"),
  aiSceneList: document.getElementById("ai-scene-list"),
  timeline: document.getElementById("timeline"),
  timelineMarkers: document.getElementById("timeline-markers"),
  timelineCurrent: document.getElementById("timeline-current"),
  timelineDuration: document.getElementById("timeline-duration"),
  timelineZoomIn: document.getElementById("timeline-zoom-in"),
  timelineZoomOut: document.getElementById("timeline-zoom-out"),
  timelineZoomValue: document.getElementById("timeline-zoom-value"),
  caseId: document.getElementById("case-id"),
  caseOwner: document.getElementById("case-owner"),
  caseStatus: document.getElementById("case-status"),
  caseTags: document.getElementById("case-tags"),
  caseSummary: document.getElementById("case-summary"),
  logEntryButton: document.getElementById("log-entry"),
  exportLogButton: document.getElementById("export-log"),
  exportReportButton: document.getElementById("export-report"),
  previewReportButton: document.getElementById("preview-report"),
  exportFfmpegJobButton: document.getElementById("export-ffmpeg-job"),
  downloadFfmpegJobButton: document.getElementById("download-ffmpeg-job"),
  queueFfmpegJobButton: document.getElementById("queue-ffmpeg-job"),
  ffmpegJobPreview: document.getElementById("ffmpeg-job-preview"),
  pipelineStatus: document.getElementById("pipeline-status"),
  pipelineProgress: document.getElementById("pipeline-progress"),
  pipelineProgressLabel: document.getElementById("pipeline-progress-label"),
  pipelineQueue: document.getElementById("pipeline-queue"),
  pipelineErrors: document.getElementById("pipeline-errors"),
  logList: document.getElementById("log-list"),
  caseLibrary: document.getElementById("case-library"),
  caseSearch: document.getElementById("case-search"),
  caseClearSearchButton: document.getElementById("case-clear-search"),
  caseCount: document.getElementById("case-count"),
  caseFilesCount: document.getElementById("case-files-count"),
  caseMarkersCount: document.getElementById("case-markers-count"),
  caseLogsCount: document.getElementById("case-logs-count"),
  caseSaveButton: document.getElementById("case-save"),
  caseLoadButton: document.getElementById("case-load"),
  caseDeleteButton: document.getElementById("case-delete"),
  caseExportLibraryButton: document.getElementById("case-export-library"),
  caseImportLibraryButton: document.getElementById("case-import-library"),
  caseImportInput: document.getElementById("case-import-input"),
  addMarkerButton: document.getElementById("add-marker"),
  exportMarkersButton: document.getElementById("export-markers"),
  markerList: document.getElementById("marker-list"),
  markerType: document.getElementById("marker-type"),
  markerNote: document.getElementById("marker-note"),
  // Hypothesis generation controls (stub)
  hypothesisType: document.getElementById("hypothesis-type"),
  hypothesisLength: document.getElementById("hypothesis-length"),
  hypothesisGenerate: document.getElementById("hypothesis-generate"),
  hypothesisStatus: document.getElementById("hypothesis-status"),
  hypothesisProgress: document.getElementById("hypothesis-progress"),
  // Comparison controls
  compareFileA: document.getElementById("compare-file-a"),
  compareFileB: document.getElementById("compare-file-b"),
  compareStart: document.getElementById("compare-start"),
  compareContainer: document.getElementById("compare-container"),
  compareVideoA: document.getElementById("compare-video-a"),
  compareVideoB: document.getElementById("compare-video-b"),
  // Start overlay and photo reconstruction overlay
  startOverlay: document.getElementById("start-overlay"),
  photoOverlay: document.getElementById("photo-overlay"),
  photoInput: document.getElementById("photo-input"),
  photoStart: document.getElementById("photo-start"),
  photoBack: document.getElementById("photo-back"),
  // Photo reconstruction export/import controls
  photoExport: document.getElementById("photo-export"),
  photoImportBtn: document.getElementById("photo-import-btn"),
  photoImportInput: document.getElementById("photo-import-input"),
  photoCanvas: document.getElementById("photo-canvas"),
  photoStatus: document.getElementById("photo-status"),
  // 3D reconstruction controls (Stage 5)
  start3D: document.getElementById("start-3d"),
  recon3dOverlay: document.getElementById("recon3d-overlay"),
  recon3dInput: document.getElementById("recon3d-input"),
  recon3dExport: document.getElementById("recon3d-export"),
  recon3d3dPreview: document.getElementById("recon3d-3d-preview"),
  recon3dBack: document.getElementById("recon3d-back"),
  recon3dCanvas: document.getElementById("recon3d-canvas"),
  recon3dView3d: document.getElementById("recon3d-view3d"),
  recon3dStatus: document.getElementById("recon3d-status"),
  // Online/offline indicator for hybrid mode
  modeIndicator: document.getElementById("mode-indicator"),
  // Backend task queue controls (Stage 3)
  backendDemoTask: document.getElementById("backend-demo-task"),
  backendTaskList: document.getElementById("backend-task-list"),
  // Synchronisation controls (Stage 4)
  syncCasesBtn: document.getElementById("sync-cases-btn"),
  updateModelsBtn: document.getElementById("update-models-btn"),
  syncStatus: document.getElementById("sync-status"),

  // Stage 2 offline AI enhancement controls
  aiFaceEnhanceButton: document.getElementById('ai-face-enhance'),
  aiUpscale2xButton: document.getElementById('ai-upscale-2x'),
  aiDenoiseButton: document.getElementById('ai-denoise'),
  aiResultCanvas: document.getElementById('ai-result-canvas'),
  aiModelStatus: document.getElementById('ai-model-status'),

  // Mode selector and backend settings (Stage 1)
  modeSelector: document.getElementById('mode-selector'),
  backendUrlInput: document.getElementById('backend-url'),
  testBackendButton: document.getElementById('test-backend'),
  backendStatus: document.getElementById('backend-status'),
  backendSettings: document.getElementById('backend-settings'),

  // Model loading progress (Stage 1.7)
  modelProgressContainer: document.getElementById('model-progress-container'),
  modelProgressBar: document.getElementById('model-progress-bar'),

  // Model availability status list (Stage 2.9)
  modelStatusList: document.getElementById('model-status-list'),
};

// ---------------------------------------------------------------------------
// Model availability updater (Stage 2.9)
//
// Populate the model availability list in the sidebar.  For each task defined
// in the model registry, this function checks whether the offline version of
// the model is available (i.e. the ONNX file can be fetched).  It then
// creates a list item with a coloured indicator and a label.  The
// availability check is asynchronous because it performs a HEAD request.
async function updateModelAvailability() {
  const listEl = elements.modelStatusList;
  if (!listEl) return;
  listEl.innerHTML = '';
  try {
    const tasks = getModelTasks();
    for (const task of tasks) {
      let available = false;
      try {
        // Check availability of the offline model version.  If the function
        // throws (e.g. network error), treat as unavailable.
        available = await checkModelAvailabilityOffline(task, 'offline');
      } catch (err) {
        available = false;
      }
      const li = document.createElement('li');
      const indicator = document.createElement('span');
      indicator.classList.add('status-indicator');
      indicator.classList.add(available ? 'available' : 'unavailable');
      const label = document.createElement('span');
      label.textContent = `${task} (${available ? 'доступна' : 'нет'})`;
      li.appendChild(indicator);
      li.appendChild(label);
      listEl.appendChild(li);
    }
  } catch (err) {
    console.warn('[ModelAvailability] Failed to update model list', err);
  }
}

// ---------------------------------------------------------------------------
// Model loading progress helper (Stage 1.7)
//
// Expose a global function for updating the model loading progress bar.  The
// loader module will call window.updateModelProgress(percent) with a value
// between 0 and 1 while downloading a model. When percent reaches 1 the
// progress bar is hidden automatically. If this function is not defined the
// progress will be ignored.
if (typeof window !== 'undefined') {
  window.updateModelProgress = (percent) => {
    const container = elements.modelProgressContainer;
    const bar = elements.modelProgressBar;
    if (!container || !bar) return;
    // Clamp value between 0 and 1
    const p = Math.max(0, Math.min(1, percent || 0));
    if (p >= 1) {
      bar.style.width = '100%';
      // Hide the container shortly after completion
      setTimeout(() => {
        container.classList.add('hidden');
        bar.style.width = '0%';
      }, 500);
    } else {
      container.classList.remove('hidden');
      bar.style.width = (p * 100).toFixed(0) + '%';
    }
  };
}

// -------------------------------------------------------------
// NOTE: Security context check
// Many browser APIs used in this application (captureStream,
// MediaRecorder, FaceDetector, etc.) only work in secure contexts
// (i.e. pages served over HTTPS or from localhost). When running
// the prototype from the filesystem (file://) the APIs may be
// disabled silently. Display a warning to the user so they know
// to launch the project via a local web server (e.g. `python3 -m http.server`).
if (typeof window !== 'undefined' && !window.isSecureContext) {
  console.warn(
    'Несекурный контекст: некоторые функции (захват видео, экспорт нарезки, FaceDetector) могут быть недоступны. ' +
      'Запустите приложение через локальный сервер или HTTPS.'
  );
  // Use a timeout so the alert does not block initialisation of other modules.
  setTimeout(() => {
    alert(
      'Внимание! Вы открыли приложение через file://, что не считается безопасным контекстом. ' +
        'Некоторые функции (захват видео, MediaRecorder, FaceDetector) могут не работать. ' +
        'Рекомендуется запустить простейший HTTP‑сервер, например:\npython3 -m http.server 8000'
    );
  }, 0);
}

const state = {
  zoomLevel: 1,
  clipIn: null,
  clipOut: null,
  motionDetectionActive: false,
  motionCanvas: null,
  motionContext: null,
  previousFrameData: null,
  motionLoopId: null,
  motionLastMarkerTime: null,
  stabilizationCanvas: null,
  stabilizationContext: null,
  stabilizationPrevFrame: null,
  stabilizationLoopId: null,
  stabilizationAutoOffset: { x: 0, y: 0 },
  temporalFrames: [],
  aiSuperResolutionFactor: 1,
  aiSuperResolutionActive: false,
  aiProvider: "mock",
  aiRuntimeInfo: {
    provider: "mock",
    modelVersion: "demo-mock-1.0.0",
  },
  aiCapabilities: null,
  timelineZoom: 1,
  timelineWindow: { start: 0, end: 0, duration: 0 },
  logEntries: [],
  markers: [],
  importedFiles: [],
  caseLibrary: [],
  caseMeta: {
    status: "active",
    tags: [],
    summary: "",
  },
  pipelineJobs: [],
  pipelineNextJobId: 1,
  pipelineProcessing: false,
  pipelineErrors: [],
  pipelineMaxRetries: 2,
  selectedImportedFileKey: null,
};

const createLogItem = ({ timestamp, caseId, owner, action, message }) => {
  const item = document.createElement("li");
  item.textContent = `${timestamp} | ${caseId || "Без ID"} | ${
    owner || "Не указан"
  } | ${action} | ${message}`;
  return item;
};

const createMarkerItem = ({ timestamp, timecode, note, type }) => {
  const item = document.createElement("li");
  item.textContent = `${timestamp} | ${timecode} | ${type} | ${note}`;
  return item;
};

const createPipelineItem = (job) => {
  const item = document.createElement("li");
  const details = [
    `job-${job.id}`,
    `status: ${job.status}`,
    `stage: ${job.stage}`,
    `source: ${job.hasSource ? "yes" : "no"}`,
    `progress: ${job.progress ?? 0}%`,
  ];
  if (job.error) {
    details.push(`error: ${job.error}`);
  }
  item.textContent = details.join(" | ");
  return item;
};

const createPipelineErrorItem = (entry) => {
  const item = document.createElement("li");
  item.textContent = `${entry.timestamp} | job-${entry.jobId} | attempt ${entry.attempt} | ${entry.error}`;
  return item;
};

const actions = {
  formatTime,
  updateSpeed: () => {
    const speed = Number.parseFloat(elements.speedInput.value);
    elements.video.playbackRate = speed;
    elements.speedValue.textContent = `${speed.toFixed(2)}x`;
  },
  updateZoom: () => {
    const upscaleFactor = elements.upscaleToggle.checked
      ? Number.parseFloat(elements.upscaleFactor.value) || 2
      : 1;
    const stabilizationStrength = Number.parseFloat(
      elements.stabilizationStrength.value
    );
    const stabilizationFactor = elements.stabilizationToggle.checked
      ? 1 + stabilizationStrength / 100
      : 1;
    const offsetX = Number.parseFloat(elements.stabilizationOffsetX.value);
    const offsetY = Number.parseFloat(elements.stabilizationOffsetY.value);
    const aiSrFactor = state.aiSuperResolutionActive
      ? state.aiSuperResolutionFactor || 1
      : 1;
    const scale = state.zoomLevel * upscaleFactor * stabilizationFactor * aiSrFactor;
    elements.video.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  },
  resetZoom: () => {
    state.zoomLevel = 1;
    actions.updateZoom();
  },
  buildFfmpegJobDraft: (stage = "3.1.2") => {
    const now = new Date().toISOString();
    const toNumber = (value, fallback = 0) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const selectedFile = state.importedFiles.find((file) => file.key === state.selectedImportedFileKey)
      || state.importedFiles[0]
      || null;
    const tags = elements.caseTags.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    return {
      schema: "forensic.ffmpeg-job.v1",
      stage,
      createdAt: now,
      case: {
        id: elements.caseId.value.trim() || null,
        owner: elements.caseOwner.value.trim() || null,
        status: elements.caseStatus.value,
        tags,
      },
      source: selectedFile
        ? {
            name: selectedFile.name,
            type: selectedFile.type || null,
            size: selectedFile.size || null,
            sha256: selectedFile.hash || null,
          }
        : null,
      playback: {
        speed: toNumber(elements.speedInput.value, 1),
        clipIn: state.clipIn,
        clipOut: state.clipOut,
      },
      processing: {
        enhance: toNumber(elements.enhanceInput.value),
        exposure: toNumber(elements.exposureInput.value),
        temperature: toNumber(elements.temperatureInput.value),
        denoise: toNumber(elements.denoiseInput.value),
        denoiseProfile: elements.denoiseProfile.value,
        temporalDenoise: {
          enabled: elements.temporalDenoiseToggle.checked,
          window: toNumber(elements.temporalWindowInput.value, 2),
        },
        clarity: toNumber(elements.clarityInput.value),
        sharpness: toNumber(elements.sharpnessInput.value),
        lowlightBoost: elements.lowlightBoostToggle.checked,
        grayscale: elements.grayscaleToggle.checked,
        bypassFilters: elements.bypassFiltersToggle.checked,
        upscale: {
          enabled: elements.upscaleToggle.checked,
          factor: toNumber(elements.upscaleFactor.value, 1),
        },
        stabilization: {
          enabled: elements.stabilizationToggle.checked,
          auto: elements.stabilizationAutoToggle.checked,
          strength: toNumber(elements.stabilizationStrength.value),
          smoothing: toNumber(elements.stabilizationSmoothing.value),
          offsetX: toNumber(elements.stabilizationOffsetX.value),
          offsetY: toNumber(elements.stabilizationOffsetY.value),
        },
      },
      ai: {
        provider: state.aiProvider || elements.aiProviderSelect.value || "mock",
        modelVersion: state.aiRuntimeInfo?.modelVersion || "unknown",
        capabilities: state.aiCapabilities,
        faceMarkerAuto: elements.aiFaceMarkerToggle.checked,
        objectMarkerAuto: elements.aiObjectMarkerToggle.checked,
        superResolution: {
          enabled: state.aiSuperResolutionActive,
          factor: state.aiSuperResolutionFactor || 1,
        },
        sceneThreshold: toNumber(elements.aiSceneThreshold.value, 15),
      },
      timeline: {
        zoom: state.timelineZoom,
        markers: state.markers.length,
      },
      audit: {
        entries: state.logEntries.length,
      },
    };
  },
  downloadJson: (payload, namePrefix) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${namePrefix}-${Date.now()}.json`;
    link.click();
  },
  recordLog: (action, message, meta = {}, context = {}) => {
    const tagsSource = Array.isArray(context.tags)
      ? context.tags
      : elements.caseTags.value
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
    const entry = {
      timestamp: new Date().toISOString(),
      caseId: context.caseId ?? elements.caseId.value.trim(),
      owner: context.owner ?? elements.caseOwner.value.trim(),
      status: context.status ?? elements.caseStatus.value,
      tags: tagsSource,
      action,
      message,
      meta,
    };
    state.logEntries.unshift(entry);
    const item = createLogItem(entry);
    elements.logList.prepend(item);
    actions.updateCaseSummary();
    return entry;
  },
  renderLogEntries: () => {
    elements.logList.innerHTML = "";
    state.logEntries.forEach((entry) => {
      const item = createLogItem(entry);
      elements.logList.appendChild(item);
    });
  },
  renderMarkers: () => {
    elements.markerList.innerHTML = "";
    state.markers.forEach((marker) => {
      const item = createMarkerItem(marker);
      elements.markerList.appendChild(item);
    });
  },
  appendMarkerEntry: (entry) => {
    const item = createMarkerItem(entry);
    elements.markerList.prepend(item);
    actions.updateCaseSummary();
  },
  updateCaseSummary: () => {
    elements.caseFilesCount.textContent = state.importedFiles.length.toString();
    elements.caseMarkersCount.textContent = state.markers.length.toString();
    elements.caseLogsCount.textContent = state.logEntries.length.toString();
  },
  renderPipelineErrors: () => {
    if (!elements.pipelineErrors) return;
    elements.pipelineErrors.innerHTML = "";
    if (!state.pipelineErrors.length) {
      const empty = document.createElement("li");
      empty.textContent = "Ошибки не зафиксированы.";
      elements.pipelineErrors.appendChild(empty);
      return;
    }
    state.pipelineErrors.forEach((entry) => {
      elements.pipelineErrors.appendChild(createPipelineErrorItem(entry));
    });
  },
  appendPipelineError: (job, errorCode) => {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      jobId: job.id,
      attempt: job.attempt,
      error: errorCode,
    };
    state.pipelineErrors.unshift(errorEntry);
    state.pipelineErrors = state.pipelineErrors.slice(0, 30);
    actions.renderPipelineErrors();
    return errorEntry;
  },
  renderPipelineJobs: () => {
    if (!elements.pipelineQueue || !elements.pipelineStatus) return;
    elements.pipelineQueue.innerHTML = "";
    const jobs = [...state.pipelineJobs].reverse();

    if (!jobs.length) {
      const empty = document.createElement("li");
      empty.textContent = "Очередь pipeline пуста.";
      elements.pipelineQueue.appendChild(empty);
      elements.pipelineStatus.textContent = "Pipeline: задач нет.";
      if (elements.pipelineProgress) {
        elements.pipelineProgress.value = 0;
      }
      if (elements.pipelineProgressLabel) {
        elements.pipelineProgressLabel.textContent = "0%";
      }
      actions.renderPipelineErrors();
      return;
    }

    jobs.forEach((job) => {
      elements.pipelineQueue.appendChild(createPipelineItem(job));
    });

    const pending = state.pipelineJobs.filter((job) => job.status === "pending").length;
    const runningJobs = state.pipelineJobs.filter((job) => job.status === "running");
    const done = state.pipelineJobs.filter((job) => job.status === "done").length;
    const failed = state.pipelineJobs.filter((job) => job.status === "failed").length;
    const running = runningJobs.length;

    const activeProgress = runningJobs.length ? runningJobs[0].progress ?? 0 : 0;
    if (elements.pipelineProgress) {
      elements.pipelineProgress.value = activeProgress;
    }
    if (elements.pipelineProgressLabel) {
      elements.pipelineProgressLabel.textContent = `${activeProgress}%`;
    }

    elements.pipelineStatus.textContent = `Pipeline: pending ${pending}, running ${running}, done ${done}, failed ${failed}.`;
    actions.renderPipelineErrors();
  },
  processNextPipelineJob: () => {
    if (state.pipelineProcessing) return;
    const nextJob = state.pipelineJobs.find((job) => job.status === "pending");
    if (!nextJob) {
      actions.renderPipelineJobs();
      return;
    }
    state.pipelineProcessing = true;
    nextJob.status = "running";
    nextJob.startedAt = new Date().toISOString();
    nextJob.progress = 0;
    actions.renderPipelineJobs();
    actions.recordLog("pipeline-job-running", `Запущена обработка job-${nextJob.id}`, {
      jobId: nextJob.id,
      stage: nextJob.stage,
      attempt: nextJob.attempt,
      maxRetries: nextJob.maxRetries,
    }, nextJob.caseContext);

    const progressTimer = window.setInterval(() => {
      if (nextJob.status !== "running") {
        window.clearInterval(progressTimer);
        return;
      }
      const nextValue = Math.min(95, (nextJob.progress ?? 0) + 15);
      nextJob.progress = nextValue;
      actions.renderPipelineJobs();
    }, 180);

    window.setTimeout(() => {
      window.clearInterval(progressTimer);
      if (nextJob.hasSource) {
        nextJob.status = "done";
        nextJob.progress = 100;
        nextJob.finishedAt = new Date().toISOString();
        actions.recordLog("pipeline-job-done", `Pipeline job-${nextJob.id} завершен`, {
          jobId: nextJob.id,
        }, nextJob.caseContext);
      } else {
        nextJob.error = "source-missing";
        const errorEntry = actions.appendPipelineError(nextJob, nextJob.error);
        const canRetry = nextJob.attempt <= nextJob.maxRetries;

        if (canRetry) {
          nextJob.status = "pending";
          nextJob.progress = 0;
          nextJob.lastErrorAt = errorEntry.timestamp;
          nextJob.attempt += 1;
          actions.recordLog("pipeline-job-retry", `Pipeline job-${nextJob.id} повторно поставлен в очередь`, {
            jobId: nextJob.id,
            error: nextJob.error,
            nextAttempt: nextJob.attempt,
            maxRetries: nextJob.maxRetries,
          }, nextJob.caseContext);
        } else {
          nextJob.status = "failed";
          nextJob.progress = 100;
          nextJob.finishedAt = new Date().toISOString();
          actions.recordLog("pipeline-job-failed", `Pipeline job-${nextJob.id} завершен с ошибкой`, {
            jobId: nextJob.id,
            error: nextJob.error,
            attemptsUsed: nextJob.attempt,
            maxRetries: nextJob.maxRetries,
          }, nextJob.caseContext);
        }
      }
      state.pipelineProcessing = false;
      actions.renderPipelineJobs();
      actions.processNextPipelineJob();
    }, 1200);
  },
  enqueuePipelineJob: (jobPayload, stage = "3.3.2") => {
    const caseContext = {
      caseId: elements.caseId.value.trim(),
      owner: elements.caseOwner.value.trim(),
      status: elements.caseStatus.value,
      tags: elements.caseTags.value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    const job = {
      id: state.pipelineNextJobId,
      stage,
      createdAt: new Date().toISOString(),
      status: "pending",
      progress: 0,
      attempt: 1,
      maxRetries: state.pipelineMaxRetries,
      hasSource: Boolean(jobPayload?.source),
      caseContext,
    };
    state.pipelineNextJobId += 1;
    state.pipelineJobs.push(job);
    actions.renderPipelineJobs();
    actions.recordLog("pipeline-job-enqueue", `Добавлена pipeline job-${job.id}`, {
      jobId: job.id,
      stage,
      hasSource: job.hasSource,
    }, caseContext);
    actions.processNextPipelineJob();
    return job;
  },
  refreshCaseLibraryOptions: (query = "") => {
    const normalizedQuery = query.trim().toLowerCase();
    elements.caseLibrary.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Выберите дело";
    elements.caseLibrary.appendChild(placeholder);
    const filtered = state.caseLibrary.filter((caseItem) => {
      if (!normalizedQuery) return true;
      const haystack = [
        caseItem.caseId,
        caseItem.owner,
        caseItem.status,
        caseItem.summary,
        ...(caseItem.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
    filtered.forEach((caseItem) => {
      const option = document.createElement("option");
      option.value = caseItem.id;
      option.textContent = `${caseItem.caseId || "Без ID"} · ${
        caseItem.owner || "Не указан"
      } · ${new Date(caseItem.updatedAt).toLocaleString("ru-RU")}`;
      elements.caseLibrary.appendChild(option);
    });
    elements.caseCount.textContent = `Найдено дел: ${filtered.length}`;
  },
  loadCaseLibrary: () => {
    const stored = localStorage.getItem("forensicCaseLibrary");
    state.caseLibrary = stored ? JSON.parse(stored) : [];
    state.caseLibrary.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    actions.refreshCaseLibraryOptions(elements.caseSearch.value);
    actions.updateCaseSummary();
  },
  saveCaseLibrary: () => {
    localStorage.setItem(
      "forensicCaseLibrary",
      JSON.stringify(state.caseLibrary)
    );
  },
  saveCurrentCase: () => {
    const selectedId = elements.caseLibrary.value;
    const existingIndex = state.caseLibrary.findIndex(
      (caseItem) => caseItem.id === selectedId
    );
    const now = new Date().toISOString();
    const tags = elements.caseTags.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const caseItem = {
      id:
        existingIndex >= 0
          ? state.caseLibrary[existingIndex].id
          : crypto.randomUUID?.() || `case-${Date.now()}`,
      caseId: elements.caseId.value.trim(),
      owner: elements.caseOwner.value.trim(),
      status: elements.caseStatus.value,
      tags,
      summary: elements.caseSummary.value.trim(),
      createdAt:
        existingIndex >= 0
          ? state.caseLibrary[existingIndex].createdAt
          : now,
      updatedAt: now,
      logEntries: state.logEntries,
      markers: state.markers,
      importedFiles: state.importedFiles,
    };
    if (existingIndex >= 0) {
      state.caseLibrary[existingIndex] = caseItem;
    } else {
      state.caseLibrary.unshift(caseItem);
    }
    actions.saveCaseLibrary();
    actions.loadCaseLibrary();
    elements.caseLibrary.value = caseItem.id;
    elements.caseSearch.value = "";
    actions.recordLog("case-save", "Дело сохранено в библиотеку", {
      id: caseItem.id,
    });
  },
  loadCaseFromLibrary: () => {
    const selectedId = elements.caseLibrary.value;
    if (!selectedId) return;
    const caseItem = state.caseLibrary.find(
      (item) => item.id === selectedId
    );
    if (!caseItem) return;
    elements.caseId.value = caseItem.caseId || "";
    elements.caseOwner.value = caseItem.owner || "";
    elements.caseStatus.value = caseItem.status || "active";
    elements.caseTags.value = (caseItem.tags || []).join(", ");
    elements.caseSummary.value = caseItem.summary || "";
    state.logEntries = caseItem.logEntries || [];
    state.markers = caseItem.markers || [];
    state.importedFiles = (caseItem.importedFiles || []).map((file) => ({
      ...file,
      key: file.key || `${file.name || "file"}::${file.size || 0}::${file.hash || "pending"}`,
    }));
    state.selectedImportedFileKey = state.importedFiles[0]?.key || null;
    actions.renderLogEntries();
    actions.renderMarkers();
    actions.updateCaseSummary();
    if (actions.refreshTimeline) {
      actions.refreshTimeline();
    }
    actions.recordLog("case-load", "Дело загружено из библиотеки", {
      id: caseItem.id,
    });
  },
  deleteCaseFromLibrary: () => {
    const selectedId = elements.caseLibrary.value;
    if (!selectedId) return;
    state.caseLibrary = state.caseLibrary.filter(
      (item) => item.id !== selectedId
    );
    actions.saveCaseLibrary();
    actions.loadCaseLibrary();
    actions.recordLog("case-delete", "Дело удалено из библиотеки", {
      id: selectedId,
    });
  },
  hashFile: async (file) => {
    // Потоковое хэширование: не грузим весь файл в RAM.
    const prevLabel = elements.pipelineProgressLabel?.textContent;
    const prevValue = elements.pipelineProgress?.value;
    try {
      const hex = await hashFileStream(file, {
        onProgress: ({ percent }) => {
          if (elements.pipelineProgressLabel) {
            elements.pipelineProgressLabel.textContent = `Хэширование: ${file.name} (${percent}%)`;
          }
          if (elements.pipelineProgress) {
            elements.pipelineProgress.value = percent;
          }
        },
      });
      return hex;
    } finally {
      if (elements.pipelineProgressLabel) {
        elements.pipelineProgressLabel.textContent = prevLabel || '—';
      }
      if (elements.pipelineProgress) {
        elements.pipelineProgress.value = Number.isFinite(prevValue) ? prevValue : 0;
      }
    }
  },

  /**
   * Добавляет виртуальный файл в плейлист. Используется, чтобы
   * записать сгенерированные клипы (например, гипотезы) в общую
   * библиотеку импорта. Файл должен быть объектом File или Blob.
   * Он будет передан в blueprint плейлиста через кастомное событие
   * 'playe:add-file'.
   *
   * @param {File|Blob} file Сгенерированный медиа‑файл
   */
  addVirtualFile: async (file) => {
    if (!file) return;
    // Убедимся, что у объекта есть имя и тип. Если это Blob,
    // присвоим имя по умолчанию.
    let finalFile;
    if (file instanceof File) {
      finalFile = file;
    } else {
      const name = file.name || `hypothesis-${Date.now()}.webm`;
      const options = { type: file.type || 'video/webm' };
      finalFile = new File([file], name, options);
    }
    const event = new CustomEvent('playe:add-file', { detail: { file: finalFile } });
    document.dispatchEvent(event);
  },
};

const orchestrator = new Orchestrator({ elements, state, actions });

orchestrator.register(createPlaylistBlueprint());
orchestrator.register(createPlayerBlueprint());
orchestrator.register(createScreenshotBlueprint());
orchestrator.register(createClipBlueprint());
orchestrator.register(createQualityBlueprint());
orchestrator.register(createMotionBlueprint());
orchestrator.register(createForensicBlueprint());
orchestrator.register(createTimelineBlueprint());
orchestrator.register(createAiBlueprint());
orchestrator.register(createHypothesisBlueprint());
// Register comparison blueprint last so it can access imported files
orchestrator.register(createCompareBlueprint());
// Register photo reconstruction blueprint (standalone overlay)
orchestrator.register(createPhotoBlueprint());
// Register 3D reconstruction blueprint (Stage 5)
orchestrator.register(create3DReconstructionBlueprint());

const setCompactMode = (enabled) => {
  if (!elements.appRoot || !elements.compactToggle) return;
  elements.appRoot.classList.toggle("compact", enabled);
  elements.compactToggle.textContent = `Компактный режим: ${enabled ? "вкл" : "выкл"}`;
};

const savedCompact = localStorage.getItem("uiCompactMode") === "1";
setCompactMode(savedCompact);

if (elements.compactToggle) {
  elements.compactToggle.addEventListener("click", () => {
    const nextValue = !elements.appRoot.classList.contains("compact");
    setCompactMode(nextValue);
    localStorage.setItem("uiCompactMode", nextValue ? "1" : "0");
  });
}

orchestrator.start();
// Initialise smart router indicator
{
  const networkStatusEl = document.getElementById('mode-indicator');
  if (networkStatusEl) {
    smartRouter.setIndicator(networkStatusEl);
  }
}

// ============================================================================
// MODE SELECTOR AND BACKEND SETTINGS (Stage 1)
// ============================================================================

// Mode selector change handler
if (elements.modeSelector) {
  elements.modeSelector.addEventListener('change', (e) => {
    const mode = e.target.value;
    smartRouter.setMode(mode);
    // Toggle backend settings visibility
    if (elements.backendSettings) {
      if (mode === 'offline') {
        elements.backendSettings.classList.add('hidden');
      } else {
        elements.backendSettings.classList.remove('hidden');
      }
    }
    console.log('[Mode] Changed to:', mode);
  });
}

// ---------------------------------------------------------------------------
// Mode change notifications (Stage 1.9)
//
// Display a small toast message when the effective mode (online/offline)
// changes. We remember the last mode to avoid showing a notification on
// initialisation. Notifications appear in the bottom‑right corner and fade
// out automatically.
{
  let lastEffectiveMode = smartRouter.getEffectiveMode();
  function showNotification(message) {
    const container = document.getElementById('notifications');
    if (!container) return;
    const note = document.createElement('div');
    note.className = 'notification';
    note.textContent = message;
    container.appendChild(note);
    // Trigger fade out after 3 seconds
    setTimeout(() => note.classList.add('fade-out'), 3000);
    // Remove element after fade animation
    setTimeout(() => {
      if (note.parentElement) {
        note.parentElement.removeChild(note);
      }
    }, 4000);
  }

  // Экспортируем функцию уведомления в глобальный объект, чтобы
  // использовать её в модальном окне загрузки моделей.
  if (typeof window !== 'undefined') {
    window.showNotification = showNotification;
  }
  smartRouter.subscribe(({ effectiveMode }) => {
    if (effectiveMode !== lastEffectiveMode) {
      const modeName = effectiveMode === 'online' ? 'онлайн' : 'оффлайн';
      showNotification(`Режим переключен на ${modeName}`);
      lastEffectiveMode = effectiveMode;
    }
  });
}

// Backend URL change handler
if (elements.backendUrlInput) {
  elements.backendUrlInput.addEventListener('change', (e) => {
    const url = e.target.value.trim();
    if (url) {
      smartRouter.setBackendUrl(url);
      console.log('[Backend] URL set to:', url);
      // Save to localStorage
      localStorage.setItem('backendUrl', url);
    }
  });
  // Load saved URL
  const savedUrl = localStorage.getItem('backendUrl');
  if (savedUrl) {
    elements.backendUrlInput.value = savedUrl;
    smartRouter.setBackendUrl(savedUrl);
  }
}

// AI capability check handler (Stage 1.8)
if (elements.aiCapabilityCheckButton) {
  elements.aiCapabilityCheckButton.addEventListener('click', () => {
    const cap = detectCapabilities();
    const statusEl = elements.aiCapabilityStatus;
    if (statusEl) {
      let label;
      switch (cap) {
        case 'webgpu':
          label = 'WebGPU доступен';
          break;
        case 'webgl2':
          label = 'WebGL2 доступен';
          break;
        case 'webgl':
          label = 'WebGL доступен';
          break;
        default:
          label = 'Только CPU (wasm)';
      }
      statusEl.textContent = `Capability: ${label}.`;
    }
  });
}

// Backend connection test button
if (elements.testBackendButton) {
  elements.testBackendButton.addEventListener('click', async () => {
    const statusEl = elements.backendStatus;
    const button = elements.testBackendButton;
    if (!statusEl) return;
    // UI feedback
    button.disabled = true;
    statusEl.textContent = 'Проверка...';
    statusEl.className = 'backend-status testing';
    try {
      const available = await smartRouter.checkBackendAvailability();
      if (available) {
        statusEl.textContent = '✓ Подключено';
        statusEl.className = 'backend-status success';
      } else {
        statusEl.textContent = '✗ Недоступен';
        statusEl.className = 'backend-status error';
      }
    } catch (err) {
      statusEl.textContent = '✗ Ошибка: ' + err.message;
      statusEl.className = 'backend-status error';
    } finally {
      button.disabled = false;
    }
    // Clear status after 3 seconds
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'backend-status';
    }, 3000);
  });
}

// Subscribe to SmartRouter state changes for logging
smartRouter.subscribe((state) => {
  console.log('[SmartRouter] State changed:', state);
  if (state.effectiveMode === 'offline' && state.mode === 'online') {
    console.warn('Облачный режим недоступен. Используются локальные модели.');
  }
});
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  // Register the service worker after page load to avoid blocking initial
  // rendering. Errors are logged to the console.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('service-worker.js')
      .then(() => {
        console.log('Service Worker registered');
      })
      .catch((err) => {
        console.error('Service Worker registration failed', err);
      });
  });
}

// ---------------------------------------------------------------------------
// Backend task queue integration (Stage 3)
//
// These helper functions wire up the mock backend pipeline to the UI.  A
// button allows users to submit a demo task to the queue.  The task list
// is refreshed periodically to display current statuses, progress and
// provide a cancel option for running tasks.  Results are stored in
// memory only; in a full implementation they would be persisted and
// processed by the cloud backend.

function updateBackendTaskList() {
  const listEl = elements.backendTaskList;
  if (!listEl) return;
  const tasks = getAllTasks();
  // Clear existing items
  listEl.innerHTML = '';
  Object.values(tasks).forEach((task) => {
    const li = document.createElement('li');
    // Status label
    const statusSpan = document.createElement('span');
    statusSpan.className = 'backend-task-status';
    statusSpan.textContent = task.status;
    li.appendChild(statusSpan);
    // Progress bar
    const progressWrapper = document.createElement('div');
    progressWrapper.className = 'backend-task-progress';
    const progressBar = document.createElement('div');
    progressBar.style.width = `${task.progress}%`;
    progressWrapper.appendChild(progressBar);
    li.appendChild(progressWrapper);
    // Cancel link or completed flag
    const actionSpan = document.createElement('span');
    if (task.status === 'running' || task.status === 'pending') {
      actionSpan.className = 'backend-task-cancel';
      actionSpan.textContent = 'Отмена';
      actionSpan.addEventListener('click', () => {
        cancelTask(task.id);
        updateBackendTaskList();
      });
    } else if (task.status === 'done') {
      actionSpan.textContent = '✓';
    } else if (task.status === 'cancelled' || task.status === 'failed') {
      actionSpan.textContent = '✕';
    }
    li.appendChild(actionSpan);
    // Optional: display task type or id as tooltip
    li.title = `${task.type}: ${task.id}`;
    listEl.appendChild(li);
  });
}

// Button to launch a demo backend task.  Generates a simple payload
// containing a timestamp and submits it to the mock backend.  After
// submission the task list is refreshed.  In a real implementation the
// payload would include image data or parameters for heavy AI models.
if (elements.backendDemoTask) {
  elements.backendDemoTask.addEventListener('click', () => {
    const payload = { submittedAt: new Date().toISOString() };
    submitTask('demo', payload);
    updateBackendTaskList();
  });
}

// Periodically refresh the backend task list to update progress bars
// and statuses.  Polling interval set to 1s for demo purposes.  In a
// production environment this could be implemented via web sockets or
// server‑sent events.
setInterval(() => {
  updateBackendTaskList();
}, 1000);

// ---------------------------------------------------------------------------
// Synchronisation handlers (Stage 4)
//
// Seed remote model versions for demonstration.  In a production
// environment this would not be necessary as the backend would manage
// model versions and remote case storage.  Here we populate remote
// versions once per session.
seedRemote({
  // Simulate newer versions of models available remotely
  retinaface: 2,
  gfpgan_lite: 1,
  arcface: 1,
  superres: 1,
});

// Handle case synchronisation: merge local and remote libraries and
// refresh the UI.  Records a log entry with the number of cases
// synchronised.  Updates the sync status message accordingly.
if (elements.syncCasesBtn) {
  elements.syncCasesBtn.addEventListener('click', async () => {
    try {
      let merged;
      // В онлайн-режиме синхронизировать через облако, иначе локально
      if (smartRouter.getEffectiveMode() === 'online') {
        merged = await cloudStorage.syncCases(state.caseLibrary);
      } else {
        merged = syncCases(state.caseLibrary);
      }
      state.caseLibrary = merged;
      // Persist and reload the merged library
      actions.saveCaseLibrary();
      actions.loadCaseLibrary();
      if (elements.syncStatus) {
        elements.syncStatus.textContent = `Синхронизировано дел: ${merged.length}`;
      }
      actions.recordLog('sync-cases', 'Синхронизация дел', {
        count: merged.length,
      });
    } catch (err) {
      console.error('Ошибка синхронизации дел', err);
      if (elements.syncStatus) {
        elements.syncStatus.textContent = `Ошибка синхронизации: ${err.message || err}`;
      }
    }
  });
}

// Handle model updates: compare local and remote versions and update
// local versions accordingly.  Inform the user of updated models via
// the sync status text.  Records a log entry for auditing.
if (elements.updateModelsBtn) {
  elements.updateModelsBtn.addEventListener('click', () => {
    try {
      const updated = updateModels();
      if (elements.syncStatus) {
        elements.syncStatus.textContent = updated.length
          ? `Обновлены модели: ${updated.join(', ')}`
          : 'Модели актуальны';
      }
      actions.recordLog('update-models', 'Обновление моделей', {
        updated,
      });
    } catch (err) {
      console.error('Ошибка обновления моделей', err);
      if (elements.syncStatus) {
        elements.syncStatus.textContent = `Ошибка обновления моделей: ${err.message || err}`;
      }
    }
  });
}

// -------------------------------------------------------------
// Стартовый экран
//
// При загрузке страницы отображается оверлей с выбором режима. После
// выбора пользователем один из режимов оверлей скрывается и
// приложение становится доступно. Кнопка шестерёнки в правом
// нижнем углу открывает меню с описанием доступных моделей и
// позволяет загрузить пользовательские веса.

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('start-overlay');
  const photoOverlay = document.getElementById('photo-overlay');
  const startVideoBtn = document.getElementById('start-video');
  const startPhotoBtn = document.getElementById('start-photo');
  const gearButton = document.getElementById('gear-button');
  const modelMenu = document.getElementById('model-menu');
  // Показываем оверлей при загрузке. Задаём display:flex, чтобы
  // он был виден даже если CSS устанавливает другой стиль.
  if (overlay) {
    overlay.style.display = 'flex';
  }
  // Показать видеоплеер и скрыть оверлей
  if (startVideoBtn) {
    startVideoBtn.addEventListener('click', () => {
      overlay.style.display = 'none';
    });
  }
  // Показать заглушку для реконструкции фото
  if (startPhotoBtn) {
    startPhotoBtn.addEventListener('click', () => {
      // Скрыть стартовый экран и показать оверлей реконструкции фото
      overlay.style.display = 'none';
      const photoOverlay = document.getElementById('photo-overlay');
      if (photoOverlay) {
        photoOverlay.classList.remove('hidden');
      }
    });
  }
  // Переключение отображения меню моделей
  if (gearButton && modelMenu) {
    gearButton.addEventListener('click', () => {
      modelMenu.classList.toggle('hidden');
    });
  }

  // Тема интерфейса (светлая/тёмная). При загрузке восстанавливаем
  // сохранённый выбор из localStorage. При клике на кнопку меняем
  // атрибут data-theme на <html> и сохраняем новое значение.
  const themeToggleButton = document.getElementById('theme-toggle');
  // Функция для применения темы
  const applyTheme = (theme) => {
    if (document.documentElement) {
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    }
  };
  // Устанавливаем текущую тему из localStorage, если есть
  try {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      applyTheme(savedTheme);
    }
  } catch (err) {
    // Если localStorage недоступен, игнорируем
  }
  if (themeToggleButton) {
    themeToggleButton.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const nextTheme = current === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
      try {
        localStorage.setItem('theme', nextTheme);
      } catch (err) {
        // не удаётся сохранить тему — игнорируем
      }
    });
  }

  // Загрузка пользовательской модели через меню шестерёнки
  const modelUploadInput = document.getElementById('model-upload-input');
  const modelList = document.getElementById('model-list');
  if (modelUploadInput) {
    modelUploadInput.addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const name = file.name.replace(/\.[^/.]+$/, '');
      const url = URL.createObjectURL(file);
      // Store dynamic model in global registry
      if (typeof window !== 'undefined') {
        window.dynamicModels = window.dynamicModels || {};
        window.dynamicModels[name] = url;
      }
      // Add to the list in the menu
      const li = document.createElement('li');
      li.innerHTML = `<strong>${name}:</strong> пользовательская модель`;
      if (modelList) {
        modelList.appendChild(li);
      }
      // Notify user
      alert(`Модель '${name}' успешно загружена. Теперь она доступна для использования.`);
      // Reset the input so the same file can be uploaded again if needed
      modelUploadInput.value = '';
    });
  }

  // Горячие клавиши для быстрого управления плеером
  // Пробел – воспроизведение/пауза
  // Стрелка влево/вправо – кадр назад/вперёд
  // S – скриншот
  // I – отметить начало клипа (IN)
  // O – отметить конец клипа (OUT)
  document.addEventListener('keydown', (ev) => {
    // Не срабатываем, если открыт стартовый экран или пользователь вводит текст
    const overlayVisible = overlay && overlay.style.display !== 'none';
    const photoVisible = photoOverlay && !photoOverlay.classList.contains('hidden');
    if (overlayVisible || photoVisible) return;
    const target = ev.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    switch (ev.key) {
      case ' ':
        ev.preventDefault();
        if (elements.video.paused) {
          elements.video.play();
        } else {
          elements.video.pause();
        }
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        elements.frameBack && elements.frameBack.click();
        break;
      case 'ArrowRight':
        ev.preventDefault();
        elements.frameForward && elements.frameForward.click();
        break;
      case 's':
      case 'S':
        ev.preventDefault();
        elements.screenshotButton && elements.screenshotButton.click();
        break;
      case 'i':
      case 'I':
        ev.preventDefault();
        elements.markInButton && elements.markInButton.click();
        break;
      case 'o':
      case 'O':
        ev.preventDefault();
        elements.markOutButton && elements.markOutButton.click();
        break;
      case 'f':
      case 'F':
        // Полноэкранный режим сравнения: переключаем класс на контейнере
        ev.preventDefault();
        if (elements.compareContainer) {
          elements.compareContainer.classList.toggle('fullscreen');
        }
        break;
      default:
        break;
    }
  });
});

// Initialise the model availability list after the DOM has loaded.  A separate
// listener is used here so that the list is populated once the markup is
// present, regardless of the order of other initialisation code.
document.addEventListener('DOMContentLoaded', () => {
  // Populate the model availability list once the DOM has loaded
  updateModelAvailability();
  // Initialise offline AI enhancement controls (Stage 2)
  initAiOfflineControls();
});

/**
 * Initialise event listeners for offline AI enhancement controls.
 * Captures the current video frame and routes it through SmartRouter
 * for face enhancement, upscaling or denoising.
 */
function initAiOfflineControls() {
  const {
    aiFaceEnhanceButton,
    aiUpscale2xButton,
    aiDenoiseButton,
    aiResultCanvas,
    aiModelStatus,
    video
  } = elements;
  if (!aiFaceEnhanceButton || !aiUpscale2xButton || !aiDenoiseButton) return;

  /**
   * Capture the current video frame into an ImageData object.
   * @returns {ImageData|null}
   */
  function captureFrame() {
    // Ensure video is ready
    if (!video || video.readyState < 2) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    // Create a temporary canvas to draw the current frame
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }

  /**
   * Run an AI task via SmartRouter and display the result.
   * @param {string} taskName
   */
  async function handleAiTask(taskName) {
    const frame = captureFrame();
    if (!frame) {
      if (aiModelStatus) aiModelStatus.textContent = 'Нет кадра для обработки.';
      return;
    }
    try {
      if (aiModelStatus) {
        aiModelStatus.textContent = `Запуск ${taskName}...`;
      }
      // Route the request via SmartRouter
      const result = await smartRouter.routeAiRequest(taskName, frame);
      if (result instanceof ImageData) {
        // Display the processed image in the result canvas
        aiResultCanvas.width = result.width;
        aiResultCanvas.height = result.height;
        const ctx = aiResultCanvas.getContext('2d');
        ctx.putImageData(result, 0, 0);
        aiResultCanvas.classList.remove('hidden');
        if (aiModelStatus) aiModelStatus.textContent = `Задача ${taskName} завершена.`;
      } else {
        // If result is not ImageData (e.g. JSON or Blob), show generic success
        aiResultCanvas.classList.add('hidden');
        if (aiModelStatus) aiModelStatus.textContent = `Задача ${taskName} выполнена.`;
        console.log(`AI task ${taskName} result:`, result);
      }
    } catch (err) {
      console.error(`AI task ${taskName} error:`, err);
      aiResultCanvas.classList.add('hidden');
      if (aiModelStatus) aiModelStatus.textContent = `Ошибка ${taskName}: ${err.message}`;
    }
  }

  aiFaceEnhanceButton.addEventListener('click', () => {
    handleAiTask('faceEnhance');
  });
  aiUpscale2xButton.addEventListener('click', () => {
    handleAiTask('upscale');
  });
  aiDenoiseButton.addEventListener('click', () => {
    handleAiTask('denoise');
  });
}

// ---------------------------------------------------------------------------
// Настройки модального окна и загрузки моделей (новый этап)
//
// Функции для отображения списка доступных моделей, загрузки выбранной
// модели с прогрессом и проверки обновлений. Эти функции выполняют
// взаимодействие с модальным окном настроек и работают вместе с
// modelDownloader.js.

/**
 * Загрузить и отобразить список моделей в модальном окне.
 * Создаёт элементы DOM для каждой модели: имя, размер, описание,
 * версия, точность и кнопка загрузки (если модель не загружена).
 */
async function loadModelsUI() {
  const modelsListEl = document.getElementById('models-list');
  if (!modelsListEl) return;
  modelsListEl.innerHTML = '<div class="loading">Загрузка...</div>';
  const models = getAvailableModels();
  modelsListEl.innerHTML = '';
  for (const model of models) {
    const isDownloaded = await isModelDownloaded(model.fileName);
    const modelItem = document.createElement('div');
    modelItem.className = 'model-item';
    modelItem.innerHTML = `
        <div class="model-header">
          <span class="model-name">${model.name}</span>
          <span class="model-size">${formatBytes(model.size)}</span>
        </div>
        <div class="model-description">${model.description || ''}</div>
        <div class="model-meta">
          <span>Точность: ${model.accuracy}</span>
          <span>Версия: ${model.version}</span>
        </div>
        <div class="model-status">
          <span class="status-badge ${isDownloaded ? 'loaded' : 'not-loaded'}">
            ${isDownloaded ? '✓ Загружена' : 'Не загружена'}
          </span>
          ${!isDownloaded ? `
            <button class="btn-sm download-model" data-filename="${model.fileName}">
              ⬇️ Загрузить
            </button>
          ` : ''}
        </div>
        <div class="progress-bar" style="display: none;" data-filename="${model.fileName}">
          <div class="progress-fill" style="width: 0%;"></div>
          <span class="progress-text">0%</span>
        </div>
      `;
    modelsListEl.appendChild(modelItem);
  }
  attachDownloadHandlers();
}

/**
 * Добавить обработчики кликов для кнопок загрузки моделей. При клике на
 * кнопку «Загрузить» начинает скачивание модели с отображением
 * прогресса, обновляет индикаторы и показывает уведомление по
 * завершении или ошибке.
 */
function attachDownloadHandlers() {
  const downloadBtns = document.querySelectorAll('.download-model');
  downloadBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fileName = btn.dataset.filename;
      const progressBar = document.querySelector(
        `.progress-bar[data-filename="${fileName}"]`
      );
      const statusBadge = btn.previousElementSibling;
      // Показать прогресс
      btn.disabled = true;
      btn.textContent = '⏳ Загрузка...';
      if (progressBar) progressBar.style.display = 'block';
      try {
        await downloadModel(fileName, (percent) => {
          const fill = progressBar.querySelector('.progress-fill');
          const text = progressBar.querySelector('.progress-text');
          fill.style.width = `${percent}%`;
          text.textContent = `${percent}%`;
        });
        // Успех — обновляем статус
        statusBadge.className = 'status-badge loaded';
        statusBadge.textContent = '✓ Загружена';
        btn.remove();
        if (progressBar) progressBar.style.display = 'none';
        if (typeof showNotification === 'function') {
          showNotification('✅ Модель успешно загружена!', 'success');
        }
      } catch (err) {
        console.error('Download failed:', err);
        btn.disabled = false;
        btn.textContent = '⬇️ Загрузить';
        if (progressBar) progressBar.style.display = 'none';
        if (typeof showNotification === 'function') {
          showNotification(`❌ Ошибка загрузки: ${err.message}`, 'error');
        }
      }
    });
  });
}

/**
 * Показать диалог с деталями обновлений (пока консоль). В будущем
 * можно реализовать полноценное окно. Сейчас выводит список
 * обновлений в консоль.
 * @param {Array} updates Список обновлений
 */
function showUpdatesDialog(updates) {
  // TODO: Реализовать полноценное модальное окно для обновлений
  console.log('Available updates:', updates);
}

// Инициализация модального окна настроек и обработчиков вкладок
document.addEventListener('DOMContentLoaded', () => {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');
  // Открыть модальное окно
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
      loadModelsUI();
    });
  }
  // Закрыть модальное окно кнопкой ×
  if (settingsClose && settingsModal) {
    settingsClose.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }
  // Закрыть по клику вне области контента
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
      }
    });
  }
  // Переключение вкладок
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      // Снять активность со всех вкладок и скрыть контент
      tabButtons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => {
        c.style.display = 'none';
      });
      // Активировать текущую
      btn.classList.add('active');
      const targetTab = document.getElementById(`${tabName}-tab`);
      if (targetTab) {
        targetTab.style.display = 'block';
      }
    });
  });
  // Обработчик смены режима из модального окна
  const routerModeSelect = document.getElementById('router-mode');
  if (routerModeSelect) {
    routerModeSelect.value = smartRouter.mode || 'auto';
    routerModeSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      smartRouter.setMode(mode);
    });
  }
  // Обработчик кнопки "Проверить обновления"
  const checkUpdatesBtn = document.getElementById('check-updates-btn');
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Проверка...';
      try {
        const updates = await checkModelUpdates();
        if (updates.length === 0) {
          showNotification('✅ Все модели актуальны!', 'success');
        } else {
          showNotification(`Доступно обновлений: ${updates.length}. Проверьте список моделей.`, 'info');
          showUpdatesDialog(updates);
        }
      } catch (err) {
        showNotification(`❌ ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Проверить обновления';
      }
    });
  }
});
