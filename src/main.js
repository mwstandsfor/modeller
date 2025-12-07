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
import { CutOverlay, splitFace } from './geometry/cut.js';
import { SelectTool } from './tools/select.js';
import { ExtrudeTool, extrudeFace } from './geometry/extrude.js';
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

    this.cutOverlay = new CutOverlay(this.overlayCanvas, this.scene);
    this.cutOverlay.onCutComplete = (face, startEdge, endEdge) => this.onCutComplete(face, startEdge, endEdge);

    this.selectTool = new SelectTool(this.scene);
    this.selectTool.onSelect = (face) => this.onFaceSelected(face);

    this.extrudeTool = new ExtrudeTool(this.scene);
    this.extrudeTool.onExtrudeComplete = (face, distance) => this.onExtrudeComplete(face, distance);

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

    // Bind methods
    this.updateUI = this.updateUI.bind(this);

    // Listen to mode changes
    this.modeManager.onModeChange((newMode, oldMode) => {
      this.onModeChange(newMode, oldMode);
      this.updateUI();
    });

    // Listen to history changes
    this.history.onChange(() => this.updateUI());

    // Initial UI update
    this.updateUI();

    console.log('ImageModel initialized');
  }

  /**
   * Handle mode changes
   */
  onModeChange(newMode, oldMode) {
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
    }

    // Activate new mode tools
    switch (newMode) {
      case Modes.PERSPECTIVE:
        if (this.hasImage) {
          this.perspectiveOverlay.activate();
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
        lines.x,
        lines.y,
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
   * Handle cut complete
   */
  onCutComplete(face, startEdge, endEdge) {
    console.log('Cut:', face.id, startEdge, endEdge);

    // Save state for undo
    this.history.pushState(this.getSerializableState(), 'Cut face');

    // Perform the cut
    const result = splitFace(face, startEdge, endEdge, this.editableMesh.nextFaceId);

    if (result) {
      // Remove old face
      const faceIndex = this.editableMesh.faces.findIndex(f => f.id === face.id);
      if (faceIndex >= 0) {
        this.editableMesh.faces.splice(faceIndex, 1);
      }

      // Add new faces
      this.editableMesh.faces.push(result.face1);
      this.editableMesh.faces.push(result.face2);
      this.editableMesh.nextFaceId = result.face2.id + 1;

      // Rebuild mesh
      this.editableMesh.rebuildMesh();

      console.log('Face split into', result.face1.id, 'and', result.face2.id);
    }
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
