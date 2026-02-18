/* ===== AT4 GPS Tracker TCP Listener Service ===== */

const net = require('net');
const { parsePacket, generateResponse } = require('../utils/at4');
const Location = require('../models/Location');
const Boat = require('../models/Boat');

class AT4Listener {
  constructor(port = 5023, broadcastFunc = null) {
    this.port = port;
    this.server = null;
    this.clients = new Map(); // Map socket to { imei, boatId, buffer }
    this.broadcastFunc = broadcastFunc; // WebSocket broadcast function
  }

  start() {
    this.server = net.createServer((socket) => {
      console.log('AT4 client connected:', socket.remoteAddress);
      
      // Initialize client state
      this.clients.set(socket, {
        imei: null,
        boatId: null,
        buffer: Buffer.alloc(0),
      });

      socket.on('data', (data) => {
        this.handleData(socket, data);
      });

      socket.on('end', () => {
        const clientData = this.clients.get(socket);
        console.log('AT4 client disconnected:', clientData?.imei || 'unknown');
        this.clients.delete(socket);
      });

      socket.on('error', (err) => {
        console.error('AT4 client error:', err.message);
        this.clients.delete(socket);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`AT4 TCP listener active on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      console.error('AT4 server error:', err);
    });
  }

  stop() {
    if (this.server) {
      this.clients.forEach((_, socket) => socket.destroy());
      this.clients.clear();
      this.server.close(() => {
        console.log('AT4 TCP listener stopped');
      });
      this.server = null;
    }
  }

  handleData(socket, data) {
    const clientData = this.clients.get(socket);
    if (!clientData) return;

    // Append data to buffer
    clientData.buffer = Buffer.concat([clientData.buffer, data]);

    // Try to extract complete packets from buffer
    this.processBuffer(socket, clientData);
  }

  processBuffer(socket, clientData) {
    while (clientData.buffer.length >= 10) {
      // Look for start bits: 0x78 0x78
      const startIndex = this.findStartBits(clientData.buffer);
      
      if (startIndex === -1) {
        // No start bits found, clear buffer
        clientData.buffer = Buffer.alloc(0);
        return;
      }

      // Remove any data before start bits
      if (startIndex > 0) {
        clientData.buffer = clientData.buffer.slice(startIndex);
      }

      // Check if we have enough data to read the length
      if (clientData.buffer.length < 3) {
        return; // Wait for more data
      }

      // Read packet length (byte 2)
      const length = clientData.buffer[2];
      const totalLength = length + 5; // +2 start, +1 length, +2 stop

      // Check if we have the complete packet
      if (clientData.buffer.length < totalLength) {
        return; // Wait for more data
      }

      // Extract packet
      const packet = clientData.buffer.slice(0, totalLength);
      clientData.buffer = clientData.buffer.slice(totalLength);

      // Process packet
      this.processPacket(socket, clientData, packet);
    }
  }

  findStartBits(buffer) {
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] === 0x78 && buffer[i + 1] === 0x78) {
        return i;
      }
    }
    return -1;
  }

  async processPacket(socket, clientData, packet) {
    try {
      const parsed = parsePacket(packet);
      
      if (!parsed) {
        console.warn('Failed to parse AT4 packet');
        return;
      }

      // Generate and send response
      const response = generateResponse(parsed);
      if (response) {
        socket.write(response);
      }

      // Handle different packet types
      switch (parsed.type) {
        case 'login':
          await this.handleLogin(socket, clientData, parsed);
          break;
        case 'location':
          await this.handleLocation(clientData, parsed);
          break;
        default:
          console.log(`Received AT4 packet type: ${parsed.type}`);
      }
    } catch (err) {
      console.error('Error processing AT4 packet:', err.message);
    }
  }

  async handleLogin(socket, clientData, parsed) {
    const imei = parsed.imei;
    console.log(`AT4 login from IMEI: ${imei}`);
    
    // Look up boat by apiKey (we'll use IMEI as part of apiKey matching)
    // For now, we'll store IMEI and authenticate on first location packet
    clientData.imei = imei;
    
    // Try to find boat with matching IMEI or apiKey
    // Note: In a real setup, you'd configure the device to send a specific identifier
    // For now, we'll authenticate based on the first location packet
  }

  async handleLocation(clientData, parsed) {
    try {
      if (!clientData.imei) {
        console.warn('Received location before login');
        return;
      }

      // Look up boat by IMEI (stored in mmsi field) or apiKey
      // For AT4 devices, we'll use the boatId/apiKey system
      // The device IMEI should be registered in the boat's mmsi or apiKey field
      
      let boat = null;
      
      // Try to find boat by MMSI (if IMEI is stored there)
      boat = await Boat.findOne({ mmsi: clientData.imei });
      
      // If not found by MMSI, try to find by boatId if we already have it
      if (!boat && clientData.boatId) {
        boat = await Boat.findOne({ boatId: clientData.boatId });
      }
      
      if (!boat) {
        console.warn(`Received location for unknown IMEI: ${clientData.imei} - rejecting`);
        return;
      }

      // Cache boatId for subsequent packets
      clientData.boatId = boat.boatId;

      // Create location document
      const location = await Location.create({
        boatId: boat.boatId,
        name: boat.name,
        mmsi: boat.mmsi,
        color: boat.color,
        lat: parsed.lat,
        lon: parsed.lon,
        course: Math.round(parsed.course || 0),
        speed: Math.round((parsed.speed || 0) * 10) / 10,
        status: 'Under way',
        source: 'tracker',
        timestamp: parsed.timestamp || new Date(),
      });

      console.log(`Saved AT4 position for ${boat.name} (IMEI: ${clientData.imei})`);

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
      console.error('Error saving AT4 position:', err.message);
    }
  }
}

module.exports = AT4Listener;
