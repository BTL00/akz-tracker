/* ===== AT4 GPS Tracker Protocol Parser ===== */
/* Supports Concox AT4 GPRS binary protocol */

/**
 * Parse AT4/Concox binary protocol packets
 * Protocol structure:
 * - Start Bit: 0x78 0x78 (or 0x79 0x79 for extended)
 * - Length: 1 byte (or 2 bytes for extended)
 * - Protocol Number: 1 byte (message type)
 * - Information Content: variable
 * - Serial Number: 2 bytes
 * - CRC: 2 bytes (ITU CRC16)
 * - Stop Bit: 0x0D 0x0A
 */

const AT4_PROTOCOL = {
  LOGIN: 0x01,
  LOCATION: 0x22,
  ALARM: 0x27,
  HEARTBEAT: 0x23,
};

/**
 * Calculate ITU CRC16 checksum
 * @param {Buffer} buffer - Buffer to calculate CRC for
 * @param {number} start - Start index
 * @param {number} end - End index (exclusive)
 * @returns {number} - CRC16 value
 */
function calculateCRC16(buffer, start, end) {
  let crc = 0xFFFF;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i] << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  return crc & 0xFFFF;
}

/**
 * Verify packet CRC
 * @param {Buffer} buffer - Packet buffer
 * @returns {boolean} - True if CRC is valid
 */
function verifyCRC(buffer) {
  if (buffer.length < 7) return false;
  
  // CRC covers from length byte to serial number (inclusive)
  const crcStart = 2; // After start bits
  const crcEnd = buffer.length - 4; // Before CRC and stop bits
  
  const calculatedCRC = calculateCRC16(buffer, crcStart, crcEnd);
  const packetCRC = buffer.readUInt16BE(buffer.length - 4);
  
  return calculatedCRC === packetCRC;
}

/**
 * Parse login packet (0x01)
 * Format: Start(2) + Length(1) + Protocol(1) + IMEI(8) + Serial(2) + CRC(2) + Stop(2)
 * @param {Buffer} buffer - Login packet buffer
 * @returns {Object|null} - { type: 'login', imei: string, serial: number } or null
 */
function parseLoginPacket(buffer) {
  if (buffer.length < 18) return null;
  
  // Verify start bits
  if (buffer[0] !== 0x78 || buffer[1] !== 0x78) return null;
  
  // Verify protocol number
  const protocolNumber = buffer[3];
  if (protocolNumber !== AT4_PROTOCOL.LOGIN) return null;
  
  // Verify CRC
  if (!verifyCRC(buffer)) return null;
  
  // Extract IMEI (8 bytes BCD)
  const imeiBytes = buffer.slice(4, 12);
  let imei = '';
  for (let i = 0; i < imeiBytes.length; i++) {
    const byte = imeiBytes[i];
    imei += (byte >> 4).toString() + (byte & 0x0F).toString();
  }
  
  // Extract serial number
  const serial = buffer.readUInt16BE(12);
  
  return {
    type: 'login',
    imei: imei,
    serial: serial,
  };
}

/**
 * Generate login response packet
 * Format: Start(2) + Length(1) + Protocol(1) + Serial(2) + CRC(2) + Stop(2)
 * @param {number} serial - Serial number from login packet
 * @returns {Buffer} - Response buffer
 */
function generateLoginResponse(serial) {
  const buffer = Buffer.alloc(10);
  
  // Start bits
  buffer[0] = 0x78;
  buffer[1] = 0x78;
  
  // Length (5 bytes: protocol + serial + CRC)
  buffer[2] = 0x05;
  
  // Protocol (0x01 for login response)
  buffer[3] = 0x01;
  
  // Serial number
  buffer.writeUInt16BE(serial, 4);
  
  // Calculate and write CRC
  const crc = calculateCRC16(buffer, 2, 6);
  buffer.writeUInt16BE(crc, 6);
  
  // Stop bits
  buffer[8] = 0x0D;
  buffer[9] = 0x0A;
  
  return buffer;
}

/**
 * Parse heartbeat packet (0x23)
 * Format: Start(2) + Length(1) + Protocol(1) + TerminalInfo(1) + Voltage(2) + GSM(1) + Language(2) + Serial(2) + CRC(2) + Stop(2)
 * @param {Buffer} buffer - Heartbeat packet buffer
 * @returns {Object|null} - { type: 'heartbeat', voltage: number, signalStrength: number, serial: number } or null
 */
function parseHeartbeatPacket(buffer) {
  if (buffer.length < 18) return null;
  
  // Verify start bits
  if (buffer[0] !== 0x78 || buffer[1] !== 0x78) return null;
  
  // Verify protocol number
  const protocolNumber = buffer[3];
  if (protocolNumber !== AT4_PROTOCOL.HEARTBEAT) return null;
  
  // Verify CRC
  if (!verifyCRC(buffer)) return null;
  
  let offset = 4;
  
  // Terminal information (1 byte) - contains various status bits
  const terminalInfo = buffer[offset++];
  
  // Voltage level (2 bytes) - divide by 100 after converting to decimal
  const voltageRaw = buffer.readUInt16BE(offset);
  const voltage = voltageRaw / 100;
  offset += 2;
  
  // GSM signal strength (1 byte)
  // 0x00: no signal, 0x01: extremely weak, 0x02: very weak, 0x03: good, 0x04: strong
  const signalStrength = buffer[offset++];
  
  // Language/Extended port status (2 bytes)
  const languageStatus = buffer.readUInt16BE(offset);
  offset += 2;
  
  // Serial number (2 bytes)
  const serial = buffer.readUInt16BE(offset);
  
  return {
    type: 'heartbeat',
    protocolNumber: AT4_PROTOCOL.HEARTBEAT,
    terminalInfo: terminalInfo,
    voltage: voltage,
    signalStrength: signalStrength,
    languageStatus: languageStatus,
    serial: serial,
  };
}

/**
 * Generate heartbeat response packet
 * Format: Start(2) + Length(1) + Protocol(1) + Serial(2) + CRC(2) + Stop(2)
 * @param {number} serial - Serial number from heartbeat packet
 * @returns {Buffer} - Response buffer
 */
function generateHeartbeatResponse(serial) {
  const buffer = Buffer.alloc(10);
  
  // Start bits
  buffer[0] = 0x78;
  buffer[1] = 0x78;
  
  // Length (5 bytes: protocol + serial + CRC)
  buffer[2] = 0x05;
  
  // Protocol (0x23 for heartbeat response)
  buffer[3] = 0x23;
  
  // Serial number
  buffer.writeUInt16BE(serial, 4);
  
  // Calculate and write CRC
  const crc = calculateCRC16(buffer, 2, 6);
  buffer.writeUInt16BE(crc, 6);
  
  // Stop bits
  buffer[8] = 0x0D;
  buffer[9] = 0x0A;
  
  return buffer;
}

/**
 * Parse GPS location packet (0x22)
 * Format includes date/time, GPS satellites, lat/lon, speed, course, etc.
 * @param {Buffer} buffer - Location packet buffer
 * @returns {Object|null} - Location data or null
 */
function parseLocationPacket(buffer) {
  if (buffer.length < 36) return null;
  
  // Verify start bits
  if (buffer[0] !== 0x78 || buffer[1] !== 0x78) return null;
  
  // Verify protocol number
  const protocolNumber = buffer[3];
  if (protocolNumber !== AT4_PROTOCOL.LOCATION) return null;
  
  // Verify CRC
  if (!verifyCRC(buffer)) return null;
  
  let offset = 4;
  
  // Date and time (6 bytes): YY MM DD HH MM SS
  const year = 2000 + buffer[offset++];
  const month = buffer[offset++];
  const day = buffer[offset++];
  const hour = buffer[offset++];
  const minute = buffer[offset++];
  const second = buffer[offset++];
  
  // GPS info byte: number of satellites (bits 0-3)
  const gpsInfo = buffer[offset++];
  const satellites = gpsInfo & 0x0F;
  
  // Latitude (4 bytes) - degrees * 30000 / 0.000001
  const latRaw = buffer.readUInt32BE(offset);
  offset += 4;
  const lat = latRaw / 1800000.0;
  
  // Longitude (4 bytes) - degrees * 30000 / 0.000001
  const lonRaw = buffer.readUInt32BE(offset);
  offset += 4;
  const lon = lonRaw / 1800000.0;
  
  // Speed (1 byte) - km/h
  const speedKmh = buffer[offset++];
  const speedKnots = speedKmh * 0.539957; // Convert km/h to knots
  
  // Course/Status (2 bytes)
  // Bits 15-10: course/10 (0-35 range for 0-359 degrees)
  // Bits 9-0: status bits
  const courseStatus = buffer.readUInt16BE(offset);
  offset += 2;
  const course = ((courseStatus >> 10) & 0x3F) * 10; // Extract 6 bits and multiply by 10
  
  // Extract direction bits for lat/lon hemisphere
  // Bit 3: 0=East, 1=West
  // Bit 2: 1=North, 0=South
  const status = courseStatus & 0x3FF;
  const isWest = (status & 0x0008) !== 0;
  const isNorth = (status & 0x0004) !== 0;
  
  // Apply hemisphere corrections
  const finalLat = isNorth ? lat : -lat;
  const finalLon = isWest ? -lon : lon;
  
  // MCC (Mobile Country Code) - 2 bytes
  const mcc = buffer.readUInt16BE(offset);
  offset += 2;
  
  // MNC (Mobile Network Code) - 1 byte
  const mnc = buffer[offset++];
  
  // LAC (Location Area Code) - 2 bytes
  const lac = buffer.readUInt16BE(offset);
  offset += 2;
  
  // Cell ID - 3 bytes
  const cellId = (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
  offset += 3;
  
  // Serial number
  const serial = buffer.readUInt16BE(offset);
  
  // Create timestamp
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  
  return {
    type: 'location',
    lat: finalLat,
    lon: finalLon,
    speed: speedKnots,
    course: course,
    timestamp: timestamp,
    satellites: satellites,
    mcc: mcc,
    mnc: mnc,
    lac: lac,
    cellId: cellId,
    serial: serial,
  };
}

/**
 * Generate location response packet
 * @param {number} serial - Serial number from location packet
 * @returns {Buffer} - Response buffer
 */
function generateLocationResponse(serial) {
  const buffer = Buffer.alloc(10);
  
  // Start bits
  buffer[0] = 0x78;
  buffer[1] = 0x78;
  
  // Length
  buffer[2] = 0x05;
  
  // Protocol (0x22 for location response)
  buffer[3] = 0x22;
  
  // Serial number
  buffer.writeUInt16BE(serial, 4);
  
  // Calculate and write CRC
  const crc = calculateCRC16(buffer, 2, 6);
  buffer.writeUInt16BE(crc, 6);
  
  // Stop bits
  buffer[8] = 0x0D;
  buffer[9] = 0x0A;
  
  return buffer;
}

/**
 * Parse AT4 packet (auto-detect type)
 * @param {Buffer} buffer - Packet buffer
 * @returns {Object|null} - Parsed data or null
 */
function parsePacket(buffer) {
  if (!buffer || buffer.length < 10) return null;
  
  // Check start bits
  if (buffer[0] !== 0x78 || buffer[1] !== 0x78) return null;
  
  // Get protocol number
  const protocolNumber = buffer[3];
  
  switch (protocolNumber) {
    case AT4_PROTOCOL.LOGIN:
      return parseLoginPacket(buffer);
    case AT4_PROTOCOL.LOCATION:
      return parseLocationPacket(buffer);
    case AT4_PROTOCOL.HEARTBEAT:
      return parseHeartbeatPacket(buffer);
    default:
      console.log(`AT4 unknown protocol number: 0x${protocolNumber.toString(16).toUpperCase()}`);
      return { type: 'unknown', protocolNumber };
  }
}

/**
 * Generate response for a parsed packet
 * @param {Object} parsedData - Parsed packet data
 * @returns {Buffer|null} - Response buffer or null
 */
function generateResponse(parsedData) {
  if (!parsedData) return null;
  
  switch (parsedData.type) {
    case 'login':
      return generateLoginResponse(parsedData.serial);
    case 'location':
      return generateLocationResponse(parsedData.serial);
    case 'heartbeat':
      return generateHeartbeatResponse(parsedData.serial);
    default:
      return null;
  }
}

module.exports = {
  AT4_PROTOCOL,
  parsePacket,
  parseLoginPacket,
  parseLocationPacket,
  parseHeartbeatPacket,
  generateResponse,
  generateLoginResponse,
  generateLocationResponse,
  generateHeartbeatResponse,
  calculateCRC16,
  verifyCRC,
};
