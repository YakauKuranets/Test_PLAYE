/*
 * 3D reconstruction blueprint.
 *
 * This blueprint enables a simple 3D reconstruction workflow: users can
 * select a depth map image, preview it as a greyscale height map on a
 * 2D canvas, export the depth values as a JSON point cloud, and
 * generate a rotating 3D point cloud in a WebGL canvas using
 * Three.js.  To keep the application responsive, the heavy logic
 * (Three.js import and rendering) is only invoked when the user
 * requests a 3D preview.
 */

export function create3DReconstructionBlueprint() {
  return {
    init(elements, state, actions) {
      const overlay = elements.recon3dOverlay;
      const startOverlay = elements.startOverlay;
      const startBtn = elements.start3D;
      const backBtn = elements.recon3dBack;
      const input = elements.recon3dInput;
      const previewCanvas = elements.recon3dCanvas;
      const view3dContainer = elements.recon3dView3d;
      const exportBtn = elements.recon3dExport;
      const previewBtn = elements.recon3d3dPreview;
      const statusEl = elements.recon3dStatus;
      let ctx;

      if (previewCanvas) {
        ctx = previewCanvas.getContext('2d');
      }

      // Ensure Three.js is loaded, first attempting to import from the
      // local libs folder and falling back to a CDN.  The imported
      // module attaches a global THREE object.
      async function ensureThree() {
        if (typeof window === 'undefined') return undefined;
        if (window.THREE) return window.THREE;
        try {
          // Try to import from the local libs directory.  Blueprint files
          // reside in src/blueprints, so the relative path to libs is
          // two levels up.
          await import('../../libs/three.min.js');
        } catch (localErr) {
          console.warn('Failed to load local Three.js', localErr);
          try {
            // Load from a CDN as a module.  Use a specific version to
            // prevent unexpected breaking changes.
            await import('https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js');
          } catch (cdnErr) {
            console.error('Failed to load Three.js from CDN', cdnErr);
          }
        }
        return window.THREE;
      }

      // Convert the depth map on the preview canvas into a 3D point cloud
      // and render it using Three.js.  Points are coloured based on the
      // image colour (assuming the source image encodes intensity in the
      // red channel).  The point cloud rotates slowly for better
      // visualisation.
      async function renderPointCloud() {
        if (!ctx || previewCanvas.width === 0 || previewCanvas.height === 0) {
          statusEl.textContent = 'Сначала загрузите карту глубины.';
          return;
        }
        const width = previewCanvas.width;
        const height = previewCanvas.height;
        const imageData = ctx.getImageData(0, 0, width, height).data;
        const positions = [];
        const colors = [];
        // Normalize coordinates: centre point cloud at origin and
        // invert y to match canvas coordinate system.
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = imageData[idx] / 255;
            const g = imageData[idx + 1] / 255;
            const b = imageData[idx + 2] / 255;
            const depth = r; // assume red channel encodes depth
            // positions: scale x,y into [-0.5, 0.5] range and use depth as z
            positions.push((x / width) - 0.5);
            positions.push(((height - y) / height) - 0.5);
            positions.push(depth * 0.5); // scale depth for visibility
            colors.push(r, g, b);
          }
        }
        // Load Three.js
        const THREE = await ensureThree();
        if (!THREE) {
          statusEl.textContent = 'Three.js не удалось загрузить.';
          return;
        }
        // Clear previous content
        while (view3dContainer.firstChild) {
          view3dContainer.removeChild(view3dContainer.firstChild);
        }
        // Create scene, camera, geometry and renderer
        const scene = new THREE.Scene();
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
        const material = new THREE.PointsMaterial({ size: 1.5, vertexColors: true });
        const points = new THREE.Points(geometry, material);
        scene.add(points);
        // Perspective camera covering the point cloud
        const aspect = view3dContainer.clientWidth / view3dContainer.clientHeight || 1;
        const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10);
        camera.position.z = 2;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(view3dContainer.clientWidth, view3dContainer.clientHeight);
        view3dContainer.appendChild(renderer.domElement);
        // Rotate cloud continuously
        function animate() {
          requestAnimationFrame(animate);
          points.rotation.y += 0.004;
          renderer.render(scene, camera);
        }
        animate();
        statusEl.textContent = '3D точечное облако построено.';
      }

      // Load image file to the preview canvas and draw it
      async function handleFile(file) {
        try {
          const img = await loadImage(file);
          previewCanvas.width = img.width;
          previewCanvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          statusEl.textContent = 'Карта глубины загружена. Постройте point cloud или 3D.';
        } catch (err) {
          console.error(err);
          statusEl.textContent = 'Ошибка загрузки изображения: ' + err.message;
        }
      }

      // Utility to load an image file and resolve with an Image object
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
            reject(err);
          };
          img.src = url;
        });
      }

      // Build point cloud as JSON: use pixel red channel as depth and
      // export as array of { x, y, z } objects
      function exportPointCloud() {
        if (!ctx || previewCanvas.width === 0) {
          statusEl.textContent = 'Сначала загрузите карту глубины.';
          return;
        }
        const { width, height } = previewCanvas;
        const data = ctx.getImageData(0, 0, width, height).data;
        const points = [];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const depth = data[idx] / 255;
            points.push({ x, y, z: depth });
          }
        }
        const payload = { createdAt: new Date().toISOString(), points };
        actions.downloadJson(payload, 'point-cloud');
        statusEl.textContent = 'Point cloud экспортирован.';
      }

      // Event listeners
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          if (startOverlay) startOverlay.style.display = 'none';
          if (overlay) overlay.classList.remove('hidden');
          // Reset status and clear previous preview
          if (statusEl) statusEl.textContent = '';
          if (ctx) {
            ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
          }
          while (view3dContainer && view3dContainer.firstChild) {
            view3dContainer.removeChild(view3dContainer.firstChild);
          }
        });
      }
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          if (overlay) overlay.classList.add('hidden');
          if (startOverlay) startOverlay.style.display = 'flex';
        });
      }
      if (input) {
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (file) {
            handleFile(file);
          }
        });
      }
      if (exportBtn) {
        exportBtn.addEventListener('click', exportPointCloud);
      }
      if (previewBtn) {
        previewBtn.addEventListener('click', renderPointCloud);
      }
    },
  };
}