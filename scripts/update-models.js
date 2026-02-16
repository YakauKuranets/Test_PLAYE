const {
  readLocalManifest,
  loadRemoteManifest,
  calcUpdates,
  applyModelUpdate,
} = require('./model-updater');

async function main() {
  const manifestUrl = process.env.MODEL_MANIFEST_URL;
  if (!manifestUrl) {
    throw new Error('MODEL_MANIFEST_URL is required for updates');
  }

  const local = readLocalManifest();
  const remote = await loadRemoteManifest(manifestUrl);
  const updates = calcUpdates(local, remote);

  if (updates.length === 0) {
    console.log('All models are up to date.');
    return;
  }

  for (const model of updates) {
    process.stdout.write(`Updating ${model.name}...\n`);
    await applyModelUpdate(model, ({ received, total }) => {
      if (!total) return;
      const percent = Math.floor((received / total) * 100);
      process.stdout.write(`\r${model.name}: ${percent}%`);
    });
    process.stdout.write(`\r${model.name}: done\n`);
  }

  console.log(`Updated ${updates.length} model(s).`);
}

main().catch((error) => {
  console.error(`Model update failed: ${error.message}`);
  process.exitCode = 1;
});
