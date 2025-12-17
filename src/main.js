import * as THREE from 'three';
import { SceneManager } from './scene.js';
import { ModeManager, Modes } from './tools/modes.js';
import { Toolbar } from './tools/toolbar.js';
import { ShortcutsManager } from './tools/shortcuts.js';
import { ImagePlane } from './geometry/plane.js';
import { EditableMesh } from './geometry/face.js';
import { HistoryManager } from './history/undo.js';
import { StorageManager } from './storage/local.js';
import { PerspectiveOverlay } from './perspective/overlay.js';
import { AlignmentPanel } from './perspective/alignPanel.js';
import { perspectiveTransform, isOpenCVReady, waitForOpenCV } from './perspective/dewarp.js';
import { CutOverlay, sliceMesh } from './geometry/cut.js';
import { SelectTool } from './tools/select.js';
import { ExtrudeTool, extrudeFace, extrudeFaces } from './geometry/extrude.js';
import { InsetTool, insetFace, insetFaces } from './geometry/inset.js';
import { downloadOBJ } from './export/obj.js';

/**
 * Main Application class
 * Coordinates all components of ImageModel
 */
class App {
  constructor() {
    // Get canvas elements
    this.canvas = document.getElementById('canvas');
    this.overlayCanvas = document.getElementById('overlay');

    // Initialize managers
    this.scene = new SceneManager(this.canvas);
    this.modeManager = new ModeManager();
    this.history = new HistoryManager();
    this.storage = new StorageManager();

    // Initialize UI
    this.toolbar = new Toolbar(this);
    this.shortcuts = new ShortcutsManager(this);

    // Setup shortcuts button
    document.getElementById('btn-shortcuts').addEventListener('click', () => {
      this.shortcuts.toggle();
    });

    // Initialize tools
    // Legacy overlay (kept for compatibility)
    this.perspectiveOverlay = new PerspectiveOverlay(this.overlayCanvas, this.scene);

    // New split-panel alignment
    this.alignmentPanel = new AlignmentPanel();
    this.alignmentPanel.onPointsChange = (data) => this.onAlignmentPointsChange(data);
    this.alignmentPanel.onConfirm = (data) => this.onAlignmentConfirm(data);
    this.alignmentPanel.onSkip = () => this.skipPerspective();

    this.cutOverlay = new CutOverlay(this.overlayCanvas, this.scene);
    this.cutOverlay.onCutComplete = (point1, point2) => {
      // 1. Get current faces
      const currentFaces = this.editableMesh.faces;

      // 2. Run the slice
      const updatedFaces = sliceMesh(currentFaces, point1, point2);

      // 3. Update the mesh
      this.editableMesh.faces = updatedFaces;

      // 4. Update nextFaceId to avoid ID collisions with subsequent operations
      this.editableMesh.nextFaceId = Math.max(...updatedFaces.map(f => f.id)) + 1;

      // 5. Merge duplicate vertices created by the cut
      this.editableMesh.mergeVertices();

      this.editableMesh.rebuildMesh();

      // 6. Save state for undo
      this.history.pushState(this.getSerializableState(), 'Cut faces');
    };
    this.cutOverlay.onReady = () => {
      this.showApproveButton(
        () => this.cutOverlay.executePendingCut(),
        'Cut',
        () => this.cutOverlay.cancelPendingCut()
      );
    };

    this.selectTool = new SelectTool(this.scene);
    this.selectTool.onSelect = (faces) => this.onFacesSelected(faces);

    this.extrudeTool = new ExtrudeTool(this.scene, this.selectTool);
    this.extrudeTool.onExtrudeComplete = (faces, distance) => this.onExtrudeComplete(faces, distance);
    this.extrudeTool.onFaceSelected = (faces) => {
      this.selectedFaces = faces;
      this.updateUI();
    };

    this.insetTool = new InsetTool(this.scene, this.selectTool);
    this.insetTool.onInsetComplete = (faces, thickness, individualMode) => this.onInsetComplete(faces, thickness, individualMode);
    this.insetTool.onFaceSelected = (faces) => {
      this.selectedFaces = faces;
      this.updateUI();
    };

    // State
    this.imagePlane = null;
    this.editableMesh = null;
    this.hasImage = false;
    this.hasMesh = false;
    this.selectedFaces = [];
    this.gridSnap = false;

    // Image/texture data
    this.currentImageData = null;
    this.currentImageElement = null;
    this.correctedCanvas = null;

    // Recent images (max 9) - stored in IndexedDB
    this.imageDB = null;
    this.recentImages = this.loadRecentImages();

    // Initialize IndexedDB asynchronously
    this.initImageDB().then(() => {
      console.log('ImageDB initialized');
    });

    // Pending action for approve button
    this.pendingAction = null;
    this.pendingPerspectivePoints = null;
    this.ratioScale = 1.0;

    // UI elements
    this.approveBtn = document.getElementById('btn-approve');
    this.skipBtn = document.getElementById('btn-skip');
    this.recentPanel = document.getElementById('recent-panel');
    this.recentImagesGrid = document.getElementById('recent-images');
    this.historyBtn = document.getElementById('btn-history');
    this.gridBtn = document.getElementById('btn-grid');
    this.snapBtn = document.getElementById('btn-snap');
    this.ratioControl = document.getElementById('ratio-control');
    this.ratioSlider = document.getElementById('ratio-slider');
    this.ratioValueDisplay = document.getElementById('ratio-value');

    // Grid visibility state
    this.gridVisible = true;

    // Setup ratio slider
    if (this.ratioSlider) {
      this.ratioSlider.addEventListener('input', (e) => {
        this.ratioScale = parseFloat(e.target.value);
        if (this.ratioValueDisplay) {
          this.ratioValueDisplay.textContent = this.ratioScale.toFixed(2);
        }
        // Enter preview mode (hide markers) while adjusting for cleaner view
        this.perspectiveOverlay.enterPreviewMode();
        // Update preview with new ratio
        this.updatePerspectivePreview();
      });
      // When slider is released, show markers again
      this.ratioSlider.addEventListener('change', () => {
        this.perspectiveOverlay.exitPreviewMode();
      });
    }

    // Bind methods
    this.updateUI = this.updateUI.bind(this);

    // Setup approve button
    this.approveBtn.addEventListener('click', () => this.executeApprove());

    // Setup skip button (for perspective step or canceling pending actions)
    this.skipBtn.addEventListener('click', () => this.executeCancel());

    // Setup camera reset button
    const cameraResetBtn = document.getElementById('btn-camera-reset');
    cameraResetBtn.addEventListener('click', () => this.scene.resetCamera());

    // Setup history button (toggle recent images panel)
    this.historyBtn.addEventListener('click', () => this.toggleRecentPanel());

    // Setup grid toggle button
    this.gridBtn.addEventListener('click', () => this.toggleGridVisibility());

    // Setup snap button
    this.snapBtn.addEventListener('click', () => this.toggleGridSnap());

    // Setup ESC key to skip perspective
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modeManager.isMode(Modes.PERSPECTIVE)) {
        this.skipPerspective();
      }
    });

    // Listen to mode changes
    this.modeManager.onModeChange((newMode, oldMode) => {
      this.onModeChange(newMode, oldMode);
      this.updateUI();
    });

    // Listen to history changes
    this.history.onChange(() => this.updateUI());

    // Handle visibility change (fix focus loss issue)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Force a re-render when tab becomes visible again
        this.scene.handleResize();
      }
    });

    // Global wheel event forwarding - allows zooming in all modes
    // Forward wheel events from overlay canvas to 3D canvas
    this.overlayCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const wheelEvent = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode
      });
      this.canvas.dispatchEvent(wheelEvent);
    }, { passive: false });

    // Initial UI update
    this.updateUI();
    this.renderRecentImages();

    console.log('ImageModel initialized');
  }

  /**
   * Initialize IndexedDB for storing full images
   */
  async initImageDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('imagemodel_db', 1);

      request.onerror = () => {
        console.warn('Could not open IndexedDB');
        resolve(null);
      };

      request.onsuccess = () => {
        this.imageDB = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * Store full image in IndexedDB
   */
  async storeImageInDB(id, dataUrl) {
    if (!this.imageDB) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.imageDB.transaction(['images'], 'readwrite');
        const store = transaction.objectStore('images');
        store.put({ id, dataUrl });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (e) {
        console.warn('Could not store image in DB:', e.message);
        resolve(false);
      }
    });
  }

  /**
   * Get full image from IndexedDB
   */
  async getImageFromDB(id) {
    if (!this.imageDB) return null;

    return new Promise((resolve) => {
      try {
        const transaction = this.imageDB.transaction(['images'], 'readonly');
        const store = transaction.objectStore('images');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result?.dataUrl || null);
        request.onerror = () => resolve(null);
      } catch (e) {
        console.warn('Could not get image from DB:', e.message);
        resolve(null);
      }
    });
  }

  /**
   * Delete image from IndexedDB
   */
  async deleteImageFromDB(id) {
    if (!this.imageDB) return;

    try {
      const transaction = this.imageDB.transaction(['images'], 'readwrite');
      const store = transaction.objectStore('images');
      store.delete(id);
    } catch (e) {
      console.warn('Could not delete image from DB:', e.message);
    }
  }

  /**
   * Load recent images metadata from localStorage
   */
  loadRecentImages() {
    try {
      const stored = localStorage.getItem('imagemodel_recent_meta');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('Could not load recent images:', e.message);
      return [];
    }
  }

  /**
   * Save recent images metadata to localStorage (thumbnails only, not full images)
   */
  saveRecentImages() {
    try {
      // Only save metadata (id, name, thumbnail) - not full dataUrl
      const metadata = this.recentImages.map(({ id, name, thumbnail }) => ({ id, name, thumbnail }));
      localStorage.setItem('imagemodel_recent_meta', JSON.stringify(metadata));
    } catch (e) {
      console.warn('Could not save recent images:', e.message);
    }
  }

  /**
   * Add image to recent images list
   */
  async addToRecentImages(dataUrl, name) {
    // Generate unique ID
    const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create thumbnail (resize to 100x100)
    const img = new Image();

    return new Promise((resolve) => {
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');

        // Cover fit
        const scale = Math.max(100 / img.width, 100 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (100 - w) / 2;
        const y = (100 - h) / 2;

        ctx.drawImage(img, x, y, w, h);

        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);

        // Remove old entry with same name and delete its image from DB
        const existing = this.recentImages.find(r => r.name === name);
        if (existing) {
          await this.deleteImageFromDB(existing.id);
        }
        this.recentImages = this.recentImages.filter(r => r.name !== name);

        // Add to beginning (only store id, name, thumbnail in memory/localStorage)
        this.recentImages.unshift({ id, name, thumbnail });

        // Store full image in IndexedDB
        await this.storeImageInDB(id, dataUrl);

        // Keep only 9 - delete old images from DB
        if (this.recentImages.length > 9) {
          const toRemove = this.recentImages.slice(9);
          for (const item of toRemove) {
            await this.deleteImageFromDB(item.id);
          }
          this.recentImages = this.recentImages.slice(0, 9);
        }

        this.saveRecentImages();
        this.renderRecentImages();
        resolve();
      };
      img.onerror = () => {
        console.warn('Could not create thumbnail for recent image');
        resolve();
      };
      img.src = dataUrl;
    });
  }

  /**
   * Render recent images in the panel
   */
  renderRecentImages() {
    this.recentImagesGrid.innerHTML = '';

    if (this.recentImages.length === 0) {
      return;
    }

    this.recentImages.forEach((recent, index) => {
      const thumb = document.createElement('div');
      thumb.className = 'recent-thumb';
      thumb.innerHTML = `<img src="${recent.thumbnail}" alt="${recent.name}">`;
      thumb.addEventListener('click', () => this.loadRecentImage(index));
      this.recentImagesGrid.appendChild(thumb);
    });
  }

  /**
   * Load a recent image from IndexedDB
   */
  async loadRecentImage(index) {
    const recent = this.recentImages[index];
    if (!recent) return;

    // Get full image from IndexedDB
    const dataUrl = await this.getImageFromDB(recent.id);
    if (!dataUrl) {
      console.warn('Image not found in database');
      // Remove from recent list since image is missing
      this.recentImages.splice(index, 1);
      this.saveRecentImages();
      this.renderRecentImages();
      return;
    }

    // Convert dataUrl to File-like object
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], recent.name, { type: blob.type });

    this.importImage(file);
  }

  /**
   * Show approve button with action (highlight enter button)
   * @param {Function} action - Action to execute on approval
   * @param {string} text - Button text (unused, kept for compatibility)
   * @param {Function} cancelAction - Optional action to execute on cancel/skip
   */
  showApproveButton(action, text = 'Apply', cancelAction = null) {
    this.pendingAction = action;
    this.pendingCancelAction = cancelAction;
    this.approveBtn.style.display = 'flex';
    this.approveBtn.classList.add('ready');

    // Show skip button if there's a cancel action
    if (cancelAction) {
      this.skipBtn.style.display = 'flex';
    }
  }

  /**
   * Hide approve button
   */
  hideApproveButton() {
    this.pendingAction = null;
    this.pendingCancelAction = null;
    this.approveBtn.style.display = 'none';
    this.approveBtn.classList.remove('ready');
    this.skipBtn.style.display = 'none';
  }

  /**
   * Toggle recent images panel
   */
  toggleRecentPanel() {
    const isVisible = this.recentPanel.style.display !== 'none';
    this.recentPanel.style.display = isVisible ? 'none' : 'flex';
    this.historyBtn.classList.toggle('active', !isVisible);
  }

  /**
   * Toggle grid visibility
   */
  toggleGridVisibility() {
    this.gridVisible = !this.gridVisible;
    this.scene.setGridVisible(this.gridVisible);
    this.gridBtn.classList.toggle('active', this.gridVisible);
  }

  /**
   * Toggle grid snap
   */
  toggleGridSnap() {
    this.gridSnap = !this.gridSnap;
    this.snapBtn.classList.toggle('active', this.gridSnap);
  }

  /**
   * Execute pending approve action
   */
  executeApprove() {
    if (this.pendingAction) {
      this.pendingAction();
      this.hideApproveButton();
    }
  }

  /**
   * Execute pending cancel action (skip/reset)
   */
  executeCancel() {
    if (this.pendingCancelAction) {
      this.pendingCancelAction();
      this.hideApproveButton();
    } else if (this.modeManager.isMode(Modes.PERSPECTIVE)) {
      // Fallback for perspective mode
      this.skipPerspective();
    }
  }

  /**
   * Show skip button
   */
  showSkipButton() {
    this.skipBtn.style.display = 'flex';
  }

  /**
   * Hide skip button
   */
  hideSkipButton() {
    this.skipBtn.style.display = 'none';
  }

  /**
   * Show ratio slider
   */
  showRatioSlider() {
    if (this.ratioControl) {
      this.ratioControl.style.display = 'flex';
    }
  }

  /**
   * Hide ratio slider and reset value
   */
  hideRatioSlider() {
    if (this.ratioControl) {
      this.ratioControl.style.display = 'none';
    }
    // Reset ratio scale
    this.ratioScale = 1.0;
    if (this.ratioSlider) {
      this.ratioSlider.value = '1.0';
    }
    if (this.ratioValueDisplay) {
      this.ratioValueDisplay.textContent = '1.00';
    }
  }

  /**
   * Restore the original image (before perspective transform preview)
   */
  restoreOriginalImage() {
    if (!this.imagePlane || !this.imagePlane.mesh || !this.currentImageElement) {
      return;
    }

    // Create texture from original image
    const originalTexture = new THREE.CanvasTexture(
      this.createCanvasFromImage(this.currentImageElement)
    );
    originalTexture.colorSpace = THREE.SRGBColorSpace;

    // Calculate original dimensions
    const maxSize = 2;
    const aspect = this.currentImageElement.width / this.currentImageElement.height;
    let width, height;

    if (aspect > 1) {
      width = maxSize;
      height = maxSize / aspect;
    } else {
      height = maxSize;
      width = maxSize * aspect;
    }

    // Restore original geometry
    this.imagePlane.mesh.geometry.dispose();
    this.imagePlane.mesh.geometry = new THREE.PlaneGeometry(width, height);

    // Restore original texture
    if (this.imagePlane.mesh.material.map) {
      this.imagePlane.mesh.material.map.dispose();
    }
    this.imagePlane.mesh.material.map = originalTexture;
    this.imagePlane.mesh.material.needsUpdate = true;
  }

  /**
   * Create a canvas from an image element
   */
  createCanvasFromImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas;
  }

  /**
   * Update perspective preview when points or ratio changes
   */
  async updatePerspectivePreview() {
    if (!this.pendingPerspectivePoints || this.pendingPerspectivePoints.length !== 4) {
      return;
    }

    if (!this.currentImageElement || !this.currentImageElement.complete) {
      return;
    }

    // Wait for OpenCV if not ready
    if (!isOpenCVReady()) {
      try {
        await waitForOpenCV();
      } catch (error) {
        console.error('OpenCV not ready for preview');
        return;
      }
    }

    try {
      const canvasWidth = this.overlayCanvas.width;
      const canvasHeight = this.overlayCanvas.height;

      const result = await perspectiveTransform(
        this.pendingPerspectivePoints,
        this.currentImageElement,
        canvasWidth,
        canvasHeight,
        this.ratioScale
      );

      // Update the image plane texture with the preview
      if (this.imagePlane && this.imagePlane.mesh) {
        const previewTexture = new THREE.CanvasTexture(result.canvas);
        previewTexture.colorSpace = THREE.SRGBColorSpace;

        // Update geometry to match new aspect ratio
        const maxSize = 2;
        const aspect = result.width / result.height;
        let width, height;

        if (aspect > 1) {
          width = maxSize;
          height = maxSize / aspect;
        } else {
          height = maxSize;
          width = maxSize * aspect;
        }

        // Update plane geometry
        this.imagePlane.mesh.geometry.dispose();
        this.imagePlane.mesh.geometry = new THREE.PlaneGeometry(width, height);

        // Update texture
        if (this.imagePlane.mesh.material.map) {
          this.imagePlane.mesh.material.map.dispose();
        }
        this.imagePlane.mesh.material.map = previewTexture;
        this.imagePlane.mesh.material.needsUpdate = true;

        // Store for final application
        this.previewCanvas = result.canvas;
      }
    } catch (error) {
      console.error('Preview update failed:', error);
    }
  }

  /**
   * Skip perspective correction and use original image
   */
  async skipPerspective() {
    if (!this.currentImageElement || !this.currentImageElement.complete) {
      console.error('Image not loaded');
      return;
    }

    try {
      // Create canvas from original image (no correction)
      const canvas = document.createElement('canvas');
      canvas.width = this.currentImageElement.width;
      canvas.height = this.currentImageElement.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(this.currentImageElement, 0, 0);

      // Store canvas for export
      this.correctedCanvas = canvas;

      // Remove original image plane
      if (this.imagePlane) {
        this.scene.remove(this.imagePlane.mesh);
        this.imagePlane.dispose();
        this.imagePlane = null;
      }

      // Create texture from original image
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;

      // Calculate plane dimensions
      const maxSize = 2;
      const aspect = canvas.width / canvas.height;
      let width, height;

      if (aspect > 1) {
        width = maxSize;
        height = maxSize / aspect;
      } else {
        height = maxSize;
        width = maxSize * aspect;
      }

      // Create editable mesh
      this.editableMesh = new EditableMesh();
      this.editableMesh.createFromDimensions(width, height, texture);

      // Add mesh and wireframe to scene
      this.scene.add(this.editableMesh.mesh);
      this.scene.add(this.editableMesh.getWireframe());

      // Clean up preview mesh if any
      if (this.previewMesh) {
        this.scene.remove(this.previewMesh);
        this.previewMesh.geometry.dispose();
        this.previewMesh.material.dispose();
        this.previewMesh = null;
      }

      this.hasMesh = true;
      this.alignmentPanel.deactivate();
      this.setMode(Modes.SELECT);

      this.history.pushState(this.getSerializableState(), 'Skip perspective');
      this.scene.resetCamera();
      this.updateUI();

      console.log('Skipped perspective - editable mesh created from original image');
    } catch (error) {
      console.error('Failed to skip perspective:', error);
      alert('Failed to create mesh. Please try again.');
    }
  }

  /**
   * Handle mode changes
   */
  onModeChange(newMode, oldMode) {
    // Hide approve button and cancel pending actions
    this.hideApproveButton();
    this.hideSkipButton();
    this.hideRatioSlider();
    this.pendingPerspectivePoints = null;

    // Cancel pending tool actions
    if (this.cutOverlay.pendingCut) {
      this.cutOverlay.cancelPendingCut();
    }
    if (this.extrudeTool.pendingExtrusion) {
      this.extrudeTool.cancelPendingExtrusion();
    }
    if (this.insetTool.pendingInset) {
      this.insetTool.cancelPendingInset();
    }

    // Deactivate old mode tools
    switch (oldMode) {
      case Modes.PERSPECTIVE:
        this.alignmentPanel.deactivate();
        break;
      case Modes.CUT:
        this.cutOverlay.deactivate();
        break;
      case Modes.SELECT:
        this.selectTool.deactivate();
        break;
      case Modes.EXTRUDE:
        this.extrudeTool.deactivate();
        break;
      case Modes.INSET:
        this.insetTool.deactivate();
        break;
    }

    // Activate new mode tools
    switch (newMode) {
      case Modes.PERSPECTIVE:
        if (this.hasImage && this.currentImageElement) {
          this.alignmentPanel.activate(this.currentImageElement);
        }
        break;
      case Modes.CUT:
        if (this.editableMesh) {
          this.cutOverlay.setMesh(this.editableMesh);
          this.cutOverlay.activate();
        }
        break;
      case Modes.SELECT:
        if (this.editableMesh) {
          this.selectTool.setMesh(this.editableMesh);
          this.selectTool.activate(this.canvas);
        }
        break;
      case Modes.EXTRUDE:
        if (this.editableMesh) {
          this.extrudeTool.setMesh(this.editableMesh);
          this.extrudeTool.setSelectedFaces(this.selectedFaces);
          this.extrudeTool.activate(this.canvas);
          // Show selection highlight if faces are already selected
          if (this.selectedFaces.length > 0) {
            this.selectTool.setMesh(this.editableMesh);
            this.selectTool.selectedFaces = this.selectedFaces;
            this.selectTool.updateHighlight();
          }
        }
        break;
      case Modes.INSET:
        if (this.editableMesh) {
          this.insetTool.setMesh(this.editableMesh);
          this.insetTool.setSelectedFaces(this.selectedFaces);
          this.insetTool.activate(this.canvas);
          // Show selection highlight if faces are already selected
          if (this.selectedFaces.length > 0) {
            this.selectTool.setMesh(this.editableMesh);
            this.selectTool.selectedFaces = this.selectedFaces;
            this.selectTool.updateHighlight();
          }
        }
        break;
    }

    // Controls are managed by each tool's activate() method
    // All tools now enable controls for zoom, individual tools control rotation
  }

  /**
   * Update toolbar state
   */
  updateUI() {
    const state = {
      hasImage: this.hasImage,
      hasMesh: this.hasMesh,
      hasSelection: this.selectedFaces.length > 0,
      selectionCount: this.selectedFaces.length,
      mode: this.modeManager.getMode(),
      modeDescription: this.modeManager.getDescription(),
      instructions: this.modeManager.getInstructions(),
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo()
    };

    this.toolbar.updateState(state);
  }

  /**
   * Import image file
   */
  async importImage(file) {
    try {
      // Cleanup existing
      if (this.imagePlane) {
        this.scene.remove(this.imagePlane.mesh);
        this.imagePlane.dispose();
        this.imagePlane = null;
      }
      if (this.editableMesh) {
        this.scene.remove(this.editableMesh.mesh);
        if (this.editableMesh.getWireframe()) {
          this.scene.remove(this.editableMesh.getWireframe());
        }
        this.editableMesh.dispose();
        this.editableMesh = null;
      }

      // Create image plane
      this.imagePlane = new ImagePlane();
      const mesh = await this.imagePlane.loadFromFile(file);

      this.currentImageData = this.imagePlane.getImageData();
      this.currentImageElement = new Image();
      this.currentImageElement.src = this.currentImageData;

      this.scene.add(mesh);

      // Add to recent images
      this.addToRecentImages(this.currentImageData, file.name);

      this.hasImage = true;
      this.hasMesh = false;
      this.selectedFaces = [];

      this.scene.resetCamera();
      this.setMode(Modes.PERSPECTIVE);
      this.updateUI();

      console.log('Image imported:', file.name);
    } catch (error) {
      console.error('Failed to import image:', error);
      alert('Failed to import image. Please try another file.');
    }
  }

  /**
   * Handle perspective correction complete
   */
  async onPerspectiveComplete(points) {
    console.log('Perspective points:', points);

    // Use preview canvas if available (already computed)
    let resultCanvas = this.previewCanvas;

    if (!resultCanvas) {
      // Need to compute the transform
      if (!this.currentImageElement || !this.currentImageElement.complete) {
        console.error('Image not loaded');
        return;
      }

      // Wait for OpenCV to be ready
      if (!isOpenCVReady()) {
        try {
          console.log('Waiting for OpenCV...');
          await waitForOpenCV();
        } catch (error) {
          console.error('OpenCV failed to load:', error);
          alert('OpenCV failed to load. Please refresh the page.');
          return;
        }
      }

      const canvasWidth = this.overlayCanvas.width;
      const canvasHeight = this.overlayCanvas.height;

      const result = await perspectiveTransform(
        points,
        this.currentImageElement,
        canvasWidth,
        canvasHeight,
        this.ratioScale
      );

      resultCanvas = result.canvas;
    }

    try {
      // Store corrected canvas for export
      this.correctedCanvas = resultCanvas;

      // Remove original image plane
      if (this.imagePlane) {
        this.scene.remove(this.imagePlane.mesh);
        this.imagePlane.dispose();
        this.imagePlane = null;
      }

      // Create texture from corrected image
      const correctedTexture = new THREE.CanvasTexture(resultCanvas);
      correctedTexture.colorSpace = THREE.SRGBColorSpace;

      // Calculate plane dimensions
      const maxSize = 2;
      const aspect = resultCanvas.width / resultCanvas.height;
      let width, height;

      if (aspect > 1) {
        width = maxSize;
        height = maxSize / aspect;
      } else {
        height = maxSize;
        width = maxSize * aspect;
      }

      // Create editable mesh
      this.editableMesh = new EditableMesh();
      this.editableMesh.createFromDimensions(width, height, correctedTexture);

      // Clear preview canvas reference
      this.previewCanvas = null;

      // Add mesh and wireframe to scene
      this.scene.add(this.editableMesh.mesh);
      this.scene.add(this.editableMesh.getWireframe());

      this.hasMesh = true;
      this.setMode(Modes.SELECT);

      this.history.pushState(this.getSerializableState(), 'Perspective correction');
      this.scene.resetCamera();
      this.updateUI();

      console.log('Editable mesh created');
    } catch (error) {
      console.error('Failed to apply perspective correction:', error);
      alert('Failed to apply perspective correction. Please try again.');
    }
  }

  /**
   * Handle alignment panel points change - update 3D preview
   * @param {Object} data - { points, ratioScale, image }
   */
  async onAlignmentPointsChange(data) {
    const { points, ratioScale, image } = data;

    try {
      // Wait for OpenCV if needed
      if (!isOpenCVReady()) {
        await waitForOpenCV();
      }

      const canvasWidth = image.width;
      const canvasHeight = image.height;

      const result = await perspectiveTransform(
        points,
        image,
        canvasWidth,
        canvasHeight,
        ratioScale
      );

      // Update the 3D image plane with the preview
      this.updatePreviewPlane(result.canvas);

    } catch (error) {
      console.error('Failed to update alignment preview:', error);
    }
  }

  /**
   * Update the 3D image plane with a preview canvas
   */
  updatePreviewPlane(canvas) {
    if (!this.imagePlane || !this.imagePlane.mesh) return;

    // Create texture from canvas
    const previewTexture = new THREE.CanvasTexture(canvas);
    previewTexture.colorSpace = THREE.SRGBColorSpace;

    // Calculate new dimensions
    const maxSize = 2;
    const aspect = canvas.width / canvas.height;
    let width, height;

    if (aspect > 1) {
      width = maxSize;
      height = maxSize / aspect;
    } else {
      height = maxSize;
      width = maxSize * aspect;
    }

    // Update geometry
    this.imagePlane.mesh.geometry.dispose();
    this.imagePlane.mesh.geometry = new THREE.PlaneGeometry(width, height);

    // Update texture
    if (this.imagePlane.mesh.material.map) {
      this.imagePlane.mesh.material.map.dispose();
    }
    this.imagePlane.mesh.material.map = previewTexture;
    this.imagePlane.mesh.material.needsUpdate = true;
  }

  /**
   * Handle alignment panel confirm
   * @param {Object} data - { points, ratioScale, image }
   */
  async onAlignmentConfirm(data) {
    const { points, ratioScale, image } = data;

    try {
      // Wait for OpenCV if needed
      if (!isOpenCVReady()) {
        await waitForOpenCV();
      }

      const canvasWidth = image.width;
      const canvasHeight = image.height;

      const result = await perspectiveTransform(
        points,
        image,
        canvasWidth,
        canvasHeight,
        ratioScale
      );

      // Create final mesh from result
      await this.createMeshFromCanvas(result.canvas);

      this.hasMesh = true;
      this.setMode(Modes.SELECT);

      this.history.pushState(this.getSerializableState(), 'Perspective correction');
      this.scene.resetCamera();
      this.updateUI();

    } catch (error) {
      console.error('Failed to apply alignment:', error);
      alert('Failed to apply alignment. Please try again.');
    }
  }

  /**
   * Update preview mesh with canvas (for live preview during alignment)
   */
  updatePreviewMesh(canvas) {
    // Remove old preview mesh
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      this.previewMesh.material.dispose();
      this.previewMesh = null;
    }

    // Remove original image plane for preview
    if (this.imagePlane && this.imagePlane.mesh.visible) {
      this.imagePlane.mesh.visible = false;
    }

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    // Calculate dimensions
    const maxSize = 2;
    const aspect = canvas.width / canvas.height;
    let width, height;

    if (aspect > 1) {
      width = maxSize;
      height = maxSize / aspect;
    } else {
      height = maxSize;
      width = maxSize * aspect;
    }

    // Create preview mesh
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });

    this.previewMesh = new THREE.Mesh(geometry, material);
    this.previewMesh.name = 'alignmentPreview';
    this.scene.add(this.previewMesh);
  }

  /**
   * Create final mesh from canvas
   */
  async createMeshFromCanvas(canvas) {
    // Remove preview mesh
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      this.previewMesh.material.dispose();
      this.previewMesh = null;
    }

    // Remove original image plane
    if (this.imagePlane) {
      this.scene.remove(this.imagePlane.mesh);
      this.imagePlane.dispose();
      this.imagePlane = null;
    }

    // Store corrected canvas for export
    this.correctedCanvas = canvas;

    // Create texture from corrected image
    const correctedTexture = new THREE.CanvasTexture(canvas);
    correctedTexture.colorSpace = THREE.SRGBColorSpace;

    // Calculate plane dimensions
    const maxSize = 2;
    const aspect = canvas.width / canvas.height;
    let width, height;

    if (aspect > 1) {
      width = maxSize;
      height = maxSize / aspect;
    } else {
      height = maxSize;
      width = maxSize * aspect;
    }

    // Create editable mesh
    this.editableMesh = new EditableMesh();
    this.editableMesh.createFromDimensions(width, height, correctedTexture);

    // Add mesh and wireframe to scene
    this.scene.add(this.editableMesh.mesh);
    this.scene.add(this.editableMesh.getWireframe());
  }

  /**
   * Handle face selection (multi-select)
   */
  onFacesSelected(faces) {
    this.selectedFaces = faces || [];
    this.updateUI();

    // Show skip button to clear selection when faces are selected
    if (this.selectedFaces.length > 0) {
      this.pendingCancelAction = () => {
        this.selectTool.clearSelection();
      };
      this.showSkipButton();
    } else {
      this.pendingCancelAction = null;
      this.hideSkipButton();
    }

    if (faces && faces.length > 0) {
      console.log('Faces selected:', faces.map(f => f.id).join(', '));
    }
  }

  /**
   * Handle extrusion complete (multi-select)
   */
  onExtrudeComplete(faces, distance) {
    console.log('Extrude:', faces.map(f => f.id).join(', '), 'distance:', distance);

    // Save state for undo
    this.history.pushState(this.getSerializableState(), 'Extrude faces');

    // Use extrudeFaces for multi-face extrusion (handles shared edges correctly)
    const result = extrudeFaces(faces, distance, this.editableMesh.nextFaceId);

    // Remove original faces
    faces.forEach(face => {
      const faceIndex = this.editableMesh.faces.findIndex(f => f.id === face.id);
      if (faceIndex >= 0) {
        this.editableMesh.faces.splice(faceIndex, 1);
      }
    });

    // Add extruded faces and side faces
    result.extrudedFaces.forEach(f => this.editableMesh.faces.push(f));
    result.sideFaces.forEach(f => this.editableMesh.faces.push(f));
    this.editableMesh.nextFaceId = result.nextFaceId;

    // Merge duplicate vertices
    this.editableMesh.mergeVertices();

    // Rebuild mesh
    this.editableMesh.rebuildMesh();

    // Update selection to extruded faces
    this.selectedFaces = result.extrudedFaces;
    this.selectTool.setMesh(this.editableMesh);
    // Select all extruded faces
    result.extrudedFaces.forEach((face, i) => {
      if (i === 0) {
        this.selectTool.selectFace(face);
      } else {
        this.selectTool.toggleFaceSelection(face);
      }
    });
    this.extrudeTool.setSelectedFaces(result.extrudedFaces);

    this.updateUI();

    console.log('Extrusion complete');
  }

  /**
   * Handle inset complete (multi-select)
   * @param {Face[]} faces - Selected faces to inset
   * @param {number} thickness - Inset distance
   * @param {boolean} individualMode - If true, inset each face independently; if false, inset as region
   */
  onInsetComplete(faces, thickness, individualMode = false) {
    console.log('Inset:', faces.map(f => f.id).join(', '), 'thickness:', thickness, 'individual:', individualMode);

    // Save state for undo
    this.history.pushState(this.getSerializableState(), 'Inset faces');

    const newInsetFaces = [];

    // Remove all original faces first
    faces.forEach(face => {
      const faceIndex = this.editableMesh.faces.findIndex(f => f.id === face.id);
      if (faceIndex >= 0) {
        this.editableMesh.faces.splice(faceIndex, 1);
      }
    });

    if (individualMode) {
      // Individual mode: inset each face separately (all edges get side faces)
      faces.forEach(face => {
        const result = insetFace(face, thickness, this.editableMesh.nextFaceId);

        // Add inset face and side faces
        this.editableMesh.faces.push(result.insetFace);
        result.sideFaces.forEach(f => this.editableMesh.faces.push(f));
        this.editableMesh.nextFaceId = result.nextFaceId;

        newInsetFaces.push(result.insetFace);
      });
    } else {
      // Region mode: inset faces together (shared edges don't get side faces)
      const result = insetFaces(faces, thickness, this.editableMesh.nextFaceId);

      // Add all inset faces and side faces
      result.insetFaces.forEach(f => this.editableMesh.faces.push(f));
      result.sideFaces.forEach(f => this.editableMesh.faces.push(f));
      this.editableMesh.nextFaceId = result.nextFaceId;

      newInsetFaces.push(...result.insetFaces);
    }

    // Merge duplicate vertices
    this.editableMesh.mergeVertices();

    // Rebuild mesh
    this.editableMesh.rebuildMesh();

    // Update selection to inset faces (the center faces)
    this.selectedFaces = newInsetFaces;
    this.selectTool.setMesh(this.editableMesh);
    // Select all inset faces
    newInsetFaces.forEach((face, i) => {
      if (i === 0) {
        this.selectTool.selectFace(face);
      } else {
        this.selectTool.toggleFaceSelection(face);
      }
    });
    this.insetTool.setSelectedFaces(newInsetFaces);

    this.updateUI();

    console.log('Inset complete');
  }

  /**
   * Set current mode
   */
  setMode(mode) {
    this.modeManager.setMode(mode);
  }

  /**
   * Set grid snap
   */
  setGridSnap(enabled) {
    this.gridSnap = enabled;
    this.scene.setGridVisible(enabled);
  }

  /**
   * Set background color
   */
  setBackgroundColor(hexColor) {
    this.scene.setBackgroundColor(hexColor);
  }

  /**
   * Export to OBJ
   */
  async exportOBJ() {
    if (!this.hasMesh || !this.editableMesh) {
      alert('No mesh to export. Complete perspective correction first.');
      return;
    }

    try {
      const name = 'imagemodel_export';
      await downloadOBJ(this.editableMesh, this.correctedCanvas, name);
      console.log('Export complete');
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    }
  }

  /**
   * Undo
   */
  undo() {
    // Special case: in perspective mode, undo the last drawn line
    if (this.modeManager.currentMode === Modes.PERSPECTIVE) {
      if (this.perspectiveOverlay.canUndo()) {
        this.perspectiveOverlay.undoLastLine();
        this.hideApproveButton();  // Hide approve button if visible
        return;
      }
      // If no lines to undo, fall through to history undo (which will restore original image)
    }

    const state = this.getSerializableState();
    const previousState = this.history.undo(state);

    if (previousState) {
      this.restoreState(previousState);
    }
  }

  /**
   * Redo
   */
  redo() {
    const state = this.getSerializableState();
    const nextState = this.history.redo(state);

    if (nextState) {
      this.restoreState(nextState);
    }
  }

  /**
   * Get serializable state
   */
  getSerializableState() {
    return {
      hasImage: this.hasImage,
      hasMesh: this.hasMesh,
      mesh: this.editableMesh ? this.editableMesh.serialize() : null
    };
  }

  /**
   * Restore state
   */
  restoreState(state) {
    this.hasImage = state.hasImage;
    this.hasMesh = state.hasMesh;

    if (state.mesh && this.editableMesh) {
      this.editableMesh.deserialize(state.mesh);
    }

    // Clear selection on restore
    this.selectedFaces = [];
    if (this.selectTool) {
      this.selectTool.clearSelection();
    }

    this.updateUI();
  }

  /**
   * Save project
   */
  saveProject() {
    const state = this.getSerializableState();
    const success = this.storage.save(state);
    if (success) console.log('Project saved');
  }

  /**
   * Load project
   */
  loadProject() {
    const state = this.storage.load();
    if (state) {
      this.restoreState(state);
      console.log('Project loaded');
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
