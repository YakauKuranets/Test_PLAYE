/*
 * Mock backend pipeline for Stage 3
 *
 * This module simulates an asynchronous cloud backend for heavy AI
 * operations.  In a full implementation the frontend would send HTTP
 * requests to a FastAPI server running heavy models on a GPU.  Here we
 * emulate that behaviour by managing a queue of tasks with statuses
 * (pending → running → done/failed) and incremental progress updates.
 * Each task has a unique id, a type (e.g. 'faceEnhance', 'objectDetect'),
 * an optional payload and a result/error once finished.  Consumers can
 * submit new tasks, poll their status, cancel them, and retrieve a
 * snapshot of the entire queue.  Progress and completion are achieved
 * using setTimeout/setInterval to mimic processing time.
 */

// Internal storage for tasks.  Keys are task ids and values are
// TaskInfo objects.  A TaskInfo object has: id, type, status,
// progress (0-100), payload (opaque), result (optional), error (optional)
const tasks = {};

// Submit a new task to the mock backend.  Returns the task id.  The
// task will transition through statuses automatically over time.
export function submitTask(type, payload = {}) {
  const id = 'task_' + Math.random().toString(36).slice(2) + Date.now();
  // Initialise task state
  const task = {
    id,
    type,
    status: 'pending',
    progress: 0,
    payload,
    result: null,
    error: null,
  };
  tasks[id] = task;
  // Simulate asynchronous work: after a brief delay mark as running
  setTimeout(() => {
    if (!tasks[id] || tasks[id].status !== 'pending') return;
    tasks[id].status = 'running';
  }, 250);
  // Increment progress periodically until completion
  const intervalId = setInterval(() => {
    const t = tasks[id];
    if (!t) {
      clearInterval(intervalId);
      return;
    }
    if (t.status === 'cancelled' || t.status === 'failed') {
      clearInterval(intervalId);
      return;
    }
    if (t.status === 'running') {
      t.progress += 10;
      if (t.progress >= 100) {
        t.progress = 100;
        t.status = 'done';
        // Produce a mock result.  For AI tasks we could return
        // synthetic data; here we just echo the payload with a
        // completion timestamp.
        t.result = {
          finishedAt: new Date().toISOString(),
          payload: t.payload,
        };
        clearInterval(intervalId);
      }
    }
  }, 500);
  return id;
}

// Retrieve the current state of a specific task.
export function pollTask(taskId) {
  return tasks[taskId] || null;
}

// Cancel an existing task.  If the task is already completed or
// cancelled this has no effect.  Cancellation marks the task as
// 'cancelled' and sets an error message.
export function cancelTask(taskId) {
  const t = tasks[taskId];
  if (t && t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled') {
    t.status = 'cancelled';
    t.error = 'cancelled by user';
  }
}

// Return a shallow copy of all tasks.  Consumers should not mutate
// this object directly.
export function getAllTasks() {
  return { ...tasks };
}