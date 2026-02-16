export const createScreenshotBlueprint = () => ({
  name: "screenshot",
  init: ({ elements, actions }) => {
    elements.screenshotButton.addEventListener("click", () => {
      if (elements.video.readyState < 2) return;
      const timecode = actions.formatTime(elements.video.currentTime);
      elements.captureCanvas.width = elements.video.videoWidth;
      elements.captureCanvas.height = elements.video.videoHeight;
      const context = elements.captureCanvas.getContext("2d");
      context.drawImage(
        elements.video,
        0,
        0,
        elements.captureCanvas.width,
        elements.captureCanvas.height
      );
      elements.captureCanvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `screenshot-${Date.now()}.png`;
        link.click();
        // release object URL after a short delay to free memory
        setTimeout(() => URL.revokeObjectURL(url), 100);
        actions.recordLog('screenshot', `Скриншот на ${timecode}`, {
          time: elements.video.currentTime,
        });
      });
    });
  },
});
