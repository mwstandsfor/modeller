import { SceneManager } from './scene.js';
import { ModeManager, Modes } from './tools/modes.js';
import { Toolbar } from './tools/toolbar.js';
import { ImagePlane } from './geometry/plane.js';
import { HistoryManager } from './history/undo.js';
import { StorageManager } from './storage/local.js';

/**
 * Main Application class
 * Coordinates all components of ImageModel
 */
class App {
  constructor() {
    // Get canvas elements
    this.canvas = document.getElementById('canvas');
    this.overlay = document.getElementById('overlay');

    // Initialize managers
    this.scene = new SceneManager(this.canvas);
    this.modeManager = new ModeManager();
    this.history = new HistoryManager();
    this.storage = new StorageManager();

    // Initialize UI
    this.toolbar = new Toolbar(this);

    // State
    this.imagePlane = null;
    this.hasImage = false;
    this.hasMesh = false;
    this.selectedFace = null;
    this.gridSnap = false;

    // Bind methods
    this.updateUI = this.updateUI.bind(this);

    // Listen to mode changes
    this.modeManager.onModeChange(() => this.updateUI());

    // Listen to history changes
    this.history.onChange(() => this.updateUI());

    // Initial UI update
    this.updateUI();

    console.log('ImageModel initialized');
  }

  /**
   * Update toolbar state based on current app state
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
   * @param {File} file
   */
  async importImage(file) {
    try {
      // Remove existing plane if any
      if (this.imagePlane) {
        this.scene.remove(this.imagePlane.mesh);
        this.imagePlane.dispose();
      }

      // Create new image plane
      this.imagePlane = new ImagePlane();
      const mesh = await this.imagePlane.loadFromFile(file);

      // Add to scene
      this.scene.add(mesh);

      // Update state
      this.hasImage = true;
      this.hasMesh = false; // Not a mesh until perspective is corrected
      this.selectedFace = null;

      // Reset camera to view the plane
      this.scene.resetCamera();

      // Switch to perspective mode
      this.modeManager.setMode(Modes.PERSPECTIVE);

      this.updateUI();

      console.log('Image imported:', file.name);
    } catch (error) {
      console.error('Failed to import image:', error);
      alert('Failed to import image. Please try another file.');
    }
  }

  /**
   * Set current tool mode
   * @param {string} mode
   */
  setMode(mode) {
    this.modeManager.setMode(mode);

    // Enable/disable orbit controls based on mode
    const orbitModes = [Modes.IDLE, Modes.SELECT];
    this.scene.setControlsEnabled(orbitModes.includes(mode));

    // Show/hide overlay for 2D modes
    const overlayModes = [Modes.PERSPECTIVE, Modes.CUT];
    this.overlay.style.display = overlayModes.includes(mode) ? 'block' : 'none';
    this.overlay.classList.toggle('active', overlayModes.includes(mode));
  }

  /**
   * Set grid snap on/off
   * @param {boolean} enabled
   */
  setGridSnap(enabled) {
    this.gridSnap = enabled;
    // Grid visibility follows snap setting for now
    this.scene.setGridVisible(enabled);
  }

  /**
   * Set viewport background color
   * @param {string} hexColor
   */
  setBackgroundColor(hexColor) {
    this.scene.setBackgroundColor(hexColor);
  }

  /**
   * Export model as OBJ
   */
  exportOBJ() {
    if (!this.hasMesh) {
      alert('No mesh to export. Complete perspective correction first.');
      return;
    }

    // TODO: Implement OBJ export
    console.log('Export OBJ - not yet implemented');
    alert('Export functionality coming in a future update!');
  }

  /**
   * Undo last action
   */
  undo() {
    const state = this.getSerializableState();
    const previousState = this.history.undo(state);

    if (previousState) {
      this.restoreState(previousState);
    }
  }

  /**
   * Redo last undone action
   */
  redo() {
    const state = this.getSerializableState();
    const nextState = this.history.redo(state);

    if (nextState) {
      this.restoreState(nextState);
    }
  }

  /**
   * Get serializable state for undo/redo
   * @returns {object}
   */
  getSerializableState() {
    // TODO: Implement proper state serialization
    return {
      hasImage: this.hasImage,
      hasMesh: this.hasMesh
    };
  }

  /**
   * Restore state from snapshot
   * @param {object} state
   */
  restoreState(state) {
    // TODO: Implement proper state restoration
    console.log('Restore state:', state);
  }

  /**
   * Save project to local storage
   */
  saveProject() {
    const state = this.getSerializableState();
    const success = this.storage.save(state);

    if (success) {
      console.log('Project saved');
    }
  }

  /**
   * Load project from local storage
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
