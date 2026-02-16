/*
 * Synchronisation utilities for Stage 4
 *
 * The hybrid application eventually needs to synchronise case libraries and
 * model weights across devices via a central backend.  These helper
 * functions implement a basic local simulation of that behaviour using
 * the browser's localStorage.  Cases are merged based on id and
 * updatedAt timestamp; model versions are compared and updated.  In a
 * production implementation these functions would send HTTP requests to
 * a cloud API instead of interacting with localStorage directly.
 */

const REMOTE_CASES_KEY = 'remoteCaseLibrary';
const LOCAL_MODEL_VERSIONS_KEY = 'localModelVersions';
const REMOTE_MODEL_VERSIONS_KEY = 'remoteModelVersions';

/**
 * Synchronise the local case library with the remote store.  Cases are
 * identified by their `id` property and compared by `updatedAt`.  The
 * merged result is returned and also saved to both local and remote
 * storage.  Cases that are newer locally will overwrite older remote
 * cases and vice versa.
 *
 * @param {Array<Object>} localCases The current local case library
 * @returns {Array<Object>} The merged case library
 */
export function syncCases(localCases = []) {
  let remoteCases;
  try {
    remoteCases = JSON.parse(localStorage.getItem(REMOTE_CASES_KEY) || '[]');
  } catch (err) {
    remoteCases = [];
  }
  const mergedMap = new Map();
  // Insert remote cases first
  remoteCases.forEach((c) => {
    mergedMap.set(c.id, c);
  });
  // Merge local cases, replacing if updatedAt is newer
  localCases.forEach((c) => {
    const existing = mergedMap.get(c.id);
    if (!existing) {
      mergedMap.set(c.id, c);
    } else {
      const localTime = new Date(c.updatedAt || 0).getTime();
      const remoteTime = new Date(existing.updatedAt || 0).getTime();
      if (localTime > remoteTime) {
        mergedMap.set(c.id, c);
      }
    }
  });
  const merged = Array.from(mergedMap.values());
  // Persist back to local and remote
  localStorage.setItem(REMOTE_CASES_KEY, JSON.stringify(merged));
  return merged;
}

/**
 * Update local model versions based on the remote version list.  Remote
 * versions are stored in localStorage under REMOTE_MODEL_VERSIONS_KEY
 * and represent the latest available versions on the server.  Local
 * versions are stored under LOCAL_MODEL_VERSIONS_KEY.  The function
 * updates the local version numbers and returns a list of models that
 * were updated.  This does not fetch actual model binaries; in a real
 * implementation you would download new weights and persist them via
 * persistModel().
 *
 * @returns {Array<string>} Array of model names that were updated
 */
export function updateModels() {
  let remoteVersions;
  try {
    remoteVersions = JSON.parse(localStorage.getItem(REMOTE_MODEL_VERSIONS_KEY) || '{}');
  } catch (err) {
    remoteVersions = {};
  }
  let localVersions;
  try {
    localVersions = JSON.parse(localStorage.getItem(LOCAL_MODEL_VERSIONS_KEY) || '{}');
  } catch (err) {
    localVersions = {};
  }
  const updated = [];
  Object.keys(remoteVersions).forEach((modelName) => {
    const remoteVer = remoteVersions[modelName];
    const localVer = localVersions[modelName] || 0;
    if (remoteVer > localVer) {
      localVersions[modelName] = remoteVer;
      updated.push(modelName);
    }
  });
  localStorage.setItem(LOCAL_MODEL_VERSIONS_KEY, JSON.stringify(localVersions));
  return updated;
}

/**
 * Seed the remote store with initial data.  This function is useful for
 * testing and demonstration; it adds a set of remote model versions
 * and (optionally) initial cases.  In a real scenario the remote data
 * would already exist on the server.  Calling this function will
 * overwrite any existing remote data.
 *
 * @param {Object} models A mapping of model names to version numbers
 * @param {Array<Object>} cases Array of case objects to preload remotely
 */
export function seedRemote(models = {}, cases = []) {
  localStorage.setItem(REMOTE_MODEL_VERSIONS_KEY, JSON.stringify(models));
  if (Array.isArray(cases)) {
    localStorage.setItem(REMOTE_CASES_KEY, JSON.stringify(cases));
  }
}