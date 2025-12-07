/**
 * Local storage manager for saving/loading projects
 */
export class StorageManager {
  constructor(storageKey = 'imagemodel_project') {
    this.storageKey = storageKey;
  }

  /**
   * Save project state to local storage
   * @param {object} state - Project state to save
   */
  save(state) {
    try {
      const data = JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        state
      });
      localStorage.setItem(this.storageKey, data);
      return true;
    } catch (e) {
      console.error('Failed to save project:', e);
      return false;
    }
  }

  /**
   * Load project state from local storage
   * @returns {object|null} - Project state or null if none exists
   */
  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (!data) return null;

      const parsed = JSON.parse(data);
      return parsed.state;
    } catch (e) {
      console.error('Failed to load project:', e);
      return null;
    }
  }

  /**
   * Check if a saved project exists
   * @returns {boolean}
   */
  hasSavedProject() {
    return localStorage.getItem(this.storageKey) !== null;
  }

  /**
   * Delete saved project
   */
  clear() {
    localStorage.removeItem(this.storageKey);
  }

  /**
   * Get last save timestamp
   * @returns {number|null}
   */
  getLastSaveTime() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (!data) return null;

      const parsed = JSON.parse(data);
      return parsed.timestamp;
    } catch (e) {
      return null;
    }
  }
}
