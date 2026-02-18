/* ===== AT4 GPS Tracker TCP Listener Manager ===== */

const AT4Listener = require('./at4-listener');
const Boat = require('../models/Boat');

class AT4ListenerManager {
  constructor(broadcastFunc = null) {
    this.listeners = new Map(); // boatId -> AT4Listener instance
    this.broadcastFunc = broadcastFunc;
  }

  /**
   * Start AT4 listeners for all boats that have a configured port
   */
  async startAll() {
    try {
      const boats = await Boat.find({
        at4TcpPort: { $exists: true, $ne: null }
      });

      console.log(`Starting AT4 listeners for ${boats.length} boat(s)...`);

      for (const boat of boats) {
        await this.startForBoat(boat.boatId, boat.at4TcpPort, boat.mmsi);
      }

      console.log(`AT4 listener manager started with ${this.listeners.size} listener(s)`);
    } catch (err) {
      console.error('Error starting AT4 listeners:', err.message);
    }
  }

  /**
   * Start AT4 listener for a specific boat
   */
  async startForBoat(boatId, port, mmsi) {
    try {
      // Stop existing listener if any
      this.stopForBoat(boatId);

      // Create and start new listener
      const listener = new AT4Listener(port, this.broadcastFunc);
      listener.start();

      this.listeners.set(boatId, listener);
      console.log(`AT4 listener started for boat ${boatId} on port ${port} (MMSI/IMEI: ${mmsi || 'none'})`);
    } catch (err) {
      console.error(`Error starting AT4 listener for boat ${boatId}:`, err.message);
    }
  }

  /**
   * Stop AT4 listener for a specific boat
   */
  stopForBoat(boatId) {
    const listener = this.listeners.get(boatId);
    if (listener) {
      listener.stop();
      this.listeners.delete(boatId);
      console.log(`AT4 listener stopped for boat ${boatId}`);
    }
  }

  /**
   * Restart AT4 listener for a boat (e.g., after configuration change)
   */
  async restartForBoat(boatId) {
    try {
      const boat = await Boat.findOne({ boatId });
      if (!boat || !boat.at4TcpPort) {
        this.stopForBoat(boatId);
        return;
      }

      await this.startForBoat(boatId, boat.at4TcpPort, boat.mmsi);
    } catch (err) {
      console.error(`Error restarting AT4 listener for boat ${boatId}:`, err.message);
    }
  }

  /**
   * Stop all AT4 listeners
   */
  stopAll() {
    console.log(`Stopping ${this.listeners.size} AT4 listener(s)...`);
    for (const [boatId, listener] of this.listeners.entries()) {
      listener.stop();
    }
    this.listeners.clear();
    console.log('All AT4 listeners stopped');
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

module.exports = AT4ListenerManager;
