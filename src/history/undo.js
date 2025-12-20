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
    const serialized = JSON.stringify(state);
    const snapshot = {
      state: JSON.parse(serialized),
      description,
      timestamp: Date.now()
    };

    // Prevent pushing duplicate consecutive states which break undo/redo sequencing
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && JSON.stringify(top.state) === serialized) {
      // Update description/timestamp for the existing top entry instead of duplicating
      top.description = description || top.description;
      top.timestamp = snapshot.timestamp;
      this.notifyListeners();
      return;
    }

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
    // Need at least 2 states: initial state + at least one action to undo
    if (this.undoStack.length < 2) return null;

    // Pop the current state from undo stack and save to redo stack
    const currentSnapshot = this.undoStack.pop();
    this.redoStack.push(currentSnapshot);

    // Return the previous state (now at the top of the stack)
    const previousSnapshot = this.undoStack[this.undoStack.length - 1];
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

    // Pop from redo stack and push to undo stack
    const nextSnapshot = this.redoStack.pop();
    this.undoStack.push(nextSnapshot);

    this.notifyListeners();

    return nextSnapshot.state;
  }

  /**
   * Check if undo is available
   * @returns {boolean}
   */
  canUndo() {
    // Need at least 2 states: initial + one action to undo
    return this.undoStack.length > 1;
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
