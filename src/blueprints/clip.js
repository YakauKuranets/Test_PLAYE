export const createClipBlueprint = () => ({
  name: "clip",
  init: ({ elements, state, actions }) => {
    elements.markInButton.addEventListener("click", () => {
      state.clipIn = elements.video.currentTime;
      elements.clipInValue.textContent = actions.formatTime(state.clipIn);
      actions.recordLog("clip-in", `Установлен IN: ${actions.formatTime(state.clipIn)}`, {
        time: state.clipIn,
      });
    });

    elements.markOutButton.addEventListener("click", () => {
      state.clipOut = elements.video.currentTime;
      elements.clipOutValue.textContent = actions.formatTime(state.clipOut);
      actions.recordLog("clip-out", `Установлен OUT: ${actions.formatTime(state.clipOut)}`, {
        time: state.clipOut,
      });
    });

    elements.exportClipButton.addEventListener("click", async () => {
      if (state.clipIn === null || state.clipOut === null || state.clipOut <= state.clipIn) {
        alert("Сначала задайте корректные IN и OUT.");
        return;
      }
      if (elements.video.readyState < 2) return;

      // Ensure captureStream API is available. This API is only available in
      // secure contexts and some browsers. Warn the user if unsupported.
      if (!elements.video.captureStream) {
        alert(
          "Ваш браузер не поддерживает captureStream() для экспорта нарезки. Попробуйте использовать актуальную версию Chromium или Firefox."
        );
        return;
      }

      const stream = elements.video.captureStream();
      // Determine a supported MIME type for MediaRecorder. Try VP9/VP8 first,
      // then plain WebM, then MP4 (if available).
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        const candidates = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
          'video/mp4',
        ];
        for (const candidate of candidates) {
          if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidate)) {
            mimeType = candidate;
            break;
          }
        }
      }
      let recorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (error) {
        console.error('MediaRecorder init failed', error);
        alert(
          'MediaRecorder не поддерживается в этом браузере. Экспорт нарезки недоступен.'
        );
        return;
      }
      const chunks = [];
      // Если доступен File System Access API, пишем клип на диск потоково,
      // чтобы не держать гигабайты в памяти.
      const canStreamSave =
        typeof window !== 'undefined' &&
        window.isSecureContext &&
        typeof window.showSaveFilePicker === 'function';
      let writable = null;
      let writeQueue = Promise.resolve();
      let streamingSaveEnabled = false;
      let streamingSaveName = null;
      let streamingWriteFailed = false;

      const pickStreamFile = async (type) => {
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const suggestedName = `clip-${Date.now()}.${ext}`;
        const accept = ext === 'mp4'
          ? { 'video/mp4': ['.mp4'] }
          : { 'video/webm': ['.webm'] };
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Видео', accept }],
        });
        const w = await handle.createWritable();
        return { w, suggestedName };
      };

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          if (streamingSaveEnabled && writable) {
            // Серийно пишем чанки в файл
            writeQueue = writeQueue
              .then(() => writable.write(event.data))
              .catch((err) => {
                console.error('Ошибка потоковой записи клипа:', err);
                streamingWriteFailed = true;
              });
          } else {
            chunks.push(event.data);
          }
        }
      });

      recorder.addEventListener('stop', async () => {
        // Determine output MIME type; fallback to the first chunk's type if available
        const type = mimeType || (chunks[0] && chunks[0].type) || 'video/webm';
        if (streamingSaveEnabled && writable) {
          try {
            await writeQueue;
            if (streamingWriteFailed) {
              try {
                await writable.abort();
              } catch (_) {}
              alert('Экспорт прерван: произошла ошибка потоковой записи. Посмотрите консоль для деталей.');
              actions.recordLog('clip-export-error', 'Ошибка потоковой записи клипа', {
                in: state.clipIn,
                out: state.clipOut,
                mimeType: type,
                file: streamingSaveName,
              });
              return;
            }
            await writable.close();
            actions.recordLog(
              'clip-export-stream',
              `Потоковый экспорт нарезки ${actions.formatTime(state.clipIn)} → ${actions.formatTime(
                state.clipOut
              )}`,
              {
                in: state.clipIn,
                out: state.clipOut,
                mimeType: type,
                file: streamingSaveName,
              }
            );
            return;
          } catch (err) {
            console.error('Потоковая запись не удалась, fallback на обычное скачивание', err);
          }
        }
        const blob = new Blob(chunks, { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        link.download = `clip-${Date.now()}.${ext}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
        actions.recordLog(
          'clip-export',
          `Экспорт нарезки ${actions.formatTime(state.clipIn)} → ${actions.formatTime(
            state.clipOut
          )}`,
          {
            in: state.clipIn,
            out: state.clipOut,
            mimeType: type,
          }
        );
      });

      elements.video.currentTime = state.clipIn;
      await elements.video.play();

      // Инициируем потоковую запись ДО старта recorder, чтобы на dataavailable
      // уже был открыт writable.
      if (canStreamSave) {
        try {
          const effectiveType = mimeType || 'video/webm';
          const picked = await pickStreamFile(effectiveType);
          writable = picked.w;
          streamingSaveName = picked.suggestedName;
          streamingSaveEnabled = true;
        } catch (err) {
          // Пользователь мог отменить диалог. Просто продолжаем в режиме
          // обычного скачивания (chunks в памяти).
          streamingSaveEnabled = false;
          writable = null;
        }
      }

      try {
        recorder.start();
      } catch (err) {
        console.error('Failed to start MediaRecorder', err);
        alert('Не удалось начать запись MediaRecorder. Экспорт прерван.');
        return;
      }

      const stopAt = () => {
        if (elements.video.currentTime >= state.clipOut) {
          try {
            recorder.stop();
          } catch (err) {
            console.error('Failed to stop MediaRecorder', err);
          }
          elements.video.pause();
          elements.video.removeEventListener('timeupdate', stopAt);
        }
      };

      elements.video.addEventListener('timeupdate', stopAt);
    });
  },
});
