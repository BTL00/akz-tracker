/* ===== SignalK Client Service ===== */

const SignalKClient = require('@signalk/client');
const Location = require('../models/Location');
const Boat = require('../models/Boat');

class SignalKService {
  constructor(url, token, broadcastFunc = null) {
    this.url = url;
    this.token = token;
    this.client = null;
    this.broadcastFunc = broadcastFunc; // WebSocket broadcast function
    this.connected = false;
    this.boatsByMMSI = {}; // Cache of boats indexed by MMSI
  }

  async start() {
    try {
      // Load boats from database and index by MMSI
      await this.loadBoats();

      // Initialize SignalK client
      this.client = new SignalKClient();

      // Configure connection
      const connection = {
        hostname: new URL(this.url).hostname,
        port: new URL(this.url).port || 3000,
        protocol: this.url.startsWith('https') ? 'wss' : 'ws',
        version: 'v1',
        token: this.token,
      };

      // Connect to SignalK server
      await this.client.connect(connection);
      this.connected = true;
      console.log(`SignalK client connected to ${this.url}`);

      // Subscribe to vessel position updates
      this.subscribeToVesselUpdates();

    } catch (err) {
      console.error('SignalK client error:', err.message);
      this.connected = false;
    }
  }

  async loadBoats() {
    try {
      const boats = await Boat.find({ mmsi: { $exists: true, $ne: '' } });
      this.boatsByMMSI = {};
      
      boats.forEach(boat => {
        if (boat.mmsi && boat.mmsi.trim()) {
          this.boatsByMMSI[boat.mmsi.trim()] = boat;
        }
      });

      console.log(`Loaded ${Object.keys(this.boatsByMMSI).length} boats with MMSI configured`);
    } catch (err) {
      console.error('Error loading boats for SignalK:', err.message);
    }
  }

  subscribeToVesselUpdates() {
    // Subscribe to all vessel position updates
    const subscription = {
      context: 'vessels.*',
      subscribe: [
        {
          path: 'navigation.position',
          period: 1000, // Update every 1 second
        },
        {
          path: 'navigation.courseOverGroundTrue',
          period: 1000,
        },
        {
          path: 'navigation.speedOverGround',
          period: 1000,
        },
      ],
    };

    this.client.subscribe(subscription, (delta) => {
      this.handleDelta(delta);
    });

    console.log('Subscribed to SignalK vessel updates');
  }

  async handleDelta(delta) {
    try {
      // Extract vessel context (e.g., "vessels.urn:mrn:imo:mmsi:123456789")
      const context = delta.context;
      if (!context || !context.startsWith('vessels.')) return;

      // Extract MMSI from context
      const mmsiMatch = context.match(/mmsi:(\d+)/);
      if (!mmsiMatch) return;

      const mmsi = mmsiMatch[1];

      // Check if we have this vessel registered
      const boat = this.boatsByMMSI[mmsi];
      if (!boat) {
        console.warn(`Received SignalK data for unknown MMSI: ${mmsi} - rejecting`);
        return;
      }

      // Extract position data from delta
      const position = this.extractPositionFromDelta(delta);
      if (!position) return;

      // Save location to database
      await this.savePosition({
        ...position,
        mmsi,
        boatId: boat.boatId,
        boatName: boat.name,
        boatColor: boat.color,
      });

    } catch (err) {
      console.error('Error handling SignalK delta:', err.message);
    }
  }

  extractPositionFromDelta(delta) {
    if (!delta.updates || delta.updates.length === 0) return null;

    const position = {
      lat: null,
      lon: null,
      course: null,
      speed: null,
      timestamp: new Date(),
    };

    // Process all updates
    delta.updates.forEach(update => {
      if (update.timestamp) {
        position.timestamp = new Date(update.timestamp);
      }

      if (!update.values) return;

      update.values.forEach(value => {
        switch (value.path) {
          case 'navigation.position':
            if (value.value && value.value.latitude !== undefined && value.value.longitude !== undefined) {
              position.lat = value.value.latitude;
              position.lon = value.value.longitude;
            }
            break;

          case 'navigation.courseOverGroundTrue':
            if (value.value !== undefined) {
              // Convert radians to degrees
              position.course = (value.value * 180 / Math.PI) % 360;
            }
            break;

          case 'navigation.speedOverGround':
            if (value.value !== undefined) {
              // Convert m/s to knots
              position.speed = value.value / 0.514444;
            }
            break;
        }
      });
    });

    // Only return if we have valid position
    if (position.lat !== null && position.lon !== null) {
      return position;
    }

    return null;
  }

  async savePosition(data) {
    try {
      const location = await Location.create({
        boatId: data.boatId,
        name: data.boatName,
        mmsi: data.mmsi,
        color: data.boatColor,
        lat: data.lat,
        lon: data.lon,
        course: Math.round(data.course || 0),
        speed: Math.round((data.speed || 0) * 10) / 10,
        status: 'Under way',
        source: 'signalk',
        timestamp: data.timestamp,
      });

      console.log(`Saved SignalK position for ${data.boatName} (MMSI: ${data.mmsi})`);

      // Broadcast via WebSocket if available
      if (this.broadcastFunc) {
        this.broadcastFunc({
          boatId: location.boatId,
          name: location.name,
          mmsi: location.mmsi,
          color: location.color,
          lat: location.lat,
          lon: location.lon,
          course: location.course,
          speed: location.speed,
          status: location.status,
          source: location.source,
          timestamp: location.timestamp,
        });
      }
    } catch (err) {
      console.error('Error saving SignalK position:', err.message);
    }
  }

  stop() {
    if (this.client) {
      this.client.disconnect();
      this.connected = false;
      console.log('SignalK client disconnected');
    }
  }

  isConnected() {
    return this.connected;
  }

  async reloadBoats() {
    await this.loadBoats();
  }
}

module.exports = SignalKService;
