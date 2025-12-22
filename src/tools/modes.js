/**
 * Application modes/states
 */
export const Modes = {
  IDLE: 'idle',
  PERSPECTIVE: 'perspective',
  CUT: 'cut',
  SELECT: 'select',
  EXTRUDE: 'extrude',
  INSET: 'inset'
};

/**
 * Mode descriptions for UI
 */
export const ModeDescriptions = {
  [Modes.IDLE]: 'Ready - Import an image to begin',
  [Modes.PERSPECTIVE]: 'Draw two lines to correct perspective (X-axis, then Y-axis)',
  [Modes.CUT]: 'Click on an edge, then another edge to cut the face',
  [Modes.SELECT]: 'Click on a face to select it',
  [Modes.EXTRUDE]: 'Drag selected face to extrude or intrude',
  [Modes.INSET]: 'Drag selected face to inset',
  [Modes.DELETE]: 'Click on a face to delete it'
};

/**
 * Mode instructions (only shown for perspective mode)
 */
export const ModeInstructions = {
  [Modes.PERSPECTIVE]: 'Step 1: Draw a line along a horizontal edge in your image'
};

/**
 * Mode manager - handles tool state
 */
export class ModeManager {
  constructor() {
    this.currentMode = Modes.IDLE;
    this.previousMode = null;
    this.listeners = new Set();
  }

  /**
   * Set the current mode
   * @param {string} mode - One of Modes values
   */
  setMode(mode) {
    if (this.currentMode === mode) return;

    this.previousMode = this.currentMode;
    this.currentMode = mode;

    // Notify listeners
    this.listeners.forEach(callback => {
      callback(mode, this.previousMode);
    });
  }

  /**
   * Get current mode
   * @returns {string}
   */
  getMode() {
    return this.currentMode;
  }

  /**
   * Check if in a specific mode
   * @param {string} mode
   * @returns {boolean}
   */
  isMode(mode) {
    return this.currentMode === mode;
  }

  /**
   * Subscribe to mode changes
   * @param {function} callback - Called with (newMode, oldMode)
   * @returns {function} Unsubscribe function
   */
  onModeChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get description for current mode
   * @returns {string}
   */
  getDescription() {
    return ModeDescriptions[this.currentMode] || '';
  }

  /**
   * Get instructions for current mode
   * @returns {string|null}
   */
  getInstructions() {
    return ModeInstructions[this.currentMode] || null;
  }
}
