/* ===== SignalK Service Manager ===== */

const SignalKService = require('./signalk');
const Boat = require('../models/Boat');

class SignalKServiceManager {
  constructor(baseUrl, token, broadcastFunc = null) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.services = new Map(); // boatId -> SignalKService instance
    this.broadcastFunc = broadcastFunc;
  }

  /**
   * Start SignalK services for all boats that have a configured SignalK URL
   * Note: Each boat gets its own SignalK connection
   */
  async startAll() {
    try {
      // Find boats with either per-boat URL or that can use global config
      const boats = await Boat.find({
        $or: [
          { signalkUrl: { $exists: true, $ne: null, $ne: '' } },
          // If baseUrl is set globally and boat has port, use it
          ...(this.baseUrl ? [{ signalkPort: { $exists: true, $ne: null } }] : [])
        ]
      });

      console.log(`Starting SignalK services for ${boats.length} boat(s)...`);

      for (const boat of boats) {
        await this.startForBoat(boat);
      }

      console.log(`SignalK service manager started with ${this.services.size} service(s)`);
    } catch (err) {
      console.error('Error starting SignalK services:', err.message);
    }
  }

  /**
   * Start SignalK service for a specific boat
   * @param {Object|string} boatOrId - Boat object or boatId string
   * @param {number} [legacyPort] - Legacy parameter (ignored if boat object passed)
   * @param {string} [legacyMmsi] - Legacy parameter (ignored if boat object passed)
   */
  async startForBoat(boatOrId, legacyPort, legacyMmsi) {
    try {
      // Support both new (boat object) and legacy (separate params) calling styles
      let boat;
      if (typeof boatOrId === 'string') {
        // Legacy: fetch boat from database
        boat = await Boat.findOne({ boatId: boatOrId });
        if (!boat) {
          console.error(`Boat ${boatOrId} not found`);
          return;
        }
      } else {
        // New: boat object passed directly
        boat = boatOrId;
      }

      // Stop existing service if any
      this.stopForBoat(boat.boatId);

      // Determine URL and token for this boat
      let url, token;
      
      if (boat.signalkUrl) {
        // Use per-boat configuration
        url = boat.signalkUrl;
        token = boat.signalkToken || '';
        console.log(`Using per-boat SignalK config for ${boat.boatId}`);
      } else if (this.baseUrl && boat.signalkPort) {
        // Fallback to global URL with boat-specific port
        url = this.baseUrl.replace(/:\d+/, `:${boat.signalkPort}`);
        token = this.token;
        console.log(`Using global SignalK URL with per-boat port for ${boat.boatId}`);
      } else {
        console.log(`No SignalK configuration for boat ${boat.boatId}, skipping`);
        return;
      }

      // Create and start new service
      const service = new SignalKService(url, token, this.broadcastFunc);
      await service.start();

      this.services.set(boat.boatId, service);
      console.log(`SignalK service started for boat ${boat.boatId} on ${url} (MMSI: ${boat.mmsi || 'none'})`);
    } catch (err) {
      const boatId = typeof boatOrId === 'string' ? boatOrId : boatOrId.boatId;
      console.error(`Error starting SignalK service for boat ${boatId}:`, err.message);
    }
  }

  /**
   * Stop SignalK service for a specific boat
   */
  stopForBoat(boatId) {
    const service = this.services.get(boatId);
    if (service) {
      service.stop();
      this.services.delete(boatId);
      console.log(`SignalK service stopped for boat ${boatId}`);
    }
  }

  /**
   * Restart SignalK service for a boat (e.g., after configuration change)
   */
  async restartForBoat(boatId) {
    try {
      const boat = await Boat.findOne({ boatId });
      if (!boat) {
        this.stopForBoat(boatId);
        return;
      }

      // Check if boat has SignalK configuration
      const hasConfig = boat.signalkUrl || (this.baseUrl && boat.signalkPort);
      if (!hasConfig) {
        this.stopForBoat(boatId);
        return;
      }

      await this.startForBoat(boat);
    } catch (err) {
      console.error(`Error restarting SignalK service for boat ${boatId}:`, err.message);
    }
  }

  /**
   * Stop all SignalK services
   */
  stopAll() {
    console.log(`Stopping ${this.services.size} SignalK service(s)...`);
    for (const [boatId, service] of this.services.entries()) {
      service.stop();
    }
    this.services.clear();
    console.log('All SignalK services stopped');
  }

  /**
   * Get status of all services
   */
  getStatus() {
    const status = [];
    for (const [boatId, service] of this.services.entries()) {
      status.push({
        boatId,
        url: service.url,
        connected: service.connected
      });
    }
    return status;
  }
}

module.exports = SignalKServiceManager;
