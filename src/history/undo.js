/**
 * Undo/Redo history manager
 * Uses a command pattern with state snapshots
 */
export class HistoryManager {
  constructor(maxHistory = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = maxHistory;
    this.listeners = new Set();
  }

  /**
   * Save a state snapshot
   * @param {object} state - State to save
   * @param {string} description - Description of the action
   */
  pushState(state, description = '') {
    // Deep clone the state
    const snapshot = {
      state: JSON.parse(JSON.stringify(state)),
      description,
      timestamp: Date.now()
    };

    this.undoStack.push(snapshot);

    // Clear redo stack when new action is performed
    this.redoStack = [];

    // Limit history size
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    this.notifyListeners();
  }

  /**
   * Undo the last action
   * @param {object} currentState - Current state to save before undoing
   * @returns {object|null} - Previous state or null if nothing to undo
   */
  undo(currentState) {
    if (this.undoStack.length === 0) return null;

    // Save current state to redo stack
    const currentSnapshot = {
      state: JSON.parse(JSON.stringify(currentState)),
      description: 'Current state',
      timestamp: Date.now()
    };
    this.redoStack.push(currentSnapshot);

    // Get previous state
    const previousSnapshot = this.undoStack.pop();
    this.notifyListeners();

    return previousSnapshot.state;
  }

  /**
   * Redo the last undone action
   * @param {object} currentState - Current state to save before redoing
   * @returns {object|null} - Next state or null if nothing to redo
   */
  redo(currentState) {
    if (this.redoStack.length === 0) return null;

    // Save current state to undo stack
    const currentSnapshot = {
      state: JSON.parse(JSON.stringify(currentState)),
      description: 'Current state',
      timestamp: Date.now()
    };
    this.undoStack.push(currentSnapshot);

    // Get next state
    const nextSnapshot = this.redoStack.pop();
    this.notifyListeners();

    return nextSnapshot.state;
  }

  /**
   * Check if undo is available
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   * @returns {boolean}
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all history
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.notifyListeners();
  }

  /**
   * Subscribe to history changes
   * @param {function} callback
   * @returns {function} Unsubscribe function
   */
  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners of changes
   */
  notifyListeners() {
    const state = {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length
    };
    this.listeners.forEach(cb => cb(state));
  }
}
