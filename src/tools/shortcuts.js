import { Modes } from './modes.js';

/**
 * Default keyboard shortcuts
 */
const DEFAULT_SHORTCUTS = {
  import: { key: 'i', description: 'Import image' },
  skip: { key: 's', description: 'Skip / Cancel / Select' },
  perspective: { key: 'p', description: 'Perspective tool' },
  cut: { key: 'c', description: 'Cut tool' },
  extrude: { key: 'e', description: 'Extrude tool' },
  inset: { key: 'f', description: 'Inset tool' },
  grid: { key: 'g', description: 'Toggle grid' },
  undo: { key: 'z', description: 'Undo' },
  redo: { key: 'y', description: 'Redo' },
  confirm: { key: ' ', description: 'Confirm action' },
};

/**
 * Number keys for loading recent images (not customizable)
 */
const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Shortcuts manager - handles keyboard shortcuts and UI
 */
export class ShortcutsManager {
  constructor(app) {
    this.app = app;
    this.shortcuts = this.loadShortcuts();
    this.isListening = false;
    this.listeningAction = null;
    this.overlay = null;

    this.createOverlay();
    this.setupKeyboardHandler();
  }

  /**
   * Load shortcuts from localStorage or use defaults
   */
  loadShortcuts() {
    try {
      const stored = localStorage.getItem('imagemodel_shortcuts');
      if (stored) {
        return { ...DEFAULT_SHORTCUTS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Could not load shortcuts');
    }
    return { ...DEFAULT_SHORTCUTS };
  }

  /**
   * Save shortcuts to localStorage
   */
  saveShortcuts() {
    try {
      localStorage.setItem('imagemodel_shortcuts', JSON.stringify(this.shortcuts));
    } catch (e) {
      console.warn('Could not save shortcuts');
    }
  }

  /**
   * Reset shortcuts to defaults
   */
  resetToDefaults() {
    this.shortcuts = { ...DEFAULT_SHORTCUTS };
    this.saveShortcuts();
    this.renderShortcutsList();
  }

  /**
   * Create the shortcuts overlay UI
   */
  createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'shortcuts-overlay';
    this.overlay.className = 'shortcuts-overlay';
    this.overlay.style.display = 'none';

    this.overlay.innerHTML = `
      <div class="shortcuts-panel two-column">
        <div class="shortcuts-header">
          <h3>Shortcuts</h3>
          <button class="shortcuts-close" title="Close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="shortcuts-columns">
          <div class="shortcuts-column">
            <div class="shortcuts-column-header">Keyboard</div>
            <div class="shortcuts-list"></div>
            <div class="shortcuts-note">
              <span class="shortcut-desc">Load recent image</span>
              <span class="shortcut-fixed">1-9</span>
            </div>
          </div>
          <div class="shortcuts-column">
            <div class="shortcuts-column-header">Mouse</div>
            <div class="shortcuts-mouse">
              <div class="shortcut-item">
                <span class="shortcut-desc">Rotate view</span>
                <span class="shortcut-fixed">Left drag</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-desc">Pan view</span>
                <span class="shortcut-fixed">Middle drag</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-desc">Pan view</span>
                <span class="shortcut-fixed">Right drag</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-desc">Zoom</span>
                <span class="shortcut-fixed">Scroll</span>
              </div>
            </div>
            <div class="shortcuts-column-header">Touch</div>
            <div class="shortcuts-mouse">
              <div class="shortcut-item">
                <span class="shortcut-desc">Rotate view</span>
                <span class="shortcut-fixed">1 finger</span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-desc">Pan & Zoom</span>
                <span class="shortcut-fixed">2 fingers</span>
              </div>
            </div>
          </div>
        </div>
        <div class="shortcuts-footer">
          <button class="shortcuts-reset">Reset to Defaults</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Close button
    this.overlay.querySelector('.shortcuts-close').addEventListener('click', () => {
      this.hide();
    });

    // Click outside to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    // Reset button
    this.overlay.querySelector('.shortcuts-reset').addEventListener('click', () => {
      this.resetToDefaults();
    });

    this.renderShortcutsList();
  }

  /**
   * Render the shortcuts list
   */
  renderShortcutsList() {
    const list = this.overlay.querySelector('.shortcuts-list');
    list.innerHTML = '';

    for (const [action, config] of Object.entries(this.shortcuts)) {
      const item = document.createElement('div');
      item.className = 'shortcut-item';

      const keyDisplay = this.formatKey(config);

      item.innerHTML = `
        <span class="shortcut-desc">${config.description}</span>
        <button class="shortcut-key" data-action="${action}">${keyDisplay}</button>
      `;

      list.appendChild(item);
    }

    // Add click handlers for rebinding
    list.querySelectorAll('.shortcut-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.startListening(e.target.dataset.action, e.target);
      });
    });
  }

  /**
   * Format key for display
   */
  formatKey(config) {
    let key = config.key;

    // Special key names
    if (key === ' ') key = 'Space';
    else if (key === 'escape') key = 'Esc';
    else key = key.toUpperCase();

    if (config.ctrl) {
      return `Ctrl+${key}`;
    }
    return key;
  }

  /**
   * Start listening for a new key binding
   */
  startListening(action, buttonEl) {
    // Cancel any previous listening
    if (this.listeningButton) {
      this.listeningButton.classList.remove('listening');
      this.listeningButton.textContent = this.formatKey(this.shortcuts[this.listeningAction]);
    }

    this.isListening = true;
    this.listeningAction = action;
    this.listeningButton = buttonEl;

    buttonEl.classList.add('listening');
    buttonEl.textContent = 'Press key...';
  }

  /**
   * Stop listening and apply new binding
   */
  stopListening(key, ctrl = false) {
    if (!this.isListening) return;

    // Check for conflicts
    const conflict = this.findConflict(key, ctrl);
    if (conflict && conflict !== this.listeningAction) {
      // Swap keys
      this.shortcuts[conflict].key = this.shortcuts[this.listeningAction].key;
      this.shortcuts[conflict].ctrl = this.shortcuts[this.listeningAction].ctrl;
    }

    // Apply new binding
    this.shortcuts[this.listeningAction].key = key;
    this.shortcuts[this.listeningAction].ctrl = ctrl;

    this.isListening = false;
    this.listeningAction = null;
    this.listeningButton = null;

    this.saveShortcuts();
    this.renderShortcutsList();
  }

  /**
   * Find action with conflicting key
   */
  findConflict(key, ctrl) {
    for (const [action, config] of Object.entries(this.shortcuts)) {
      if (config.key === key && !!config.ctrl === ctrl) {
        return action;
      }
    }
    return null;
  }

  /**
   * Setup keyboard handler
   */
  setupKeyboardHandler() {
    document.addEventListener('keydown', (e) => {
      // Handle rebinding mode
      if (this.isListening) {
        e.preventDefault();
        const key = e.key.toLowerCase();

        // Don't allow certain keys
        if (['control', 'alt', 'shift', 'meta'].includes(key)) return;

        this.stopListening(key, e.ctrlKey || e.metaKey);
        return;
      }

      // Don't handle if typing in input or overlay is open
      if (e.target.tagName === 'INPUT') return;
      if (this.overlay.style.display !== 'none') {
        if (e.key === 'Escape') this.hide();
        return;
      }

      this.handleShortcut(e);
    });
  }

  /**
   * Handle keyboard shortcut
   */
  handleShortcut(e) {
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    // Handle number keys for recent images (1-9)
    if (!ctrl && NUMBER_KEYS.includes(e.key)) {
      const index = parseInt(e.key) - 1; // 1 = index 0
      if (this.app.recentImages && index < this.app.recentImages.length) {
        e.preventDefault();
        this.app.loadRecentImage(index);
        return;
      }
    }

    // Find matching shortcut
    for (const [action, config] of Object.entries(this.shortcuts)) {
      if (config.key === key && !!config.ctrl === ctrl) {
        e.preventDefault();
        this.executeAction(action);
        return;
      }
    }
  }

  /**
   * Execute shortcut action
   */
  executeAction(action) {
    const app = this.app;
    const toolbar = app.toolbar;

    switch (action) {
      case 'import':
        toolbar.fileInput.click();
        break;

      case 'skip':
        if (app.pendingCancelAction) {
          app.executeCancel();
        } else if (app.modeManager.isMode(Modes.PERSPECTIVE)) {
          app.skipPerspective();
        } else if (!toolbar.btnSelect.disabled) {
          app.setMode(Modes.SELECT);
        }
        break;

      case 'perspective':
        if (!toolbar.btnPerspective.disabled) app.setMode(Modes.PERSPECTIVE);
        break;

      case 'cut':
        if (!toolbar.btnCut.disabled) app.setMode(Modes.CUT);
        break;

      case 'extrude':
        if (!toolbar.btnExtrude.disabled) app.setMode(Modes.EXTRUDE);
        break;

      case 'inset':
        if (!toolbar.btnInset.disabled) app.setMode(Modes.INSET);
        break;

      case 'grid':
        app.toggleGridVisibility();
        break;

      case 'undo':
        app.undo();
        break;

      case 'redo':
        app.redo();
        break;

      case 'confirm':
        if (app.pendingAction) {
          app.executeApprove();
        }
        break;
    }
  }

  /**
   * Show shortcuts overlay
   */
  show() {
    this.overlay.style.display = 'flex';
  }

  /**
   * Hide shortcuts overlay
   */
  hide() {
    // Cancel listening if active
    if (this.isListening && this.listeningButton) {
      this.listeningButton.classList.remove('listening');
      this.listeningButton.textContent = this.formatKey(this.shortcuts[this.listeningAction]);
    }
    this.isListening = false;
    this.listeningAction = null;
    this.listeningButton = null;

    this.overlay.style.display = 'none';
  }

  /**
   * Toggle overlay visibility
   */
  toggle() {
    if (this.overlay.style.display === 'none') {
      this.show();
    } else {
      this.hide();
    }
  }
}
