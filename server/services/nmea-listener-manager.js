/* ===== NMEA TCP Listener Manager ===== */

const NMEAListener = require('./nmea-listener');
const Boat = require('../models/Boat');

class NMEAListenerManager {
  constructor(broadcastFunc = null) {
    this.listeners = new Map(); // boatId -> NMEAListener instance
    this.broadcastFunc = broadcastFunc;
  }

  /**
   * Start NMEA listeners for all boats that have a configured port
   */
  async startAll() {
    try {
      const boats = await Boat.find({
        nmeaTcpPort: { $exists: true, $ne: null }
      });

      console.log(`Starting NMEA listeners for ${boats.length} boat(s)...`);

      for (const boat of boats) {
        await this.startForBoat(boat.boatId, boat.nmeaTcpPort, boat.mmsi);
      }

      console.log(`NMEA listener manager started with ${this.listeners.size} listener(s)`);
    } catch (err) {
      console.error('Error starting NMEA listeners:', err.message);
    }
  }

  /**
   * Start NMEA listener for a specific boat
   */
  async startForBoat(boatId, port, mmsi) {
    try {
      // Stop existing listener if any
      this.stopForBoat(boatId);

      // Create and start new listener
      const listener = new NMEAListener(port, this.broadcastFunc);
      listener.start();

      this.listeners.set(boatId, listener);
      console.log(`NMEA listener started for boat ${boatId} on port ${port} (MMSI: ${mmsi || 'none'})`);
    } catch (err) {
      console.error(`Error starting NMEA listener for boat ${boatId}:`, err.message);
    }
  }

  /**
   * Stop NMEA listener for a specific boat
   */
  stopForBoat(boatId) {
    const listener = this.listeners.get(boatId);
    if (listener) {
      listener.stop();
      this.listeners.delete(boatId);
      console.log(`NMEA listener stopped for boat ${boatId}`);
    }
  }

  /**
   * Restart NMEA listener for a boat (e.g., after configuration change)
   */
  async restartForBoat(boatId) {
    try {
      const boat = await Boat.findOne({ boatId });
      if (!boat || !boat.nmeaTcpPort) {
        this.stopForBoat(boatId);
        return;
      }

      await this.startForBoat(boatId, boat.nmeaTcpPort, boat.mmsi);
    } catch (err) {
      console.error(`Error restarting NMEA listener for boat ${boatId}:`, err.message);
    }
  }

  /**
   * Stop all NMEA listeners
   */
  stopAll() {
    console.log(`Stopping ${this.listeners.size} NMEA listener(s)...`);
    for (const [boatId, listener] of this.listeners.entries()) {
      listener.stop();
    }
    this.listeners.clear();
    console.log('All NMEA listeners stopped');
  }

  /**
   * Get status of all listeners
   */
  getStatus() {
    const status = [];
    for (const [boatId, listener] of this.listeners.entries()) {
      status.push({
        boatId,
        port: listener.port,
        running: listener.server && listener.server.listening,
        clients: listener.clients.size
      });
    }
    return status;
  }
}

module.exports = NMEAListenerManager;
