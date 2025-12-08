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

    // Mode indicator
    this.modeBar = document.getElementById('mode-bar');
    this.currentMode = document.getElementById('current-mode');
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

    // Enter key to approve pending action
    if (key === 'enter' && this.app.pendingAction) {
      e.preventDefault();
      this.app.executeApprove();
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
        case 'i':
          if (!this.btnInset.disabled) this.app.setMode(Modes.INSET);
          break;
        case 'g':
          this.app.toggleGridVisibility();
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
    this.btnInset.disabled = !hasSelection;
    this.btnExport.disabled = !hasMesh;
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;

    // Update active state for tool buttons
    this.toolButtons.forEach(({ btn, mode }) => {
      btn.classList.toggle('active', currentMode === mode);
    });

    // Update mode bar (shown during operations)
    if (state.modeDescription && currentMode !== Modes.IDLE && currentMode !== Modes.SELECT) {
      this.currentMode.textContent = state.modeDescription;
      this.modeBar.style.display = 'block';
    } else {
      this.modeBar.style.display = 'none';
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
