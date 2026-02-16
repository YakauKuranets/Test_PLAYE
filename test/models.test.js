/*
 * Tests for local AI models and registry integration (Stage 2).
 *
 * These tests verify that the registry exposes offline model information for
 * all tasks and that the localRunner marks these models as available.
 * Note: These tests do not perform actual inference, as that would
 * require a browser environment and ONNX runtime. Instead, they focus
 * on the presence of metadata and availability flags.
 */

import {
  getModelInfo,
  getAllTasks
} from '../src/models/registry.js';
import {
  isLocalModelAvailable,
  getAvailableLocalModels
} from '../src/models/localRunner.js';

console.log('Running models tests...');

// Ensure the registry reports all tasks
const tasks = getAllTasks();
console.assert(Array.isArray(tasks) && tasks.length >= 3, 'Registry should return at least three tasks');

// Check that each offline model has a path and is available locally
['faceEnhance', 'upscale', 'denoise'].forEach((task) => {
  const info = getModelInfo(task, 'offline');
  console.assert(info && typeof info.path === 'string' && info.path.length > 0,
    `Offline model path missing for task ${task}`);
  console.assert(isLocalModelAvailable(task) === true,
    `Local model should be available for task ${task}`);
});

// Check getAvailableLocalModels returns our tasks
const available = getAvailableLocalModels();
['faceEnhance', 'upscale', 'denoise'].forEach((task) => {
  console.assert(available.includes(task), `Task ${task} should be in available local models`);
});

console.log('✅ All model tests passed');