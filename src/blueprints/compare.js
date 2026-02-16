// Blueprint for side‑by‑side comparison of two clips.
//
// This module adds a UI that lets the user select two files from the
// playlist (for example, оригинал и гипотеза) and display them side by
// side. When playback is started via the "Показать" button, both videos
// will play simultaneously, and their currentTime and playbackRate are
// synchronised. The blueprint listens for imports to refresh the select
// options. Files are identified by their internal key property, as
// assigned in the playlist blueprint.

export const createCompareBlueprint = () => ({
  name: 'compare',
  init: ({ elements, state, actions }) => {
    const selectA = elements.compareFileA;
    const selectB = elements.compareFileB;
    const startBtn = elements.compareStart;
    const container = elements.compareContainer;
    const videoA = elements.compareVideoA;
    const videoB = elements.compareVideoB;

    if (!selectA || !selectB || !startBtn || !container) return;

    // Helper to find a file object by key in state.importedFiles
    function getFileByKey(key) {
      const files = state.importedFiles || [];
      return files.find((f) => f.key === key)?.file || null;
    }

    // Refresh the select options using current imported files. We display
    // the file name and use its key as the option value.
    function refreshOptions() {
      const files = state.importedFiles || [];
      // Remove existing options
      selectA.innerHTML = '';
      selectB.innerHTML = '';
      files.forEach((f) => {
        const optA = document.createElement('option');
        optA.value = f.key;
        optA.textContent = f.name;
        selectA.appendChild(optA);
        const optB = document.createElement('option');
        optB.value = f.key;
        optB.textContent = f.name;
        selectB.appendChild(optB);
      });
    }

    // Listen for imports and playlist updates to refresh options. We hook
    // into the custom `playe:add-file` event as well as an observer on
    // state.importedFiles length. Whenever a new file is added, we call
    // refreshOptions().
    document.addEventListener('playe:add-file', () => {
      refreshOptions();
    });
    // Also refresh on initial load
    refreshOptions();

    // Synchronise the current time and rate of two videos. When one video
    // seeks or plays, update the other. Use a guard to avoid infinite
    // feedback loops.
    let syncing = false;
    function sync(target, follower) {
      if (syncing) return;
      syncing = true;
      follower.currentTime = target.currentTime;
      follower.playbackRate = target.playbackRate;
      if (!target.paused && follower.paused) {
        follower.play();
      } else if (target.paused && !follower.paused) {
        follower.pause();
      }
      syncing = false;
    }

    function startComparison() {
      const keyA = selectA.value;
      const keyB = selectB.value;
      const fileA = getFileByKey(keyA);
      const fileB = getFileByKey(keyB);
      if (!fileA || !fileB) {
        alert('Пожалуйста, выберите два файла для сравнения.');
        return;
      }
      // Create object URLs for both videos
      const urlA = URL.createObjectURL(fileA);
      const urlB = URL.createObjectURL(fileB);
      videoA.src = urlA;
      videoB.src = urlB;
      // When the videos end, stop both
      const onEnded = () => {
        videoA.pause();
        videoB.pause();
      };
      videoA.addEventListener('ended', onEnded);
      videoB.addEventListener('ended', onEnded);
      // Sync events
      videoA.addEventListener('play', () => sync(videoA, videoB));
      videoB.addEventListener('play', () => sync(videoB, videoA));
      videoA.addEventListener('pause', () => sync(videoA, videoB));
      videoB.addEventListener('pause', () => sync(videoB, videoA));
      videoA.addEventListener('ratechange', () => sync(videoA, videoB));
      videoB.addEventListener('ratechange', () => sync(videoB, videoA));
      videoA.addEventListener('timeupdate', () => sync(videoA, videoB));
      videoB.addEventListener('timeupdate', () => sync(videoB, videoA));
      // Show container and load videos
      container.classList.remove('hidden');
      videoA.load();
      videoB.load();
    }

    startBtn.addEventListener('click', () => {
      startComparison();
    });
  },
});