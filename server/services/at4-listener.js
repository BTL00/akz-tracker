/* ===== AT4 GPS Tracker TCP Listener Service ===== */

const net = require('net');
const { parsePacket, generateResponse } = require('../utils/at4');
const Location = require('../models/Location');
const Boat = require('../models/Boat');

class AT4Listener {
  constructor(port = 21100, broadcastFunc = null) {
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
      console.log(`[${clientData.imei || 'unknown'}] Processing packet (${packet.length} bytes): ${packet.toString('hex')}`);
      
      const parsed = parsePacket(packet);
      
      if (!parsed) {
        console.warn(`[${clientData.imei || 'unknown'}] Failed to parse AT4 packet: ${packet.toString('hex')}`);
        return;
      }

      console.log(`[${clientData.imei || 'unknown'}] Parsed packet type: ${parsed.type}, protocol: 0x${parsed.protocolNumber ? parsed.protocolNumber.toString(16).toUpperCase() : 'unknown'}`);

      // Generate and send response
      const response = generateResponse(parsed);
      if (response) {
        socket.write(response);
        console.log(`[${clientData.imei || 'unknown'}] Sent response for ${parsed.type} packet`);
      }

      // Store IMEI from login packet
      if (parsed.type === 'login' && parsed.imei) {
        clientData.imei = parsed.imei;
        console.log(`[${clientData.imei}] AT4 login successful`);
        
        // Send location request to trigger device to send location updates
        this.sendLocationRequest(socket, clientData);
      }

      // Handle different packet types
      switch (parsed.type) {
        case 'login':
          console.log(`[${clientData.imei}] AT4 login from IMEI: ${parsed.imei}`);
          break;
        case 'location':
          await this.handleLocation(clientData, parsed);
          break;
        case 'heartbeat':
          await this.handleHeartbeat(clientData, parsed);
          break;
        case 'unknown':
          console.log(`[${clientData.imei}] Received AT4 packet with unknown protocol: 0x${parsed.protocolNumber.toString(16).toUpperCase()}`);
          break;
        default:
          console.log(`[${clientData.imei}] Received AT4 packet type: ${parsed.type}, protocol: 0x${parsed.protocolNumber ? parsed.protocolNumber.toString(16).toUpperCase() : 'unknown'}`);
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

  async handleLocation(clientData, parsed) {
    try {
      // Accept any location data that comes to the port, regardless of IMEI/MMSI matching
      const boatId = clientData.imei || 'unknown';
      
      console.log(`[${clientData.imei}] Creating location record at (${parsed.lat}, ${parsed.lon})`);
      
      // Create location document
      const location = await Location.create({
        boatId: boatId,
        name: `AT4-${clientData.imei}`,
        mmsi: clientData.imei,
        color: '#0066FF',
        lat: parsed.lat,
        lon: parsed.lon,
        course: Math.round(parsed.course || 0),
        speed: Math.round((parsed.speed || 0) * 10) / 10,
        status: 'Under way',
        source: 'at4',
        timestamp: parsed.timestamp || new Date(),
      });

      console.log(`[${clientData.imei}] ✓ Saved AT4 position at (${parsed.lat}, ${parsed.lon})`);

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
      console.error(`[${clientData.imei}] Error saving AT4 position:`, err.message);
    }
  }

  sendLocationRequest(socket, clientData) {
    // Send command to request location data
    // Format: 78 78 + length + 0x40 (command type) + content + serial + CRC + 0d 0a
    // This is a location request/command packet
    try {
      const buffer = Buffer.alloc(13);
      
      // Start bits
      buffer[0] = 0x78;
      buffer[1] = 0x78;
      
      // Length (content after length byte until CRC)
      buffer[2] = 0x08;  // 8 bytes: command(1) + reserved(2) + serial(2) + CRC(2)
      
      // Command type: 0x40 = location request
      buffer[3] = 0x40;
      
      // Reserved/placeholder (2 bytes)
      buffer[4] = 0x00;
      buffer[5] = 0x00;
      
      // Serial number
      buffer.writeUInt16BE(Math.floor(Math.random() * 65535), 6);
      
      // CRC
      const crc = require('../utils/at4').calculateCRC16(buffer, 2, 8);
      buffer.writeUInt16BE(crc, 8);
      
      // Stop bits
      buffer[11] = 0x0D;
      buffer[12] = 0x0A;
      
      socket.write(buffer);
      console.log(`[${clientData.imei}] Sent location request command`);
    } catch (err) {
      console.error(`[${clientData.imei}] Error sending location request:`, err.message);
    }
  }
}

module.exports = AT4Listener;
