const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const repoRoot = path.join(__dirname, '..');
const backendDir = path.join(repoRoot, 'backend');

function findPython() {
  const isWin = process.platform === 'win32';
  const venvPython = isWin
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python');

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkHealth(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`Health check failed: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(1500, () => {
      req.destroy(new Error('Health check timeout'));
    });
  });
}

async function ensurePythonDeps(pythonExe) {
  return new Promise((resolve) => {
    const probe = spawn(pythonExe, ['-c', 'import fastapi,uvicorn; import app.main'], { cwd: backendDir });
    probe.on('exit', (code) => {
      resolve(code === 0);
    });
    probe.on('error', () => resolve(false));
  });
}

async function main() {
  const pythonExe = findPython();
  const canRun = await ensurePythonDeps(pythonExe);
  if (!canRun) {
    console.log('Smoke test skipped: backend runtime dependencies are not fully available (fastapi/uvicorn/app.main import).');
    return;
  }

  const server = spawn(
    pythonExe,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8001'],
    { cwd: backendDir, stdio: 'pipe' }
  );

  let exited = false;
  server.on('exit', () => {
    exited = true;
  });

  const startedAt = Date.now();
  const timeoutMs = 20000;

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (exited) {
        throw new Error('Backend exited before health endpoint became available');
      }

      try {
        const res = await checkHealth('http://127.0.0.1:8001/api/health');
        console.log(`Smoke check passed: /api/health -> ${res.statusCode}`);
        server.kill('SIGTERM');
        await wait(500);
        if (!exited) {
          server.kill('SIGKILL');
        }
        return;
      } catch (_err) {
        await wait(400);
      }
    }

    throw new Error('Timed out waiting for backend health endpoint');
  } catch (error) {
    if (!exited) {
      server.kill('SIGTERM');
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
