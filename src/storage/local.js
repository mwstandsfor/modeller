/**
 * Storage Manager using IndexedDB
 * Handles auto-saving project state without freezing the UI
 */

const AUTOSAVE_KEY = 'autosave';

export class StorageManager {
  constructor(dbName = 'LazyImage_DB', storeName = 'projects') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
    this.dbReady = this.initDB();
  }

  /**
   * Initialize the database connection
   */
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  /**
   * Save project state
   * @param {object} state - The data to save
   * @param {string} key - Save key (default: autosave)
   */
  async save(state, key = AUTOSAVE_KEY) {
    try {
      await this.dbReady;

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);

        const dataWrapper = {
          version: 1,
          timestamp: Date.now(),
          state
        };

        const request = store.put(dataWrapper, key);

        request.onsuccess = () => {
          console.log('Project auto-saved');
          resolve(true);
        };
        request.onerror = () => {
          console.error('Failed to save:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('Failed to save to IndexedDB:', e);
      return false;
    }
  }

  /**
   * Load project state
   * @param {string} key - Save key (default: autosave)
   */
  async load(key = AUTOSAVE_KEY) {
    try {
      await this.dbReady;

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.state : null);
        };
        request.onerror = () => {
          console.error('Failed to load:', request.error);
          reject(request.error);
        };
      });
    } catch (e) {
      console.error('Failed to load from IndexedDB:', e);
      return null;
    }
  }

  /**
   * Check if a saved project exists
   * @param {string} key - Save key (default: autosave)
   */
  async hasSavedProject(key = AUTOSAVE_KEY) {
    const data = await this.load(key);
    return data !== null;
  }

  /**
   * Clear saved data
   * @param {string} key - Save key (default: autosave)
   */
  async clear(key = AUTOSAVE_KEY) {
    try {
      await this.dbReady;

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error('Failed to clear IndexedDB:', e);
      return false;
    }
  }

  /**
   * Get last save timestamp
   * @param {string} key - Save key (default: autosave)
   */
  async getLastSaveTime(key = AUTOSAVE_KEY) {
    try {
      await this.dbReady;

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.timestamp : null);
        };
        request.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }
}
