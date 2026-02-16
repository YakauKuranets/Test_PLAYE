// Blueprint for hypothetical scenario generation
//
// Этот модуль реализует генерацию "гипотез‑клипов" поверх выбранного
// видео. Доступные режимы:
//  - restore: копирует кадры без изменений.
//  - alternate: выполняет лёгкие сдвиги и повороты.
//  - superres: применяет модель супер‑резолюции (см. src/models/loader.js).
//  - denoise: выполняет простое шумоподавление (box blur).
//  - deblur: выполняет простое повышение резкости (sharpen).
//  - detect: использует модель COCO‑SSD для детекции объектов и
//            рисует рамки поверх оригинала (работает в WebWorker).
//  - 3d: создаёт грубую 3D‑карту яркости кадра в виде столбиков.
// Получившийся клип сохраняется в формате WebM и помещается в плейлист
// через механизм actions.addVirtualFile(). Реальное подключение нейросетей
// для денойзинга, деблюринга или 3D рекострукции может быть добавлено
// впоследствии.

// Импортируем функцию супер‑резолюции. Она загружает модель по
// требованию и возвращает upscale результата либо null, если
// модель недоступна.
import { superResolve } from '../models/loader.js';

export const createHypothesisBlueprint = () => ({
  name: "hypothesis",
  init: ({ elements, state, actions }) => {
    const generateBtn = elements.hypothesisGenerate;
    if (!generateBtn) return;
    const progressEl = document.getElementById("hypothesis-progress");
    const statusEl = elements.hypothesisStatus;

    const updateStatus = (msg) => {
      if (statusEl) statusEl.textContent = msg;
    };

    // -------------------------------------------------------------------------
    // Object detection worker setup
    // Create a WebWorker for running COCO‑SSD object detection. Each
    // detection request is identified by a monotonically increasing id. When
    // the worker responds, the stored promise resolver is invoked with the
    // predictions. If loading of the worker fails (e.g. due to CSP or network
    // restrictions) the detection functions will silently return an empty
    // array.
    let detectWorker = null;
    let detectionId = 0;
    const pendingDetections = new Map();
    try {
      detectWorker = new Worker(new URL('../workers/objectDetectionWorker.js', import.meta.url), { type: 'module' });
      detectWorker.onmessage = (e) => {
        const { id, predictions } = e.data;
        const resolver = pendingDetections.get(id);
        if (resolver) {
          resolver(predictions || []);
          pendingDetections.delete(id);
        }
      };
    } catch (err) {
      console.warn('Не удалось создать worker для детекции объектов:', err);
    }

    // -------------------------------------------------------------------------
    // Image processing worker setup
    // This worker performs denoise and deblur operations off the main thread.
    let imageWorker = null;
    let imageJobId = 0;
    const pendingImageJobs = new Map();
    try {
      imageWorker = new Worker(new URL('../workers/imageProcessingWorker.js', import.meta.url), { type: 'module' });
      imageWorker.onmessage = (e) => {
        const { id, result } = e.data;
        const resolver = pendingImageJobs.get(id);
        if (resolver) {
          resolver(result);
          pendingImageJobs.delete(id);
        }
      };
    } catch (err) {
      console.warn('Не удалось создать worker для обработки изображений:', err);
    }

    /**
     * Offload denoise or deblur operation to the image processing worker. If the
     * worker is unavailable or fails, resolve with the original image data.
     *
     * @param {ImageData} frameData The frame to process
     * @param {string} op The operation: 'denoise' or 'deblur'
     * @returns {Promise<ImageData>}
     */
    const runImageProcessing = (frameData, op) => {
      return new Promise((resolve) => {
        if (!imageWorker || (op !== 'denoise' && op !== 'deblur')) {
          resolve(frameData);
          return;
        }
        const id = imageJobId++;
        pendingImageJobs.set(id, (result) => {
          try {
            const newData = new Uint8ClampedArray(result);
            resolve(new ImageData(newData, frameData.width, frameData.height));
          } catch (err) {
            resolve(frameData);
          }
        });
        try {
          // Transfer the underlying buffer to avoid copying. Note: frameData.data
          // is detached after transfer, so callers should not use it afterwards.
          imageWorker.postMessage({ id, type: op, width: frameData.width, height: frameData.height, data: frameData.data.buffer }, [frameData.data.buffer]);
        } catch (err) {
          pendingImageJobs.delete(id);
          resolve(frameData);
        }
      });
    };

    /**
     * Запросить детекцию объектов для переданных данных кадра. Возвращает
     * массив предсказаний или пустой массив при ошибке или недоступности
     * модели. Кадр передаётся в воркер вместе с размерностями. Когда
     * модель недоступна, функция сразу возвращает пустой массив.
     *
     * @param {ImageData} frameData The image data to analyse
     * @returns {Promise<Array<{bbox: number[], class: string, score: number}>>}
     */
    const runDetection = (frameData) => {
      return new Promise((resolve) => {
        if (!detectWorker) {
          resolve([]);
          return;
        }
        const id = detectionId++;
        pendingDetections.set(id, resolve);
        try {
          // Передаём копию массива, чтобы основная память не была
          // отдетачена. Пересоздавать новый Uint8ClampedArray быстро, так
          // как массив небольшой. Не используем передачу ownership.
          const copy = new Uint8ClampedArray(frameData.data);
          detectWorker.postMessage({ id, width: frameData.width, height: frameData.height, data: copy }, []);
        } catch (err) {
          console.warn('Не удалось отправить данные для детекции:', err);
          pendingDetections.delete(id);
          resolve([]);
        }
      });
    };

    generateBtn.addEventListener("click", async () => {
      const type = elements.hypothesisType?.value || "restore";
      const lengthSec = parseFloat(elements.hypothesisLength?.value) || 5;
      const video = elements.video;

      if (!video || !video.videoWidth || !video.videoHeight) {
        alert("Сначала выберите видео в плейлисте.");
        return;
      }

      // При выборе типа restore оставляем масштаб единичным. Для superres
      // увеличиваем в 2 раза. В будущем здесь можно использовать
      // пользовательский коэффициент или параметры модели.
      const scale = type === "superres" ? 2 : 1;
      // Частота кадров для записи. Чем выше fps, тем плавнее видео,
      // но тем больше итоговый файл. Для суперрезолюции ставим 20fps.
      const fps = scale > 1 ? 20 : 15;
      const framesTotal = Math.floor(lengthSec * fps);

      // Канвас захвата исходного кадра.
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const captureCtx = captureCanvas.getContext("2d");

      // Канвас для вывода. Если scale > 1, увеличиваем размеры.
      const outCanvas = document.createElement("canvas");
      outCanvas.width = video.videoWidth * scale;
      outCanvas.height = video.videoHeight * scale;
      const outCtx = outCanvas.getContext("2d");
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = "high";

      // Показываем прогресс бар и сбрасываем статус
      if (progressEl) {
        progressEl.style.display = "block";
        progressEl.max = 100;
        progressEl.value = 0;
      }
      updateStatus(`Создание клипа…`);

      // Настройки MediaRecorder. Пробуем VP9, затем VP8, иначе generic WebM.
      const stream = outCanvas.captureStream(fps);
      const chunks = [];
      const options = {};
      if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
        options.mimeType = "video/webm;codecs=vp9";
      } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
        options.mimeType = "video/webm;codecs=vp8";
      } else {
        options.mimeType = "video/webm";
      }
      const recorder = new MediaRecorder(stream, options);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Сохраняем состояние воспроизведения видео
      const startTime = video.currentTime;
      const wasPaused = video.paused;
      const originalRate = video.playbackRate;

      recorder.start();
      // Запускаем видео. Если оно уже воспроизводится, ничего страшного.
      video.playbackRate = 1;
      if (video.paused) {
        try {
          await video.play();
        } catch (err) {
          /* ignore */
        }
      }

      // Helper functions for simple spatial filters (denoise/deblur)
      const applyBoxBlur = (imageData) => {
        const { width, height, data } = imageData;
        const output = new Uint8ClampedArray(data.length);
        const kernel = [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ];
        const kSum = 9;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const ix = Math.min(width - 1, Math.max(0, x + kx));
                const iy = Math.min(height - 1, Math.max(0, y + ky));
                const idx = (iy * width + ix) * 4;
                const weight = kernel[ky + 1][kx + 1];
                r += data[idx] * weight;
                g += data[idx + 1] * weight;
                b += data[idx + 2] * weight;
                a += data[idx + 3] * weight;
              }
            }
            const outIdx = (y * width + x) * 4;
            output[outIdx] = r / kSum;
            output[outIdx + 1] = g / kSum;
            output[outIdx + 2] = b / kSum;
            output[outIdx + 3] = a / kSum;
          }
        }
        return new ImageData(output, width, height);
      };
      const applySharpen = (imageData) => {
        const { width, height, data } = imageData;
        const output = new Uint8ClampedArray(data.length);
        // Simple sharpen kernel
        const kernel = [
          [0, -1, 0],
          [-1, 5, -1],
          [0, -1, 0],
        ];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const ix = Math.min(width - 1, Math.max(0, x + kx));
                const iy = Math.min(height - 1, Math.max(0, y + ky));
                const idx = (iy * width + ix) * 4;
                const weight = kernel[ky + 1][kx + 1];
                r += data[idx] * weight;
                g += data[idx + 1] * weight;
                b += data[idx + 2] * weight;
                a += data[idx + 3] * weight;
              }
            }
            const outIdx = (y * width + x) * 4;
            // Clamp values to [0,255]
            output[outIdx] = Math.max(0, Math.min(255, r));
            output[outIdx + 1] = Math.max(0, Math.min(255, g));
            output[outIdx + 2] = Math.max(0, Math.min(255, b));
            output[outIdx + 3] = Math.max(0, Math.min(255, a));
          }
        }
        return new ImageData(output, width, height);
      };

      for (let i = 0; i < framesTotal; i++) {
        // Захватываем текущий кадр в canvas
        captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
        // Выбираем алгоритм в зависимости от режима. Для супер‑резолюции
        // пытаемся использовать модель через superResolve(); если
        // возвращается null, используем обычное масштабирование.
        if (type === 'alternate') {
          // Альтернативный вариант: лёгкий поворот и сдвиг
          const angle = Math.sin((i / framesTotal) * Math.PI * 2) * 0.05;
          const dx = Math.sin((i / framesTotal) * Math.PI) * 5;
          const dy = Math.cos((i / framesTotal) * Math.PI) * 5;
          outCtx.save();
          outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
          outCtx.translate(outCanvas.width / 2 + dx, outCanvas.height / 2 + dy);
          outCtx.rotate(angle);
          outCtx.drawImage(
            captureCanvas,
            -captureCanvas.width * scale / 2,
            -captureCanvas.height * scale / 2,
            captureCanvas.width * scale,
            captureCanvas.height * scale
          );
          outCtx.restore();
        } else if (type === 'denoise' || type === 'deblur') {
          // Обработка кадра в отдельном воркере: denoise или deblur
          const frameData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
          try {
            const processed = await runImageProcessing(frameData, type);
            outCanvas.width = processed.width;
            outCanvas.height = processed.height;
            outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
            outCtx.putImageData(processed, 0, 0);
          } catch (err) {
            // Fallback: просто скопировать кадр
            outCanvas.width = captureCanvas.width;
            outCanvas.height = captureCanvas.height;
            outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
            outCtx.drawImage(captureCanvas, 0, 0);
          }
        } else if (type === 'detect') {
          // Детекция объектов: выводим исходный кадр в outCanvas и рисуем
          // рамки поверх него. Детекция выполняется в воркере. Масштаб
          // равен 1, потому что мы не изменяем размер кадра.
          outCanvas.width = captureCanvas.width;
          outCanvas.height = captureCanvas.height;
          outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
          outCtx.drawImage(captureCanvas, 0, 0);
          try {
            const frameData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
            const predictions = await runDetection(frameData);
            // Рисуем рамки и подписи
            outCtx.lineWidth = 2;
            outCtx.font = '12px sans-serif';
            for (const pred of predictions) {
              const [x, y, w, h] = pred.bbox;
              outCtx.strokeStyle = 'red';
              outCtx.fillStyle = 'red';
              outCtx.strokeRect(x, y, w, h);
              const label = `${pred.class} (${(pred.score * 100).toFixed(0)}%)`;
              outCtx.fillText(label, x + 4, y + 14);
            }
          } catch (err) {
            console.warn('Ошибка детекции:', err);
          }
        } else if (type === '3d') {
          // Простейшая 3D визуализация: строим карту яркости в виде
          // столбиков. Размеры outCanvas подгоняем под исходный кадр.
          outCanvas.width = captureCanvas.width;
          outCanvas.height = captureCanvas.height;
          const frameData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
          // Настройка размера сетки для высот: меньше значение — меньше
          // вычислений и крупнее столбики. 32×32 хорошо смотрится.
          const gridSize = 32;
          const cellW = outCanvas.width / gridSize;
          const cellH = outCanvas.height / gridSize;
          // Очистим канвас и закрасим белым фон
          outCtx.fillStyle = 'white';
          outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
          // Проходим по сетке и вычисляем среднюю яркость в каждой ячейке
          for (let gy = 0; gy < gridSize; gy++) {
            for (let gx = 0; gx < gridSize; gx++) {
              let sum = 0;
              let count = 0;
              const startX = Math.floor((gx * captureCanvas.width) / gridSize);
              const endX = Math.floor(((gx + 1) * captureCanvas.width) / gridSize);
              const startY = Math.floor((gy * captureCanvas.height) / gridSize);
              const endY = Math.floor(((gy + 1) * captureCanvas.height) / gridSize);
              for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                  const idx = (y * captureCanvas.width + x) * 4;
                  const r = frameData.data[idx];
                  const g = frameData.data[idx + 1];
                  const b = frameData.data[idx + 2];
                  // Luma approximation
                  const l = 0.299 * r + 0.587 * g + 0.114 * b;
                  sum += l;
                  count++;
                }
              }
              const avg = count > 0 ? sum / count : 0;
              // Высота столбика: до половины высоты канваса
              const maxHeight = outCanvas.height / 2;
              const barHeight = (avg / 255) * maxHeight;
              // Вычисляем координаты отрисовки: столбик растёт вверх от нижней
              // границы экрана
              const xPos = gx * cellW;
              const yPos = outCanvas.height - barHeight;
              // Чем ярче область, тем темнее цвет столбика
              const shade = Math.floor(avg);
              outCtx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
              outCtx.fillRect(xPos, yPos, cellW - 1, barHeight);
              // Тонкая линия для трёхмерного эффекта
              outCtx.strokeStyle = 'rgba(0,0,0,0.1)';
              outCtx.strokeRect(xPos, yPos, cellW - 1, barHeight);
            }
          }
        } else if (scale > 1 && type === 'superres') {
          // Супер‑резолюция: используем нейросеть для улучшения
          let applied = false;
          try {
            // Получаем данные кадра и передаём на обработку
            const frameData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
            const result = await superResolve(frameData, 'superres');
            if (result) {
              // Масштаб меняется в зависимости от модели. Пересоздаём холст
              if (outCanvas.width !== result.width || outCanvas.height !== result.height) {
                outCanvas.width = result.width;
                outCanvas.height = result.height;
              }
              const imgData = new ImageData(result.data, result.width, result.height);
              outCtx.putImageData(imgData, 0, 0);
              applied = true;
            }
          } catch (err) {
            console.warn('Не удалось применить супер‑резолюцию:', err);
          }
          if (!applied) {
            // Fall back to простое масштабирование
            outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
            outCtx.drawImage(
              captureCanvas,
              0,
              0,
              captureCanvas.width,
              captureCanvas.height,
              0,
              0,
              outCanvas.width,
              outCanvas.height
            );
          }
        } else {
          // Режим restore (без изменений)
          outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
          outCtx.drawImage(captureCanvas, 0, 0, outCanvas.width, outCanvas.height);
        }
        // Обновляем прогресс
        if (progressEl) {
          progressEl.value = Math.min(100, Math.round(((i + 1) / framesTotal) * 100));
        }
        // Ждём следующего кадра. Используем setTimeout, чтобы запись не
        // перегружала главный поток.
        await new Promise((res) => setTimeout(res, 1000 / fps));
      }

      recorder.stop();
      // Ждём завершения остановки
      await new Promise((res) => {
        recorder.onstop = res;
      });

      // Возвращаем видео в исходное состояние
      video.playbackRate = originalRate;
      if (wasPaused) {
        video.pause();
        video.currentTime = startTime;
      }

      const blob = new Blob(chunks, { type: options.mimeType });
      const fileName = `hypothesis-${type}-${Date.now()}.webm`;
      const file = new File([blob], fileName, { type: blob.type });
      // Добавляем клип в плейлист
      await actions.addVirtualFile(file);
      actions.recordLog(
        "hypothesis-generate",
        `Создана гипотеза (${type})`,
        {
          type,
          length: lengthSec,
          frames: framesTotal,
          scale,
          mime: blob.type,
        }
      );

      updateStatus(`Готово: создан файл ${fileName}`);
      if (progressEl) {
        progressEl.style.display = "none";
      }
    });
  },
});