import { Modes } from './modes.js';

/**
 * Toolbar UI controller
 */
export class Toolbar {
  constructor(app) {
    this.app = app;

    // Get button references
    this.btnImport = document.getElementById('btn-import');
    this.btnExport = document.getElementById('btn-export');
    this.btnPerspective = document.getElementById('btn-perspective');
    this.btnCut = document.getElementById('btn-cut');
    this.btnSelect = document.getElementById('btn-select');
    this.btnExtrude = document.getElementById('btn-extrude');
    this.btnInset = document.getElementById('btn-inset');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');

    // Instructions tooltip
    this.instructions = document.getElementById('instructions');

    // File input
    this.fileInput = document.getElementById('file-input');

    // Tool buttons array for easy management
    this.toolButtons = [
      { btn: this.btnPerspective, mode: Modes.PERSPECTIVE },
      { btn: this.btnCut, mode: Modes.CUT },
      { btn: this.btnSelect, mode: Modes.SELECT },
      { btn: this.btnExtrude, mode: Modes.EXTRUDE },
      { btn: this.btnInset, mode: Modes.INSET }
    ];

    // Double-tap detection for tool mode toggle
    this.lastTapTime = {};
    this.doubleTapDelay = 300; // ms

    // Tool mode states (for tools with alternate modes)
    this.toolModes = {
      inset: false  // false = region, true = individual
    };

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Import button
    this.btnImport.addEventListener('click', () => {
      this.fileInput.click();
    });

    // File input change
    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.app.importImage(file);
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    });

    // Export button
    this.btnExport.addEventListener('click', () => {
      this.app.exportOBJ();
    });

    // Tool buttons with double-tap detection for mode toggle
    this.toolButtons.forEach(({ btn, mode }) => {
      btn.addEventListener('click', () => {
        const now = Date.now();
        const lastTap = this.lastTapTime[mode] || 0;
        const isDoubleTap = (now - lastTap) < this.doubleTapDelay;
        this.lastTapTime[mode] = now;

        // Handle double-tap for tools with alternate modes
        if (mode === Modes.INSET && isDoubleTap) {
          // Toggle inset individual mode
          this.toggleInsetMode();
          return;
        }

        this.app.setMode(mode);
      });
    });

    // Undo/Redo
    this.btnUndo.addEventListener('click', () => {
      this.app.undo();
    });

    this.btnRedo.addEventListener('click', () => {
      this.app.redo();
    });
  }

  /**
   * Toggle inset tool individual mode
   */
  toggleInsetMode() {
    this.toolModes.inset = !this.toolModes.inset;

    // Update the button visual
    this.btnInset.classList.toggle('mode-alternate', this.toolModes.inset);

    // Notify the app/inset tool
    if (this.app.insetTool) {
      this.app.insetTool.setIndividualMode(this.toolModes.inset);
    }
  }

  /**
   * Set inset mode directly (for keyboard shortcut sync)
   * @param {boolean} individual - Whether individual mode is enabled
   */
  setInsetMode(individual) {
    this.toolModes.inset = individual;
    this.btnInset.classList.toggle('mode-alternate', individual);
  }

  /**
   * Update toolbar state based on app state
   * @param {object} state - App state
   */
  updateState(state) {
    const hasImage = state.hasImage;
    const hasMesh = state.hasMesh;
    const hasSelection = state.hasSelection;
    const currentMode = state.mode;
    const canUndo = state.canUndo;
    const canRedo = state.canRedo;

    // Enable/disable buttons based on state
    // Extrude and Inset are enabled when mesh exists (can select face on tap)
    this.btnPerspective.disabled = !hasImage;
    this.btnCut.disabled = !hasMesh;
    this.btnSelect.disabled = !hasMesh;
    this.btnExtrude.disabled = !hasMesh;
    this.btnInset.disabled = !hasMesh;
    this.btnExport.disabled = !hasMesh;
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;

    // Update active state for tool buttons
    this.toolButtons.forEach(({ btn, mode }) => {
      btn.classList.toggle('active', currentMode === mode);
    });

    // Maintain mode-alternate class for inset button when active
    if (currentMode === Modes.INSET) {
      this.btnInset.classList.toggle('mode-alternate', this.toolModes.inset);
    }

    // Update instructions
    if (state.instructions) {
      this.instructions.innerHTML = `
        <h4>${state.modeDescription}</h4>
        <p>${state.instructions}</p>
      `;
      this.instructions.style.display = 'block';
    } else {
      this.instructions.style.display = 'none';
    }
  }
}
