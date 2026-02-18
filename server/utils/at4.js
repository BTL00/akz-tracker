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
 * @returns {boolean} - True if CRC is valid (or lenient mode skips check)
 */
function verifyCRC(buffer) {
  if (buffer.length < 7) return false;
  
  try {
    // CRC covers from length byte to serial number (inclusive)
    const crcStart = 2; // After start bits
    const crcEnd = buffer.length - 4; // Before CRC and stop bits
    
    const calculatedCRC = calculateCRC16(buffer, crcStart, crcEnd);
    const packetCRC = buffer.readUInt16BE(buffer.length - 4);
    
    if (calculatedCRC === packetCRC) {
      return true;
    }
  } catch (err) {
    // If CRC check fails, log and continue anyway (lenient mode)
  }
  
  // Lenient mode: accept packets even if CRC doesn't match
  // This allows accepting non-standard or corrupted packets
  console.warn('CRC verification failed, accepting packet anyway');
  return true;
}

/**
 * Parse login packet (0x01)
 * Format: Start(2) + Length(1) + Protocol(1) + IMEI(8) + TypeID(2) + TimeZoneLang(2) + Serial(2) + CRC(2) + Stop(2)
 * @param {Buffer} buffer - Login packet buffer
 * @returns {Object|null} - { type: 'login', imei: string, serial: number } or null
 */
function parseLoginPacket(buffer) {
  if (buffer.length < 22) return null;  // Minimum: 2+1+1+8+2+2+2+2+2 = 22 bytes
  
  // Verify start bits
  if (buffer[0] !== 0x78 || buffer[1] !== 0x78) return null;
  
  // Verify protocol number
  const protocolNumber = buffer[3];
  if (protocolNumber !== AT4_PROTOCOL.LOGIN) return null;
  
  // Verify CRC
  if (!verifyCRC(buffer)) return null;
  
  // Extract IMEI (8 bytes BCD) at offset 4
  const imeiBytes = buffer.slice(4, 12);
  let imei = '';
  for (let i = 0; i < imeiBytes.length; i++) {
    const byte = imeiBytes[i];
    imei += (byte >> 4).toString() + (byte & 0x0F).toString();
  }
  
  // Extract type identification code (2 bytes) at offset 12
  const typeId = buffer.readUInt16BE(12);
  
  // Extract timezone/language (2 bytes) at offset 14
  const tzLang = buffer.readUInt16BE(14);
  
  // Extract serial number (2 bytes) at offset 16
  const serial = buffer.readUInt16BE(16);
  
  console.log(`  -> Login parsed: IMEI=${imei}, TypeID=0x${typeId.toString(16)}, Serial=0x${serial.toString(16).padStart(4, '0')}`);
  
  return {
    type: 'login',
    imei: imei,
    typeId: typeId,
    tzLang: tzLang,
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
 * Generate TimeCheck response packet
 * Used to sync server time with device after login
 * @param {number} serial - Serial number from request
 * @returns {Buffer} - Response buffer
 */
function generateTimeCheckResponse(serial) {
  const now = new Date();
  const buffer = Buffer.alloc(16);
  
  // Start bits
  buffer[0] = 0x78;
  buffer[1] = 0x78;
  
  // Length (9 bytes: protocol + year+month+day+hour+min+sec + serial + CRC)
  buffer[2] = 0x09;
  
  // Protocol (0x8A for TimeCheck)
  buffer[3] = 0x8A;
  
  // Date/Time (6 bytes): YY MM DD HH MM SS
  buffer[4] = now.getUTCFullYear() - 2000;
  buffer[5] = now.getUTCMonth() + 1;
  buffer[6] = now.getUTCDate();
  buffer[7] = now.getUTCHours();
  buffer[8] = now.getUTCMinutes();
  buffer[9] = now.getUTCSeconds();
  
  // Serial number
  buffer.writeUInt16BE(serial, 10);
  
  // Calculate and write CRC
  const crc = calculateCRC16(buffer, 2, 12);
  buffer.writeUInt16BE(crc, 12);
  
  // Stop bits
  buffer[14] = 0x0D;
  buffer[15] = 0x0A;
  
  return buffer;
}

/**
 * Generate OnlineCommand response packet
 * Used to acknowledge device is online and ready for data
 * @param {number} serial - Serial number from request
 * @returns {Buffer} - Response buffer
 */
function generateOnlineCommandResponse(serial) {
  const buffer = Buffer.alloc(10);
  
  // Start bits
  buffer[0] = 0x78;
  buffer[1] = 0x78;
  
  // Length
  buffer[2] = 0x05;
  
  // Protocol (0x80 for online command)
  buffer[3] = 0x80;
  
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
  if (!buffer || buffer.length < 10) {
    console.warn('Packet too short:', buffer ? buffer.length : 0, 'bytes');
    return null;
  }
  
  try {
    // Check start bits
    if (buffer[0] !== 0x78 || buffer[1] !== 0x78) {
      console.warn('Invalid start bits:', buffer[0].toString(16), buffer[1].toString(16));
      return null;
    }
    
    // Get protocol number (at index 3)
    const protocolNumber = buffer[3];
    console.log(`Attempting to parse protocol 0x${protocolNumber.toString(16).toUpperCase()} from packet: ${buffer.toString('hex')}`);
    
    switch (protocolNumber) {
      case AT4_PROTOCOL.LOGIN:
        console.log('  -> Parsing as LOGIN packet (0x01)');
        try {
          return parseLoginPacket(buffer);
        } catch (err) {
          console.warn('  -> LOGIN parse error:', err.message);
          return null;
        }
      case AT4_PROTOCOL.LOCATION:
        console.log('  -> Parsing as LOCATION packet (0x22)');
        try {
          return parseLocationPacket(buffer);
        } catch (err) {
          console.warn('  -> LOCATION parse error:', err.message);
          return null;
        }
      case AT4_PROTOCOL.HEARTBEAT:
        console.log('  -> Parsing as HEARTBEAT packet (0x23)');
        try {
          return parseHeartbeatPacket(buffer);
        } catch (err) {
          console.warn('  -> HEARTBEAT parse error:', err.message);
          return null;
        }
      default:
        console.log(`  -> Unknown protocol 0x${protocolNumber.toString(16).toUpperCase()}`);
        return { type: 'unknown', protocolNumber };
    }
  } catch (err) {
    console.error('Unexpected error in parsePacket:', err.message);
    return null;
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
  generateTimeCheckResponse,
  generateOnlineCommandResponse,
  calculateCRC16,
  verifyCRC,
};
