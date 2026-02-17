/* ===== NMEA Utilities – Parse NMEA 0183 sentences ===== */

const NMEA = require('nmea-simple');

/**
 * Parse NMEA file content and extract position data.
 * @param {String} nmeaContent - Raw NMEA file content (lines of NMEA sentences)
 * @returns {Object} - { positions: [{ lat, lon, timestamp, speed, course, mmsi }], summary }
 */
function parseNMEA(nmeaContent) {
  const lines = nmeaContent.split(/\r?\n/).filter(l => l.trim().length > 0);
  const positions = [];
  const errors = [];
  
  // Current state accumulator (some sentences provide partial data)
  let currentState = {
    lat: null,
    lon: null,
    timestamp: null,
    speed: null,
    course: null,
    mmsi: null,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip non-NMEA lines (comments, empty lines)
    if (!line.startsWith('$') && !line.startsWith('!')) continue;
    
    try {
      const packet = NMEA.parseNmeaSentence(line);
      
      if (!packet) continue;
      
      // Handle different sentence types
      switch (packet.sentenceId) {
        case 'RMC': // Recommended Minimum Navigation Information
          if (packet.latitude !== undefined && packet.longitude !== undefined) {
            currentState.lat = packet.latitude;
            currentState.lon = packet.longitude;
          }
          if (packet.speedKnots !== undefined) {
            currentState.speed = packet.speedKnots;
          }
          if (packet.trackTrue !== undefined) {
            currentState.course = packet.trackTrue;
          }
          if (packet.datetime) {
            currentState.timestamp = packet.datetime;
          }
          break;
          
        case 'GGA': // Global Positioning System Fix Data
          if (packet.latitude !== undefined && packet.longitude !== undefined) {
            currentState.lat = packet.latitude;
            currentState.lon = packet.longitude;
          }
          break;
          
        case 'GLL': // Geographic Position - Latitude/Longitude
          if (packet.latitude !== undefined && packet.longitude !== undefined) {
            currentState.lat = packet.latitude;
            currentState.lon = packet.longitude;
          }
          if (packet.timestamp) {
            currentState.timestamp = packet.timestamp;
          }
          break;
          
        case 'VTG': // Track Made Good and Ground Speed
          if (packet.speedKnots !== undefined) {
            currentState.speed = packet.speedKnots;
          }
          if (packet.trackTrue !== undefined) {
            currentState.course = packet.trackTrue;
          }
          break;
          
        case 'HDT': // Heading - True
        case 'HDG': // Heading - Deviation & Variation
          if (packet.heading !== undefined) {
            currentState.course = packet.heading;
          }
          break;
      }
      
      // If we have valid position data, save a position point
      if (currentState.lat !== null && currentState.lon !== null) {
        // Check if this is a new position (different from last saved)
        const lastPos = positions[positions.length - 1];
        const isDifferent = !lastPos || 
          lastPos.lat !== currentState.lat || 
          lastPos.lon !== currentState.lon ||
          (currentState.timestamp && lastPos.timestamp !== currentState.timestamp);
        
        if (isDifferent) {
          positions.push({
            lat: currentState.lat,
            lon: currentState.lon,
            timestamp: currentState.timestamp || new Date(),
            speed: currentState.speed ?? 0,
            course: currentState.course ?? 0,
            mmsi: currentState.mmsi,
          });
        }
      }
      
    } catch (err) {
      errors.push({ line: i + 1, message: err.message, sentence: line });
    }
  }
  
  return {
    positions,
    summary: {
      totalLines: lines.length,
      positionsFound: positions.length,
      errors: errors.length,
      errorDetails: errors.slice(0, 10), // First 10 errors
      timeRange: positions.length > 0 ? {
        start: positions[0].timestamp,
        end: positions[positions.length - 1].timestamp,
      } : null,
    },
  };
}

/**
 * Parse a single NMEA sentence and return parsed data.
 * Used for real-time TCP stream processing.
 * @param {String} sentence - Single NMEA sentence (e.g., "$GPRMC,...")
 * @returns {Object|null} - Parsed packet or null if invalid
 */
function parseSentence(sentence) {
  try {
    const trimmed = sentence.trim();
    if (!trimmed.startsWith('$') && !trimmed.startsWith('!')) return null;
    
    return NMEA.parseNmeaSentence(trimmed);
  } catch (err) {
    return null;
  }
}

/**
 * Extract position data from parsed NMEA packets.
 * Accumulates data from multiple sentences to build complete position.
 * @param {Object} packet - Parsed NMEA packet from nmea-simple
 * @param {Object} state - Accumulated state object (passed by reference)
 * @returns {Object|null} - Position object if complete, null otherwise
 */
function extractPosition(packet, state = {}) {
  if (!packet) return null;
  
  // Update state from packet
  switch (packet.sentenceId) {
    case 'RMC':
      if (packet.latitude !== undefined) state.lat = packet.latitude;
      if (packet.longitude !== undefined) state.lon = packet.longitude;
      if (packet.speedKnots !== undefined) state.speed = packet.speedKnots;
      if (packet.trackTrue !== undefined) state.course = packet.trackTrue;
      if (packet.datetime) state.timestamp = packet.datetime;
      break;
      
    case 'GGA':
    case 'GLL':
      if (packet.latitude !== undefined) state.lat = packet.latitude;
      if (packet.longitude !== undefined) state.lon = packet.longitude;
      break;
      
    case 'VTG':
      if (packet.speedKnots !== undefined) state.speed = packet.speedKnots;
      if (packet.trackTrue !== undefined) state.course = packet.trackTrue;
      break;
      
    case 'HDT':
    case 'HDG':
      if (packet.heading !== undefined) state.course = packet.heading;
      break;
  }
  
  // Return position if we have minimum required data
  if (state.lat !== undefined && state.lon !== undefined) {
    return {
      lat: state.lat,
      lon: state.lon,
      timestamp: state.timestamp || new Date(),
      speed: state.speed ?? 0,
      course: state.course ?? 0,
      mmsi: state.mmsi || null,
    };
  }
  
  return null;
}

module.exports = {
  parseNMEA,
  parseSentence,
  extractPosition,
};
