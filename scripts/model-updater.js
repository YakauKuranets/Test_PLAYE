const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const repoRoot = path.join(__dirname, '..');
const modelsDir = path.join(repoRoot, 'models');
const localManifestPath = path.join(modelsDir, 'manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readLocalManifest() {
  if (!fs.existsSync(localManifestPath)) {
    return { version: '0.0.0', models: {} };
  }
  return readJson(localManifestPath);
}

function parseVersion(version) {
  return String(version || '0.0.0')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
    .slice(0, 3);
}

function isVersionGreater(next, current) {
  const a = parseVersion(next);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function requestBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;
    client
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          return resolve(requestBuffer(response.headers.location));
        }

        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`Request failed: ${response.statusCode} ${url}`));
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function withRetries(task, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 2;
  const delayMs = Number.isInteger(options.delayMs) ? options.delayMs : 250;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw lastError;
}

async function loadRemoteManifest(manifestUrl, options = {}) {
  const raw = await withRetries(() => requestBuffer(manifestUrl), options);
  return JSON.parse(raw.toString('utf8'));
}

function calcUpdates(localManifest, remoteManifest) {
  const updates = [];
  const remoteModels = remoteManifest.models || {};

  for (const [name, remoteModel] of Object.entries(remoteModels)) {
    const localModel = (localManifest.models || {})[name];
    const shouldUpdate = !localModel || isVersionGreater(remoteModel.version, localModel.version);
    if (shouldUpdate) {
      updates.push({
        name,
        currentVersion: localModel ? localModel.version : null,
        nextVersion: remoteModel.version,
        file: remoteModel.file,
        sha256: remoteModel.sha256,
        url: remoteModel.url,
      });
    }
  }

  return updates;
}

function ensureEnoughDiskSpace(bytesRequired) {
  if (!fs.statfsSync) {
    return;
  }

  const stats = fs.statfsSync(modelsDir);
  const freeBytes = stats.bavail * stats.bsize;
  if (freeBytes < bytesRequired) {
    throw new Error(`Not enough free disk space. Required=${bytesRequired}, available=${freeBytes}`);
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fileData = fs.readFileSync(filePath);
  hash.update(fileData);
  return hash.digest('hex');
}

function safeUnlink(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function downloadFile(url, destinationPath, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;

    client
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          return resolve(downloadFile(response.headers.location, destinationPath, onProgress));
        }

        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`Download failed: ${response.statusCode} ${url}`));
        }

        const total = Number.parseInt(response.headers['content-length'] || '0', 10);
        if (Number.isFinite(total) && total > 0) {
          ensureEnoughDiskSpace(total);
        }

        let received = 0;
        const tempPath = `${destinationPath}.part`;
        const writer = fs.createWriteStream(tempPath);

        response.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) {
            onProgress({ received, total });
          }
        });

        response.pipe(writer);

        writer.on('finish', () => {
          writer.close(() => {
            fs.renameSync(tempPath, destinationPath);
            resolve();
          });
        });

        writer.on('error', (err) => {
          writer.close(() => {
            safeUnlink(tempPath);
            reject(err);
          });
        });
      })
      .on('error', reject);
  });
}

function updateManifestModel(modelInfo) {
  const manifest = readLocalManifest();
  manifest.models = manifest.models || {};
  manifest.models[modelInfo.name] = {
    version: modelInfo.nextVersion,
    file: modelInfo.file,
    sha256: modelInfo.sha256 || null,
    updatedAt: new Date().toISOString(),
  };
  writeJson(localManifestPath, manifest);
}

async function applyModelUpdate(modelInfo, onProgress, options = {}) {
  if (!modelInfo.url) {
    throw new Error(`Model ${modelInfo.name} does not have download url`);
  }

  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  const targetPath = path.join(modelsDir, modelInfo.file);
  const backupPath = `${targetPath}.bak`;
  let backupCreated = false;

  if (fs.existsSync(targetPath)) {
    fs.renameSync(targetPath, backupPath);
    backupCreated = true;
  }

  try {
    await withRetries(() => downloadFile(modelInfo.url, targetPath, onProgress), options);

    if (modelInfo.sha256) {
      const actual = sha256File(targetPath);
      if (actual !== modelInfo.sha256) {
        throw new Error(`Checksum mismatch for ${modelInfo.name}: expected ${modelInfo.sha256}, got ${actual}`);
      }
    }

    updateManifestModel(modelInfo);

    if (backupCreated && fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    return { name: modelInfo.name, version: modelInfo.nextVersion, file: modelInfo.file };
  } catch (error) {
    safeUnlink(`${targetPath}.part`);
    safeUnlink(targetPath);
    if (backupCreated && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, targetPath);
    }
    throw error;
  }
}

module.exports = {
  readLocalManifest,
  loadRemoteManifest,
  calcUpdates,
  applyModelUpdate,
  withRetries,
  parseVersion,
};
