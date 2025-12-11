import { Modes } from './modes.js';

/**
 * Default keyboard shortcuts organized by category
 */
const DEFAULT_SHORTCUTS = {
  // Action category
  import: { key: 'i', description: 'Import image', category: 'action' },
  confirm: { key: ' ', description: 'Confirm Action', category: 'action' },
  skip: { key: 's', description: 'Skip Action', category: 'action' },
  undo: { key: 'z', description: 'Undo', category: 'action' },
  redo: { key: 'x', description: 'Redo', category: 'action' },

  // Tools category
  perspective: { key: 'p', description: 'Perspective Align', category: 'tools' },
  cut: { key: 'c', description: 'Cut', category: 'tools' },
  extrude: { key: 'e', description: 'Extrude', category: 'tools' },
  inset: { key: 'f', description: 'Inset', category: 'tools' },

  // Scene category
  cameraReset: { key: 'j', description: 'Camera Reset', category: 'scene' },
  grid: { key: 'k', description: 'Toggle Grid', category: 'scene' },
  snapGrid: { key: 'l', description: 'Snap Grid', category: 'scene' },
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
      <div class="shortcuts-modal">
        <div class="shortcuts-content">
          <!-- Keyboard Section -->
          <div class="shortcuts-section">
            <div class="shortcuts-section-title">Keyboard</div>
            <div class="shortcuts-keyboard-grid">
              <!-- Action Column -->
              <div class="shortcuts-column">
                <div class="shortcuts-column-header">Action</div>
                <div class="shortcuts-list" data-category="action"></div>
              </div>
              <!-- Tools Column -->
              <div class="shortcuts-column">
                <div class="shortcuts-column-header">Tools</div>
                <div class="shortcuts-list" data-category="tools"></div>
              </div>
              <!-- Scene Column -->
              <div class="shortcuts-column">
                <div class="shortcuts-column-header">Scene</div>
                <div class="shortcuts-list" data-category="scene"></div>
                <div class="shortcut-row">
                  <span class="shortcut-label">Load Recent Image</span>
                  <span class="shortcut-value">1 - 9</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div class="shortcuts-divider"></div>

          <!-- Mouse & Touch Section -->
          <div class="shortcuts-section">
            <div class="shortcuts-input-grid">
              <!-- Mouse Column -->
              <div class="shortcuts-column">
                <div class="shortcuts-section-title">Mouse</div>
                <div class="shortcuts-input-list">
                  <div class="shortcut-row">
                    <span class="shortcut-label">Rotate</span>
                    <span class="shortcut-value">Left Drag</span>
                  </div>
                  <div class="shortcut-row">
                    <span class="shortcut-label">Pan</span>
                    <span class="shortcut-value">Middle Drag</span>
                  </div>
                  <div class="shortcut-row">
                    <span class="shortcut-label">Zoom</span>
                    <span class="shortcut-value">Scroll Wheel</span>
                  </div>
                </div>
              </div>
              <!-- Touch Column -->
              <div class="shortcuts-column">
                <div class="shortcuts-section-title">Touch</div>
                <div class="shortcuts-input-list">
                  <div class="shortcut-row">
                    <span class="shortcut-label">Rotate</span>
                    <span class="shortcut-value">1 Finger</span>
                  </div>
                  <div class="shortcut-row">
                    <span class="shortcut-label">Pan & Zoom</span>
                    <span class="shortcut-value">2 Fingers</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div class="shortcuts-divider"></div>

          <!-- Footer -->
          <div class="shortcuts-footer">
            <button class="shortcuts-btn shortcuts-reset">Restore Defaults</button>
            <button class="shortcuts-btn shortcuts-close">Close</button>
          </div>
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
    // Get all category lists
    const categories = ['action', 'tools', 'scene'];

    categories.forEach(category => {
      const list = this.overlay.querySelector(`.shortcuts-list[data-category="${category}"]`);
      if (!list) return;

      list.innerHTML = '';

      for (const [action, config] of Object.entries(this.shortcuts)) {
        if (config.category !== category) continue;

        const item = document.createElement('div');
        item.className = 'shortcut-row';

        const keyDisplay = this.formatKey(config);

        item.innerHTML = `
          <span class="shortcut-label">${config.description}</span>
          <button class="shortcut-key" data-action="${action}">${keyDisplay}</button>
        `;

        list.appendChild(item);
      }
    });

    // Add click handlers for rebinding
    this.overlay.querySelectorAll('.shortcut-key').forEach(btn => {
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

      case 'cameraReset':
        if (app.sceneManager) {
          app.sceneManager.resetCamera();
        }
        break;

      case 'snapGrid':
        if (app.toggleSnapGrid) {
          app.toggleSnapGrid();
        }
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
