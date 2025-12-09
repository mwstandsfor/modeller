import * as THREE from 'three';
import { SceneManager } from './scene.js';
import { ModeManager, Modes } from './tools/modes.js';
import { Toolbar } from './tools/toolbar.js';
import { ImagePlane } from './geometry/plane.js';
import { EditableMesh } from './geometry/face.js';
import { HistoryManager } from './history/undo.js';
import { StorageManager } from './storage/local.js';
import { PerspectiveOverlay } from './perspective/overlay.js';
import { perspectiveTransform } from './perspective/dewarp.js';
import { CutOverlay, splitFace, findFacesOnLine } from './geometry/cut.js';
import { SelectTool } from './tools/select.js';
import { ExtrudeTool, extrudeFace } from './geometry/extrude.js';
import { InsetTool, insetFace } from './geometry/inset.js';
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

    // Initialize tools
    this.perspectiveOverlay = new PerspectiveOverlay(this.overlayCanvas, this.scene);
    this.perspectiveOverlay.onComplete = (lines) => this.onPerspectiveComplete(lines);
    this.perspectiveOverlay.onReady = (lines) => {
      this.pendingPerspectiveLines = lines;
      this.showApproveButton(() => {
        const lines = this.pendingPerspectiveLines;
        this.pendingPerspectiveLines = null;
        this.perspectiveOverlay.onComplete(lines);
      }, 'Apply');
    };

    this.cutOverlay = new CutOverlay(this.overlayCanvas, this.scene);
    this.cutOverlay.onCutComplete = (face, startEdge, endEdge) => this.onCutComplete(face, startEdge, endEdge);
    this.cutOverlay.onReady = () => {
      this.showApproveButton(() => {
        this.cutOverlay.executePendingCut();
      }, 'Cut');
    };

    this.selectTool = new SelectTool(this.scene);
    this.selectTool.onSelect = (face) => this.onFaceSelected(face);

    this.extrudeTool = new ExtrudeTool(this.scene);
    this.extrudeTool.onExtrudeComplete = (face, distance) => this.onExtrudeComplete(face, distance);
    this.extrudeTool.onReady = () => {
      this.showApproveButton(() => {
        this.extrudeTool.executePendingExtrusion();
      }, 'Extrude');
    };

    this.insetTool = new InsetTool(this.scene);
    this.insetTool.onInsetComplete = (face, thickness) => this.onInsetComplete(face, thickness);
    this.insetTool.onReady = () => {
      this.showApproveButton(() => {
        this.insetTool.executePendingInset();
      }, 'Inset');
    };

    // State
    this.imagePlane = null;
    this.editableMesh = null;
    this.hasImage = false;
    this.hasMesh = false;
    this.selectedFace = null;
    this.gridSnap = false;

    // Image/texture data
    this.currentImageData = null;
    this.currentImageElement = null;
    this.correctedCanvas = null;

    // Recent images (max 9)
    this.recentImages = this.loadRecentImages();

    // Pending action for approve button
    this.pendingAction = null;
    this.pendingPerspectiveLines = null;

    // UI elements
    this.approveBtn = document.getElementById('btn-approve');
    this.skipBtn = document.getElementById('btn-skip');
    this.recentPanel = document.getElementById('recent-panel');
    this.recentImagesGrid = document.getElementById('recent-images');
    this.historyBtn = document.getElementById('btn-history');
    this.gridBtn = document.getElementById('btn-grid');
    this.snapBtn = document.getElementById('btn-snap');

    // Grid visibility state
    this.gridVisible = true;

    // Bind methods
    this.updateUI = this.updateUI.bind(this);

    // Setup approve button
    this.approveBtn.addEventListener('click', () => this.executeApprove());

    // Setup skip button (for perspective step)
    this.skipBtn.addEventListener('click', () => this.skipPerspective());

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

    // Initial UI update
    this.updateUI();
    this.renderRecentImages();

    console.log('ImageModel initialized');
  }

  /**
   * Load recent images from localStorage
   */
  loadRecentImages() {
    try {
      const stored = localStorage.getItem('imagemodel_recent');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Save recent images to localStorage
   */
  saveRecentImages() {
    try {
      localStorage.setItem('imagemodel_recent', JSON.stringify(this.recentImages));
    } catch (e) {
      console.warn('Could not save recent images');
    }
  }

  /**
   * Add image to recent images list
   */
  addToRecentImages(dataUrl, name) {
    // Create thumbnail (resize to 100x100)
    const img = new Image();
    img.onload = () => {
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

      // Remove if already exists
      this.recentImages = this.recentImages.filter(r => r.name !== name);

      // Add to beginning
      this.recentImages.unshift({ name, thumbnail, dataUrl });

      // Keep only 9
      if (this.recentImages.length > 9) {
        this.recentImages = this.recentImages.slice(0, 9);
      }

      this.saveRecentImages();
      this.renderRecentImages();
    };
    img.src = dataUrl;
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
   * Load a recent image
   */
  async loadRecentImage(index) {
    const recent = this.recentImages[index];
    if (!recent) return;

    // Convert dataUrl to File-like object
    const response = await fetch(recent.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], recent.name, { type: blob.type });

    this.importImage(file);
  }

  /**
   * Show approve button with action (highlight enter button)
   */
  showApproveButton(action, text = 'Apply') {
    this.pendingAction = action;
    this.approveBtn.style.display = 'flex';
    this.approveBtn.classList.add('ready');
  }

  /**
   * Hide approve button
   */
  hideApproveButton() {
    this.pendingAction = null;
    this.approveBtn.style.display = 'none';
    this.approveBtn.classList.remove('ready');
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

      this.hasMesh = true;
      this.perspectiveOverlay.deactivate();
      this.hideSkipButton();
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
    this.pendingPerspectiveLines = null;

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
        this.perspectiveOverlay.deactivate();
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
        if (this.hasImage) {
          this.perspectiveOverlay.activate();
          this.showSkipButton();  // Show skip button during perspective mode
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
        if (this.editableMesh && this.selectedFace) {
          this.extrudeTool.setMesh(this.editableMesh);
          this.extrudeTool.setSelectedFace(this.selectedFace);
          this.extrudeTool.activate(this.canvas);
        }
        break;
      case Modes.INSET:
        if (this.editableMesh && this.selectedFace) {
          this.insetTool.setMesh(this.editableMesh);
          this.insetTool.setSelectedFace(this.selectedFace);
          this.insetTool.activate(this.canvas);
        }
        break;
    }

    // Update orbit controls
    const orbitModes = [Modes.IDLE, Modes.SELECT];
    this.scene.setControlsEnabled(orbitModes.includes(newMode));
  }

  /**
   * Update toolbar state
   */
  updateUI() {
    const state = {
      hasImage: this.hasImage,
      hasMesh: this.hasMesh,
      hasSelection: this.selectedFace !== null,
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
      this.selectedFace = null;

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
  async onPerspectiveComplete(lines) {
    console.log('Perspective lines drawn:', lines);

    if (!this.currentImageElement || !this.currentImageElement.complete) {
      console.error('Image not loaded');
      return;
    }

    try {
      const canvasWidth = this.overlayCanvas.width;
      const canvasHeight = this.overlayCanvas.height;

      const result = await perspectiveTransform(
        lines,  // Now passes full object with x1, x2, y1, y2
        this.currentImageElement,
        canvasWidth,
        canvasHeight
      );

      // Store corrected canvas for export
      this.correctedCanvas = result.canvas;

      // Remove original image plane
      if (this.imagePlane) {
        this.scene.remove(this.imagePlane.mesh);
        this.imagePlane.dispose();
        this.imagePlane = null;
      }

      // Create texture from corrected image
      const correctedTexture = new THREE.CanvasTexture(result.canvas);
      correctedTexture.colorSpace = THREE.SRGBColorSpace;

      // Calculate plane dimensions
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

      // Create editable mesh
      this.editableMesh = new EditableMesh();
      this.editableMesh.createFromDimensions(width, height, correctedTexture);

      // Add mesh and wireframe to scene
      this.scene.add(this.editableMesh.mesh);
      this.scene.add(this.editableMesh.getWireframe());

      this.hasMesh = true;
      this.perspectiveOverlay.deactivate();
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
   * Handle face selection
   */
  onFaceSelected(face) {
    this.selectedFace = face;
    this.updateUI();

    if (face) {
      console.log('Face selected:', face.id);
    }
  }

  /**
   * Handle cut complete - cuts through all faces along the cut line
   */
  onCutComplete(face, startEdge, endEdge) {
    console.log('Cut:', face.id, startEdge, endEdge);

    // Save state for undo
    this.history.pushState(this.getSerializableState(), 'Cut faces');

    // Define the cut line from the two edge points
    const linePoint1 = startEdge.point;
    const linePoint2 = endEdge.point;

    // Find all other faces that this line passes through
    const additionalCuts = findFacesOnLine(
      this.editableMesh.faces,
      linePoint1,
      linePoint2,
      face // exclude the primary face
    );

    // Collect all cuts to perform (primary + additional)
    const allCuts = [
      { face, startEdge, endEdge },
      ...additionalCuts
    ];

    let nextFaceId = this.editableMesh.nextFaceId;
    const facesToRemove = [];
    const facesToAdd = [];

    // Perform all cuts
    for (const cut of allCuts) {
      const result = splitFace(cut.face, cut.startEdge, cut.endEdge, nextFaceId);

      if (result) {
        facesToRemove.push(cut.face.id);
        facesToAdd.push(result.face1);
        facesToAdd.push(result.face2);
        nextFaceId = result.face2.id + 1;

        console.log('Face', cut.face.id, 'split into', result.face1.id, 'and', result.face2.id);
      }
    }

    // Remove old faces
    this.editableMesh.faces = this.editableMesh.faces.filter(
      f => !facesToRemove.includes(f.id)
    );

    // Add new faces
    this.editableMesh.faces.push(...facesToAdd);
    this.editableMesh.nextFaceId = nextFaceId;

    // Rebuild mesh
    this.editableMesh.rebuildMesh();

    console.log('Cut complete:', facesToRemove.length, 'faces split into', facesToAdd.length, 'new faces');
  }

  /**
   * Handle extrusion complete
   */
  onExtrudeComplete(face, distance) {
    console.log('Extrude:', face.id, 'distance:', distance);

    // Save state for undo
    this.history.pushState(this.getSerializableState(), 'Extrude face');

    // Perform extrusion
    const result = extrudeFace(face, distance, this.editableMesh.nextFaceId);

    // Remove original face
    const faceIndex = this.editableMesh.faces.findIndex(f => f.id === face.id);
    if (faceIndex >= 0) {
      this.editableMesh.faces.splice(faceIndex, 1);
    }

    // Add extruded face and side faces
    this.editableMesh.faces.push(result.extrudedFace);
    result.sideFaces.forEach(f => this.editableMesh.faces.push(f));
    this.editableMesh.nextFaceId = result.nextFaceId;

    // Rebuild mesh
    this.editableMesh.rebuildMesh();

    // Update selection to extruded face
    this.selectedFace = result.extrudedFace;
    this.selectTool.setMesh(this.editableMesh);
    this.selectTool.selectFace(result.extrudedFace);
    this.extrudeTool.setSelectedFace(result.extrudedFace);

    this.updateUI();

    console.log('Extrusion complete');
  }

  /**
   * Handle inset complete
   */
  onInsetComplete(face, thickness) {
    console.log('Inset:', face.id, 'thickness:', thickness);

    // Save state for undo
    this.history.pushState(this.getSerializableState(), 'Inset face');

    // Perform inset
    const result = insetFace(face, thickness, this.editableMesh.nextFaceId);

    // Remove original face
    const faceIndex = this.editableMesh.faces.findIndex(f => f.id === face.id);
    if (faceIndex >= 0) {
      this.editableMesh.faces.splice(faceIndex, 1);
    }

    // Add inset face and side faces
    this.editableMesh.faces.push(result.insetFace);
    result.sideFaces.forEach(f => this.editableMesh.faces.push(f));
    this.editableMesh.nextFaceId = result.nextFaceId;

    // Rebuild mesh
    this.editableMesh.rebuildMesh();

    // Update selection to inset face (the center face)
    this.selectedFace = result.insetFace;
    this.selectTool.setMesh(this.editableMesh);
    this.selectTool.selectFace(result.insetFace);
    this.insetTool.setSelectedFace(result.insetFace);

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
    this.selectedFace = null;
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
