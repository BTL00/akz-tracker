/* ===== NMEA TCP Listener Service ===== */

const net = require('net');
const { parseSentence, extractPosition } = require('../utils/nmea');
const Location = require('../models/Location');
const Boat = require('../models/Boat');

class NMEAListener {
  constructor(port = 10110, broadcastFunc = null) {
    this.port = port;
    this.server = null;
    this.clients = new Set();
    this.broadcastFunc = broadcastFunc; // WebSocket broadcast function
    
    // State accumulator per boat MMSI
    this.stateByMMSI = {};
  }

  start() {
    this.server = net.createServer((socket) => {
      console.log('NMEA client connected:', socket.remoteAddress);
      this.clients.add(socket);

      // Buffer for incomplete sentences
      let buffer = '';

      socket.on('data', (data) => {
        buffer += data.toString('utf-8');
        
        // Process complete lines
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        lines.forEach(line => {
          if (line.trim()) {
            this.processSentence(line.trim());
          }
        });
      });

      socket.on('end', () => {
        console.log('NMEA client disconnected');
        this.clients.delete(socket);
      });

      socket.on('error', (err) => {
        console.error('NMEA client error:', err.message);
        this.clients.delete(socket);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`NMEA TCP listener active on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      console.error('NMEA server error:', err);
    });
  }

  stop() {
    if (this.server) {
      this.clients.forEach(client => client.destroy());
      this.clients.clear();
      this.server.close(() => {
        console.log('NMEA TCP listener stopped');
      });
      this.server = null;
    }
  }

  async processSentence(sentence) {
    try {
      const packet = parseSentence(sentence);
      if (!packet) return;

      // Extract potential MMSI from AIS sentences
      let mmsi = null;
      if (packet.mmsi !== undefined) {
        mmsi = String(packet.mmsi);
      }

      // Get or create state for this MMSI
      if (mmsi && !this.stateByMMSI[mmsi]) {
        this.stateByMMSI[mmsi] = { mmsi };
      }

      const state = mmsi ? this.stateByMMSI[mmsi] : {};
      
      // Extract position from packet
      const position = extractPosition(packet, state);
      
      if (position && position.mmsi) {
        // We have a complete position with MMSI - try to save it
        await this.savePosition(position);
      }
    } catch (err) {
      console.error('Error processing NMEA sentence:', err.message);
    }
  }

  async savePosition(position) {
    try {
      // Look up boat by MMSI
      const boat = await Boat.findOne({ mmsi: position.mmsi });
      
      if (!boat) {
        console.warn(`Received position for unknown MMSI: ${position.mmsi} - rejecting`);
        return;
      }

      // Create location document
      const location = await Location.create({
        boatId: boat.boatId,
        name: boat.name,
        mmsi: boat.mmsi,
        color: boat.color,
        lat: position.lat,
        lon: position.lon,
        course: Math.round(position.course || 0),
        speed: Math.round((position.speed || 0) * 10) / 10,
        status: 'Under way',
        source: 'nmea',
        timestamp: position.timestamp || new Date(),
      });

      console.log(`Saved NMEA position for ${boat.name} (MMSI: ${boat.mmsi})`);

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
      console.error('Error saving NMEA position:', err.message);
    }
  }
}

module.exports = NMEAListener;
