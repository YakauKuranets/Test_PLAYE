import { ensureFfmpeg, transcodeToWebM } from '../models/loader.js';

export const createPlaylistBlueprint = () => ({
  name: "playlist",
  init: ({ elements, state, actions }) => {
    const setVideoSource = (file) => {
      // Revoke previous object URL to avoid leaking memory
      const prevUrl = elements.video.src;
      const url = URL.createObjectURL(file);
      elements.video.src = url;
      elements.video.dataset.filename = file.name;
      state.selectedImportedFileKey = file.__playlistKey || null;
      elements.video.load();
      actions.resetZoom();
      state.clipIn = null;
      state.clipOut = null;
      elements.clipInValue.textContent = actions.formatTime(state.clipIn);
      elements.clipOutValue.textContent = actions.formatTime(state.clipOut);
      actions.recordLog("video-select", `Выбран файл: ${file.name}`, {
        name: file.name,
        size: file.size,
        hash: file.hash || "—",
      });

      // After a slight delay revoke the previous URL (if any) to free memory
      if (prevUrl && prevUrl.startsWith('blob:')) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(prevUrl);
          } catch (err) {
            console.warn('Failed to revoke object URL', err);
          }
        }, 100);
      }
    };

    const addToPlaylist = async (file) => {
      // Если файл имеет неподдерживаемый кодек, попробуем переконвертировать его в WebM.
      try {
        const testVideo = document.createElement('video');
        // canPlayType возвращает "", "maybe" или "probably". Пустая строка означает отсутствие поддержки.
        const playable = testVideo.canPlayType(file.type || '');
        // Для очень больших файлов автоматическая переконвертация через FFmpeg.js
        // может съесть гигабайты RAM и повесить вкладку. Поэтому для больших
        // файлов сначала пробуем воспроизведение как есть.
        const LARGE_FILE_BYTES = 350 * 1024 * 1024; // 350MB
        if (!playable && file.size && file.size > LARGE_FILE_BYTES) {
          actions.recordLog(
            'transcode-skip-large',
            `Файл очень большой, авто‑перекодирование пропущено: ${file.name}`,
            { name: file.name, size: file.size, type: file.type || 'unknown' }
          );
        } else if (!playable) {
          // Загружаем FFmpeg и преобразуем файл в WebM/VP9. Если загрузка или
          // конверсия не удастся, вернётся исходный файл.
          file = await transcodeToWebM(file);
        }
      } catch (err) {
        console.warn('Ошибка при проверке или конвертации файла', err);
      }

      const item = document.createElement("li");
      item.textContent = file.name;
      const itemKey = `${file.name}::${file.size}::${Date.now()}::${Math.random().toString(16).slice(2)}`;
      file.__playlistKey = itemKey;
      const importedFile = {
        key: itemKey,
        name: file.name,
        size: file.size,
        type: file.type,
        hash: null,
        // Сохраняем ссылку на оригинальный объект File. Это позволит
        // повторно использовать файл, например, в модуле сравнения.
        file: file,
      };
      state.importedFiles.push(importedFile);
      const hash = await actions.hashFile(file);
      file.hash = hash;
      importedFile.hash = hash;
      actions.recordLog("file-hash", `Хэш SHA-256 рассчитан для ${file.name}`, {
        name: file.name,
        hash,
      });
      item.addEventListener("click", () => {
        document.querySelectorAll(".playlist li").forEach((node) => {
          node.classList.remove("active");
        });
        item.classList.add("active");
        setVideoSource(file);
      });
      elements.playlist.appendChild(item);
      if (!elements.video.src) {
        item.click();
      }
    };

    elements.fileInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length) {
        actions.recordLog("video-import", `Импортировано файлов: ${files.length}`, {
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        });
      }
      files.forEach((file) => {
        addToPlaylist(file);
      });
      elements.fileInput.value = "";
    });

    // Слушаем внутреннее событие добавления виртуального файла. Это событие
    // генерируется модулем гипотез, когда создаётся новый клип. Мы
    // оборачиваем обработчик в setTimeout, чтобы избежать конфликтов
    // с другими слушателями.
    document.addEventListener('playe:add-file', (evt) => {
      const detail = evt?.detail;
      const file = detail?.file;
      if (!file) return;
      // Добавляем файл как обычный импортируемый элемент.
      addToPlaylist(file);
    });
  },
});
