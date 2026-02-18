/**
 * Location Queue Module
 * Handles offline queueing of failed location sends with persistent IndexedDB storage
 * and exponential backoff retry logic
 */

const LocationQueue = (() => {
  const DB_NAME = 'akz_tracker';
  const STORE_NAME = 'location_queue';
  const DB_VERSION = 1;

  // Retry config
  const RETRY_DELAYS = [30000, 60000, 300000]; // 30s, 60s, 5min (milliseconds)
  const MAX_RETRIES = 3;
  const QUEUE_TTL = 3600000; // 1 hour in milliseconds
  const API_BASE = window.config?.API_BASE || window.location.origin;

  let db = null;
  let isRetrying = false;
  let onQueueChangeCallback = null;

  /**
   * Initialize IndexedDB
   */
  const openDB = () => {
    return new Promise((resolve, reject) => {
      if (db) {
        resolve(db);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('boatId', 'boatId', { unique: false });
          store.createIndex('retries', 'retries', { unique: false });
        }
      };
    });
  };

  /**
   * Queue a failed location
   */
  const queueLocation = async (boatId, locationData) => {
    try {
      await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const item = {
        boatId,
        locationData,
        source: locationData.source || 'phone',
        timestamp: Date.now(),
        retries: 0,
        lastRetry: null
      };

      const result = store.add(item);

      return new Promise((resolve, reject) => {
        result.onsuccess = () => {
          console.log(
            `[LocationQueue] Queued location for boat ${boatId} (Queue size: ${result})`
          );
          notifyQueueChange();
          resolve(result.result);
        };
        result.onerror = () => reject(result.error);
      });
    } catch (err) {
      console.error('[LocationQueue] Error queueing location:', err);
    }
  };

  /**
   * Get all queued locations
   */
  const getAllQueued = async () => {
    try {
      await openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[LocationQueue] Error retrieving queued items:', err);
      return [];
    }
  };

  /**
   * Get queue status
   */
  const getQueueCount = async () => {
    try {
      await openDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[LocationQueue] Error getting queue count:', err);
      return 0;
    }
  };

  /**
   * Retry queued locations with exponential backoff
   */
  const retryQueue = async () => {
    if (isRetrying) {
      console.log('[LocationQueue] Retry already in progress, skipping');
      return;
    }

    if (!navigator.onLine) {
      console.log('[LocationQueue] Still offline, retry skipped');
      return;
    }

    isRetrying = true;

    try {
      const queued = await getAllQueued();
      if (queued.length === 0) {
        console.log('[LocationQueue] Queue is empty');
        isRetrying = false;
        return;
      }

      console.log(`[LocationQueue] Attempting to retry ${queued.length} items`);

      for (const item of queued) {
        const delayIndex = Math.min(item.retries, RETRY_DELAYS.length - 1);
        const retryDelay = RETRY_DELAYS[delayIndex];
        const timeSinceLastRetry = Date.now() - (item.lastRetry || item.timestamp);

        // Check if enough time has passed for retry
        if (timeSinceLastRetry < retryDelay) {
          console.log(
            `[LocationQueue] Item ${item.id} not ready for retry yet (${Math.ceil(
              (retryDelay - timeSinceLastRetry) / 1000
            )}s remaining)`
          );
          continue;
        }

        // Check if item has expired
        if (Date.now() - item.timestamp > QUEUE_TTL) {
          console.log(
            `[LocationQueue] Item ${item.id} expired (age: ${Math.round(
              (Date.now() - item.timestamp) / 60000
            )}min)`
          );
          await deleteQueueItem(item.id);
          notifyQueueChange();
          continue;
        }

        // Attempt to send
        const success = await sendLocation(item);

        if (success) {
          await deleteQueueItem(item.id);
          console.log(`[LocationQueue] Item ${item.id} sent successfully and removed`);
          notifyQueueChange();
        } else {
          // Increment retry count and update last retry time
          await updateQueueItem(item.id, {
            retries: item.retries + 1,
            lastRetry: Date.now()
          });
          console.log(
            `[LocationQueue] Item ${item.id} retry failed (attempt ${item.retries + 1}/${MAX_RETRIES})`
          );

          // Remove if max retries exceeded
          if (item.retries + 1 >= MAX_RETRIES) {
            console.warn(`[LocationQueue] Item ${item.id} exceeded max retries, removing`);
            await deleteQueueItem(item.id);
            notifyQueueChange();
          }
        }

        // Small delay between retries to avoid overwhelming server
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (err) {
      console.error('[LocationQueue] Error during retry:', err);
    } finally {
      isRetrying = false;
    }
  };

  /**
   * Delete expired items from queue
   */
  const deleteExpired = async () => {
    try {
      await openDB();
      const queued = await getAllQueued();
      const now = Date.now();

      for (const item of queued) {
        if (now - item.timestamp > QUEUE_TTL) {
          await deleteQueueItem(item.id);
          console.log(`[LocationQueue] Expired item ${item.id} deleted`);
        }
      }

      notifyQueueChange();
    } catch (err) {
      console.error('[LocationQueue] Error deleting expired items:', err);
    }
  };

  /**
   * Delete item from queue
   */
  const deleteQueueItem = async (id) => {
    try {
      await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error(`[LocationQueue] Error deleting item ${id}:`, err);
    }
  };

  /**
   * Update queue item properties
   */
  const updateQueueItem = async (id, updates) => {
    try {
      await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
          const item = getRequest.result;
          if (!item) {
            reject(new Error(`Item ${id} not found`));
            return;
          }
          const updated = { ...item, ...updates };
          const updateRequest = store.put(updated);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
      });
    } catch (err) {
      console.error(`[LocationQueue] Error updating item ${id}:`, err);
    }
  };

  /**
   * Send location to server
   */
  const sendLocation = async (queueItem) => {
    try {
      const response = await fetch(`${API_BASE}/api/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(queueItem.locationData)
      });

      if (response.ok) {
        return true;
      } else if (response.status === 401) {
        console.error('[LocationQueue] Invalid PIN - removing item from queue');
        return true; // Don't retry auth failures
      } else {
        console.warn(`[LocationQueue] Server returned ${response.status}`);
        return false;
      }
    } catch (err) {
      console.warn('[LocationQueue] Network error during send:', err.message);
      return false;
    }
  };

  /**
   * Clear entire queue
   */
  const clearQueue = async () => {
    try {
      await openDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => {
          console.log('[LocationQueue] Queue cleared');
          notifyQueueChange();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[LocationQueue] Error clearing queue:', err);
    }
  };

  /**
   * Register callback for queue changes
   */
  const onQueueChange = (callback) => {
    onQueueChangeCallback = callback;
  };

  /**
   * Notify listeners of queue changes
   */
  const notifyQueueChange = async () => {
    if (onQueueChangeCallback) {
      const count = await getQueueCount();
      onQueueChangeCallback(count, navigator.onLine);
    }
  };

  // Clean up expired items periodically
  setInterval(() => {
    deleteExpired();
  }, 60000); // Every minute

  return {
    openDB,
    queueLocation,
    retryQueue,
    getQueueCount,
    getAllQueued,
    deleteExpired,
    clearQueue,
    onQueueChange
  };
})();
