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
   * Start SignalK services for all boats that have a configured port
   * Note: Each boat gets its own SignalK connection to a different port
   */
  async startAll() {
    try {
      const boats = await Boat.find({
        signalkPort: { $exists: true, $ne: null }
      });

      console.log(`Starting SignalK services for ${boats.length} boat(s)...`);

      for (const boat of boats) {
        await this.startForBoat(boat.boatId, boat.signalkPort, boat.mmsi);
      }

      console.log(`SignalK service manager started with ${this.services.size} service(s)`);
    } catch (err) {
      console.error('Error starting SignalK services:', err.message);
    }
  }

  /**
   * Start SignalK service for a specific boat
   */
  async startForBoat(boatId, port, mmsi) {
    try {
      // Stop existing service if any
      this.stopForBoat(boatId);

      // Construct URL with boat-specific port
      const url = this.baseUrl.replace(/:\d+/, `:${port}`);

      // Create and start new service
      const service = new SignalKService(url, this.token, this.broadcastFunc);
      await service.start();

      this.services.set(boatId, service);
      console.log(`SignalK service started for boat ${boatId} on ${url} (MMSI: ${mmsi || 'none'})`);
    } catch (err) {
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
      if (!boat || !boat.signalkPort) {
        this.stopForBoat(boatId);
        return;
      }

      await this.startForBoat(boatId, boat.signalkPort, boat.mmsi);
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
