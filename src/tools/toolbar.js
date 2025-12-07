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
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');
    this.toggleGrid = document.getElementById('toggle-grid');
    this.bgColor = document.getElementById('bg-color');

    // Mode indicator
    this.modeBar = document.getElementById('current-mode');
    this.instructions = document.getElementById('instructions');

    // File input
    this.fileInput = document.getElementById('file-input');

    // Tool buttons array for easy management
    this.toolButtons = [
      { btn: this.btnPerspective, mode: Modes.PERSPECTIVE },
      { btn: this.btnCut, mode: Modes.CUT },
      { btn: this.btnSelect, mode: Modes.SELECT },
      { btn: this.btnExtrude, mode: Modes.EXTRUDE }
    ];

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

    // Tool buttons
    this.toolButtons.forEach(({ btn, mode }) => {
      btn.addEventListener('click', () => {
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

    // Grid toggle
    this.toggleGrid.addEventListener('change', (e) => {
      this.app.setGridSnap(e.target.checked);
    });

    // Background color
    this.bgColor.addEventListener('input', (e) => {
      this.app.setBackgroundColor(e.target.value);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });
  }

  handleKeydown(e) {
    // Don't handle if typing in input
    if (e.target.tagName === 'INPUT') return;

    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    // Undo: Ctrl+Z
    if (ctrl && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.app.undo();
      return;
    }

    // Redo: Ctrl+Shift+Z or Ctrl+Y
    if ((ctrl && key === 'z' && e.shiftKey) || (ctrl && key === 'y')) {
      e.preventDefault();
      this.app.redo();
      return;
    }

    // Tool shortcuts (when not holding ctrl)
    if (!ctrl) {
      switch (key) {
        case 'p':
          if (!this.btnPerspective.disabled) this.app.setMode(Modes.PERSPECTIVE);
          break;
        case 'c':
          if (!this.btnCut.disabled) this.app.setMode(Modes.CUT);
          break;
        case 's':
          if (!this.btnSelect.disabled) this.app.setMode(Modes.SELECT);
          break;
        case 'e':
          if (!this.btnExtrude.disabled) this.app.setMode(Modes.EXTRUDE);
          break;
        case 'g':
          this.toggleGrid.checked = !this.toggleGrid.checked;
          this.app.setGridSnap(this.toggleGrid.checked);
          break;
        case 'escape':
          this.app.setMode(Modes.IDLE);
          break;
      }
    }

    // Export: Ctrl+E
    if (ctrl && key === 'e') {
      e.preventDefault();
      if (!this.btnExport.disabled) this.app.exportOBJ();
    }
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
    this.btnPerspective.disabled = !hasImage;
    this.btnCut.disabled = !hasMesh;
    this.btnSelect.disabled = !hasMesh;
    this.btnExtrude.disabled = !hasSelection;
    this.btnExport.disabled = !hasMesh;
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;

    // Update active state for tool buttons
    this.toolButtons.forEach(({ btn, mode }) => {
      btn.classList.toggle('active', currentMode === mode);
    });

    // Update mode bar text
    this.modeBar.textContent = state.modeDescription;

    // Update instructions
    if (state.instructions) {
      this.instructions.textContent = state.instructions;
      this.instructions.style.display = 'block';
    } else {
      this.instructions.style.display = 'none';
    }
  }
}
