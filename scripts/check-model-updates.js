const { readLocalManifest, loadRemoteManifest, calcUpdates } = require('./model-updater');

async function main() {
  const localManifest = readLocalManifest();
  const manifestUrl = process.env.MODEL_MANIFEST_URL;

  if (!manifestUrl) {
    const names = Object.keys(localManifest.models || {});
    console.log('MODEL_MANIFEST_URL is not set. Showing local models only.');
    if (names.length === 0) {
      console.log('No models are registered in local manifest.');
      return;
    }

    console.log(`Local manifest version: ${localManifest.version}`);
    for (const name of names) {
      const model = localManifest.models[name];
      console.log(`- ${name}: v${model.version}, file=${model.file}`);
    }
    return;
  }

  const remoteManifest = await loadRemoteManifest(manifestUrl);
  const updates = calcUpdates(localManifest, remoteManifest);

  if (updates.length === 0) {
    console.log('✅ All models are up to date.');
    return;
  }

  console.log(`📦 Available updates: ${updates.length}`);
  for (const item of updates) {
    const from = item.currentVersion || 'not installed';
    console.log(`- ${item.name}: ${from} -> ${item.nextVersion}`);
  }
}

main().catch((error) => {
  console.error(`Failed to check model updates: ${error.message}`);
  process.exitCode = 1;
});
