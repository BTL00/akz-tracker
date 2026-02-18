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
 * CRC-ITU lookup table
 */
const CRC_TABLE = [
  0x0000, 0x1189, 0x2312, 0x329B, 0x4624, 0x57AD, 0x6536, 0x74BF,
  0x8C48, 0x9DC1, 0xAF5A, 0xBED3, 0xCA6C, 0xDBE5, 0xE97E, 0xF8F7,
  0x1081, 0x0108, 0x3393, 0x221A, 0x56A5, 0x472C, 0x75B7, 0x643E,
  0x9CC9, 0x8D40, 0xBFDB, 0xAE52, 0xDAED, 0xCB64, 0xF9FF, 0xE876,
  0x2102, 0x308B, 0x0210, 0x1399, 0x6726, 0x76AF, 0x4434, 0x55BD,
  0xAD4A, 0xBCC3, 0x8E58, 0x9FD1, 0xEB6E, 0xFAE7, 0xC87C, 0xD9F5,
  0x3183, 0x200A, 0x1291, 0x0318, 0x77A7, 0x662E, 0x54B5, 0x453C,
  0xBDCB, 0xAC42, 0x9ED9, 0x8F50, 0xFBEF, 0xEA66, 0xD8FD, 0xC974,
  0x4204, 0x538D, 0x6116, 0x709F, 0x0420, 0x15A9, 0x2732, 0x36BB,
  0xCE4C, 0xDFC5, 0xED5E, 0xFCD7, 0x8868, 0x99E1, 0xAB7A, 0xBAF3,
  0x5285, 0x430C, 0x7197, 0x601E, 0x14A1, 0x0528, 0x37B3, 0x263A,
  0xDECD, 0xCF44, 0xFDDF, 0xEC56, 0x98E9, 0x8960, 0xBBFB, 0xAA72,
  0x6306, 0x728F, 0x4014, 0x519D, 0x2522, 0x34AB, 0x0630, 0x17B9,
  0xEF4E, 0xFEC7, 0xCC5C, 0xDDD5, 0xA96A, 0xB8E3, 0x8A78, 0x9BF1,
  0x7387, 0x620E, 0x5095, 0x411C, 0x35A3, 0x242A, 0x16B1, 0x0738,
  0xFFCF, 0xEE46, 0xDCDD, 0xCD54, 0xB9EB, 0xA862, 0x9AF9, 0x8B70,
  0x8408, 0x9581, 0xA71A, 0xB693, 0xC22C, 0xD3A5, 0xE13E, 0xF0B7,
  0x0840, 0x19C9, 0x2B52, 0x3ADB, 0x4E64, 0x5FED, 0x6D76, 0x7CFF,
  0x9489, 0x8500, 0xB79B, 0xA612, 0xD2AD, 0xC324, 0xF1BF, 0xE036,
  0x18C1, 0x0948, 0x3BD3, 0x2A5A, 0x5EE5, 0x4F6C, 0x7DF7, 0x6C7E,
  0xA50A, 0xB483, 0x8618, 0x9791, 0xE32E, 0xF2A7, 0xC03C, 0xD1B5,
  0x2942, 0x38CB, 0x0A50, 0x1BD9, 0x6F66, 0x7EEF, 0x4C74, 0x5DFD,
  0xB58B, 0xA402, 0x9699, 0x8710, 0xF3AF, 0xE226, 0xD0BD, 0xC134,
  0x39C3, 0x284A, 0x1AD1, 0x0B58, 0x7FE7, 0x6E6E, 0x5CF5, 0x4D7C,
  0xC60C, 0xD785, 0xE51E, 0xF497, 0x8028, 0x91A1, 0xA33A, 0xB2B3,
  0x4A44, 0x5BCD, 0x6956, 0x78DF, 0x0C60, 0x1DE9, 0x2F72, 0x3EFB,
  0xD68D, 0xC704, 0xF59F, 0xE416, 0x90A9, 0x8120, 0xB3BB, 0xA232,
  0x5AC5, 0x4B4C, 0x79D7, 0x685E, 0x1CE1, 0x0D68, 0x3FF3, 0x2E7A,
  0xE70E, 0xF687, 0xC41C, 0xD595, 0xA12A, 0xB0A3, 0x8238, 0x93B1,
  0x6B46, 0x7ACF, 0x4854, 0x59DD, 0x2D62, 0x3CEB, 0x0E70, 0x1FF9,
  0xF78F, 0xE606, 0xD49D, 0xC514, 0xB1AB, 0xA022, 0x92B9, 0x8330,
  0x7BC7, 0x6A4E, 0x58D5, 0x495C, 0x3DE3, 0x2C6A, 0x1EF1, 0x0F78,
];

/**
 * Calculate CRC-ITU checksum using lookup table
 * @param {Buffer} buffer - Buffer to calculate CRC for
 * @param {number} start - Start index
 * @param {number} end - End index (exclusive)
 * @returns {number} - CRC16 value
 */
function calculateCRC16(buffer, start, end) {
  let crc = 0xFFFF;
  for (let i = start; i < end; i++) {
    const byte = buffer[i];
    crc = ((crc >> 8) ^ CRC_TABLE[(crc ^ byte) & 0xFF]) & 0xFFFF;
  }
  return (~crc) & 0xFFFF;  // Negate and mask to 16-bit
}

/**
 * Verify packet CRC
 * @param {Buffer} buffer - Packet buffer
 * @returns {boolean} - True if CRC is valid
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
    
    console.warn(`CRC mismatch: calculated=0x${calculatedCRC.toString(16).padStart(4, '0')}, packet=0x${packetCRC.toString(16).padStart(4, '0')}`);
    return false;
  } catch (err) {
    console.warn('CRC verification error:', err.message);
    return false;
  }
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
  if (buffer.length < 16) return null;
  
  // Verify start bits
  if (buffer[0] !== 0x78 || buffer[1] !== 0x78) return null;
  
  // Verify protocol number
  const protocolNumber = buffer[3];
  if (protocolNumber !== AT4_PROTOCOL.HEARTBEAT) return null;
  
  // Verify CRC
  if (!verifyCRC(buffer)) {
    console.warn(`  -> Heartbeat CRC failed for packet: ${buffer.toString('hex')}`);
    return null;
  }
  
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
  
  console.log(`  -> Heartbeat parsed: term=0x${terminalInfo.toString(16)}, volt=${voltage}V, signal=${signalStrength}, serial=0x${serial.toString(16).padStart(4, '0')}`);
  
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
  // If North bit is NOT set, it's South - negate latitude
  const finalLat = isNorth ? lat : -lat;
  const finalLon = isWest ? -lon : lon;
  
  console.log(`[Location] Raw=(${lat.toFixed(6)}, ${lon.toFixed(6)}), Status=0x${status.toString(16).padStart(3, '0')} (north=${isNorth}, west=${isWest}) -> Final=(${finalLat.toFixed(6)}, ${finalLon.toFixed(6)})`);
  
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
