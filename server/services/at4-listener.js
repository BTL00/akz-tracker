/* ===== AT4 GPS Tracker TCP Listener Service ===== */

const net = require('net');
const { parsePacket, generateResponse } = require('../utils/at4');
const Location = require('../models/Location');
const Boat = require('../models/Boat');

class AT4Listener {
  constructor(port = 21100, assignedBoatId = null, broadcastFunc = null) {
    this.port = port;
    this.assignedBoatId = assignedBoatId; // boatId assigned to this port by admin
    this.server = null;
    this.clients = new Map(); // Map socket to { imei, boatId, buffer }
    this.broadcastFunc = broadcastFunc; // WebSocket broadcast function
  }

  start() {
    this.server = net.createServer((socket) => {
      console.log(`[port ${this.port}] AT4 client connected: ${socket.remoteAddress}`);
      
      // Initialize client state with pre-assigned boatId from port mapping
      this.clients.set(socket, {
        imei: null,
        boatId: this.assignedBoatId,
        buffer: Buffer.alloc(0),
      });

      socket.on('data', (data) => {
        this.handleData(socket, data);
      });

      socket.on('end', () => {
        const clientData = this.clients.get(socket);
        console.log(`[port ${this.port}] AT4 client disconnected: ${clientData?.imei || 'unknown'}`);
        this.clients.delete(socket);
      });

      socket.on('error', (err) => {
        console.error(`[port ${this.port}] AT4 client error:`, err.message);
        this.clients.delete(socket);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[port ${this.port}] AT4 TCP listener active (boat: ${this.assignedBoatId || 'unassigned'})`);
    });

    this.server.on('error', (err) => {
      console.error(`[port ${this.port}] AT4 server error:`, err);
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

    console.log(`[${clientData.imei || 'unknown'}] Raw data received (${data.length} bytes): ${data.toString('hex')}`);
    
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
        console.warn(`[${clientData.imei || 'unknown'}] ❌ Failed to parse AT4 packet: ${packet.toString('hex')}`);
        return;
      }

      console.log(`[${clientData.imei || 'unknown'}] ✓ Parsed type=${parsed.type} protocol=0x${parsed.protocolNumber ? parsed.protocolNumber.toString(16).toUpperCase() : 'unknown'}`);

      // Generate and send response
      const response = generateResponse(parsed);
      if (response) {
        socket.write(response);
        console.log(`[${clientData.imei || 'unknown'}] ✓✓ SENT RESPONSE (${response.length} bytes): ${response.toString('hex')}`);
      } else {
        console.warn(`[${clientData.imei || 'unknown'}] ⚠ No response for ${parsed.type}`);
      }

      // Store IMEI from login packet and update boat if assigned
      if (parsed.type === 'login' && parsed.imei) {
        clientData.imei = parsed.imei;
        console.log(`[${clientData.imei}] ✓✓✓ LOGIN SUCCESSFUL - Serial: 0x${parsed.serial.toString(16).padStart(4, '0')}`);
        
        // Update boat's IMEI if this port is assigned to a boat
        if (clientData.boatId) {
          await this.updateBoatImei(clientData.boatId, parsed.imei);
        }
      }

      // Handle different packet types
      switch (parsed.type) {
        case 'location':
          await this.handleLocation(clientData, parsed);
          break;
        case 'heartbeat':
          await this.handleHeartbeat(clientData, parsed);
          break;
        case 'unknown':
          console.log(`[${clientData.imei}] Unknown protocol: 0x${parsed.protocolNumber.toString(16).toUpperCase()}`);
          break;
      }
    } catch (err) {
      console.error('Error processing AT4 packet:', err.message);
      if (packet) {
        console.error('Packet hex:', packet.toString('hex'));
      }
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

  async handleHeartbeat(clientData, parsed) {
    const signalLabels = ['no signal', 'extremely weak', 'very weak', 'good', 'strong'];
    const signalLabel = signalLabels[parsed.signalStrength] || 'unknown';
    
    console.log(`AT4 heartbeat from IMEI ${clientData.imei}: voltage=${parsed.voltage}V, signal=${signalLabel}`);
  }

  async updateBoatImei(boatId, imei) {
    try {
      const boat = await Boat.findOne({ boatId });
      if (!boat) {
        console.warn(`[${imei}] Boat not found: ${boatId}`);
        return;
      }

      const oldImei = boat.imei || '(none)';
      boat.imei = imei;
      await boat.save();
      console.log(`[${imei}] ✓ Updated boat "${boat.name}" IMEI: ${oldImei} → ${imei}`);
    } catch (err) {
      console.error(`Error updating boat IMEI:`, err.message);
    }
  }

  async handleLocation(clientData, parsed) {
    try {
      // If no boat assigned to this port, log warning but don't save
      if (!clientData.boatId) {
        console.warn(`[${clientData.imei}] Location packet received but no boat assigned to this port`);
        return;
      }

      // Get boat info for location metadata
      const boat = await Boat.findOne({ boatId: clientData.boatId });
      if (!boat) {
        console.warn(`[${clientData.imei}] Boat not found: ${clientData.boatId}`);
        return;
      }

      console.log(`[${clientData.imei}] ✓ Got location: (${parsed.lat}, ${parsed.lon}) speed=${parsed.speed}kt course=${parsed.course}°`);
      
      // Save location under the assigned boat
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
        source: 'at4',
        timestamp: parsed.timestamp || new Date(),
      });

      console.log(`[${clientData.imei}] ✓ Saved location for boat "${boat.name}"`);

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
      console.error(`[${clientData.imei}] Error saving AT4 location:`, err.message);
    }
  }
}

module.exports = AT4Listener;
