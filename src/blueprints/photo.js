/*
 * Photo reconstruction blueprint.
 *
 * This blueprint implements a simple interface for photo reconstruction. Users can
 * upload multiple images and generate an averaged output image. In future
 * iterations this can be extended to support advanced 3D reconstruction
 * algorithms such as NeRF or Gaussian Splatting. The averaged image is
 * produced by computing the per‑pixel mean across all selected images.
 */

export function createPhotoBlueprint() {
  return {
    init(elements, state, actions) {
      const photoOverlay = elements.photoOverlay;
      const startOverlay = elements.startOverlay;
      const input = elements.photoInput;
      const startBtn = elements.photoStart;
      const backBtn = elements.photoBack;
      const exportBtn = elements.photoExport;
      const importBtn = elements.photoImportBtn;
      const importInput = elements.photoImportInput;
      const statusEl = elements.photoStatus;
      const canvas = elements.photoCanvas;
      let ctx;

      if (canvas) {
        ctx = canvas.getContext('2d');
      }

      // Назад: вернуться к стартовому экрану и скрыть этот оверлей
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          if (photoOverlay) {
            photoOverlay.classList.add('hidden');
          }
          if (startOverlay) {
            startOverlay.style.display = 'flex';
          }
          // Сброс состояния
          statusEl.textContent = '';
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.width = 0;
            canvas.height = 0;
          }
          input.value = '';
        });
      }

      // Запуск реконструкции
      if (startBtn) {
        startBtn.addEventListener('click', async () => {
          if (!input || !input.files || input.files.length < 2) {
            statusEl.textContent = 'Выберите как минимум два изображения.';
            return;
          }
          const files = Array.from(input.files);
          statusEl.textContent = 'Загрузка и обработка изображений…';
          try {
            const images = await Promise.all(files.map(loadImage));
            // Выбираем минимальные размеры для усреднения, чтобы избежать обрезания
            const width = Math.min(...images.map(img => img.width));
            const height = Math.min(...images.map(img => img.height));
            // Настраиваем канвас
            canvas.width = width;
            canvas.height = height;
            if (!ctx) {
              ctx = canvas.getContext('2d');
            }
            // Создаём вспомогательный канвас
            const offCanvas = document.createElement('canvas');
            offCanvas.width = width;
            offCanvas.height = height;
            const offCtx = offCanvas.getContext('2d');
            const sum = new Float32Array(width * height * 4);
            images.forEach((img) => {
              offCtx.clearRect(0, 0, width, height);
              offCtx.drawImage(img, 0, 0, width, height);
              const data = offCtx.getImageData(0, 0, width, height).data;
              for (let i = 0; i < sum.length; i++) {
                sum[i] += data[i];
              }
            });
            const finalData = new Uint8ClampedArray(sum.length);
            const n = images.length;
            for (let i = 0; i < sum.length; i++) {
              finalData[i] = sum[i] / n;
            }
            const imgData = new ImageData(finalData, width, height);
            ctx.putImageData(imgData, 0, 0);
            statusEl.textContent = 'Реконструкция завершена. Полученное изображение отображено ниже.';
          } catch (err) {
            console.error(err);
            statusEl.textContent = 'Ошибка при обработке изображений: ' + err.message;
          }
        });
      }

      // Экспорт текущей реконструкции и исходных изображений в JSON
      if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
          // Ensure there is a reconstructed image to export
          if (!canvas || canvas.width === 0 || canvas.height === 0) {
            statusEl.textContent = 'Сначала выполните реконструкцию, чтобы экспортировать результат.';
            return;
          }
          try {
            // Gather original files as data URLs
            const files = input && input.files ? Array.from(input.files) : [];
            const originals = await Promise.all(
              files.map(async (file) => {
                const data = await fileToDataURL(file);
                return {
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  data,
                };
              })
            );
            // Get the reconstructed result as PNG Data URL
            const resultDataUrl = canvas.toDataURL('image/png');
            const payload = {
              createdAt: new Date().toISOString(),
              originals,
              result: resultDataUrl,
            };
            // Use actions.downloadJson to trigger a download
            actions.downloadJson(payload, 'photo-reconstruction');
            statusEl.textContent = 'Реконструкция экспортирована.';
          } catch (err) {
            console.error('Ошибка экспорта реконструкции', err);
            statusEl.textContent = 'Ошибка экспорта: ' + err.message;
          }
        });
      }

      // --- Расширенный экспорт кейса (дело целиком) ---
      // Предполагается, что в HTML существует кнопка с ID `photoCaseExport`
      // и кнопка `photoCaseImport` с соответствующими input type="file". Эти
      // элементы не создаются здесь, но если присутствуют, они позволят
      // сохранить полное дело (оригиналы, маски, результат, метаданные,
      // журнал действий) и восстановить его. Экспорт происходит в формате
      // JSON. Для ZIP‑экспорта можно подключить библиотеку JSZip в
      // будущем.
      const caseExportBtn = elements.photoCaseExport;
      const caseImportBtn = elements.photoCaseImport;
      const caseImportInput = elements.photoCaseImportInput;
      if (caseExportBtn) {
        caseExportBtn.addEventListener('click', async () => {
          // Проверяем наличие реконструкции
          if (!canvas || canvas.width === 0 || canvas.height === 0) {
            statusEl.textContent = 'Сначала выполните реконструкцию, чтобы экспортировать дело.';
            return;
          }
          try {
            // Собираем оригинальные файлы
            const files = input && input.files ? Array.from(input.files) : [];
            const originals = await Promise.all(
              files.map(async (file) => {
                const data = await fileToDataURL(file);
                return {
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  data,
                };
              })
            );
            // Результат реконструкции
            const resultDataUrl = canvas.toDataURL('image/png');
            // TODO: собрать маски и другие промежуточные артефакты, если будут добавлены
            const payload = {
              createdAt: new Date().toISOString(),
              type: 'photo-case',
              originals,
              result: resultDataUrl,
              // Зарезервировано под маски, отчёты, журналы
              masks: [],
              logs: [],
            };
            actions.downloadJson(payload, 'photo-case');
            statusEl.textContent = 'Дело экспортировано.';
          } catch (err) {
            console.error('Ошибка экспорта дела', err);
            statusEl.textContent = 'Ошибка экспорта дела: ' + err.message;
          }
        });
      }
      if (caseImportBtn && caseImportInput) {
        caseImportBtn.addEventListener('click', () => {
          caseImportInput.value = '';
          caseImportInput.click();
        });
        caseImportInput.addEventListener('change', async () => {
          const file = caseImportInput.files && caseImportInput.files[0];
          if (!file) return;
          try {
            const text = await file.text();
            const payload = JSON.parse(text);
            if (!payload || payload.type !== 'photo-case') {
              statusEl.textContent = 'Некорректный формат файла дела.';
              return;
            }
            // Восстановление изображения результата
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                if (!ctx) ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve();
              };
              img.onerror = reject;
              img.src = payload.result;
            });
            statusEl.textContent = 'Дело импортировано. Изображение восстановлено.';
          } catch (err) {
            console.error('Ошибка импорта дела', err);
            statusEl.textContent = 'Ошибка импорта дела: ' + err.message;
          } finally {
            caseImportInput.value = '';
          }
        });
      }

      // Импорт реконструкции из JSON файла
      if (importBtn && importInput) {
        importBtn.addEventListener('click', () => {
          importInput.value = '';
          importInput.click();
        });
        importInput.addEventListener('change', async () => {
          const file = importInput.files && importInput.files[0];
          if (!file) return;
          try {
            const text = await file.text();
            const payload = JSON.parse(text);
            if (!payload || !payload.result) {
              statusEl.textContent = 'Файл не содержит данных реконструкции.';
              return;
            }
            // Load the result image into the canvas
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                if (!ctx) ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve();
              };
              img.onerror = reject;
              img.src = payload.result;
            });
            // Optionally repopulate the input with original files (not possible due to file input security)
            statusEl.textContent = 'Реконструкция импортирована.';
          } catch (err) {
            console.error('Ошибка импорта реконструкции', err);
            statusEl.textContent = 'Ошибка импорта: ' + err.message;
          } finally {
            importInput.value = '';
          }
        });
      }

      // Утилита загрузки изображения. Возвращает объект Image.
      function loadImage(file) {
        return new Promise((resolve, reject) => {
          const url = URL.createObjectURL(file);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(new Error('Не удалось загрузить изображение ' + file.name));
          };
          img.src = url;
        });
      }

      // Утилита: конвертировать File в Data URL
      function fileToDataURL(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve(e.target.result);
          };
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });
      }
    },
  };
}