/* ===== GPX Utilities – Parse and Generate GPX files ===== */

const xml2js = require('xml2js');

/**
 * Parse GPX XML string and extract tracks with metadata.
 * @param {String} xmlString - GPX XML content
 * @returns {Promise<Object>} - { metadata, tracks: [{ name, segments: [{ points }] }] }
 */
async function parseGPX(xmlString) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
  const result = await parser.parseStringPromise(xmlString);
  
  if (!result.gpx) {
    throw new Error('Invalid GPX file: missing <gpx> root element');
  }

  const gpx = result.gpx;
  const metadata = {
    name: gpx.metadata?.name || 'Unnamed',
    description: gpx.metadata?.desc || '',
    time: gpx.metadata?.time || null,
  };

  // Extract tracks
  let tracks = [];
  const trks = gpx.trk ? (Array.isArray(gpx.trk) ? gpx.trk : [gpx.trk]) : [];
  
  for (const trk of trks) {
    const trackName = trk.name || 'Unnamed Track';
    const segments = [];
    const trksegs = trk.trkseg ? (Array.isArray(trk.trkseg) ? trk.trkseg : [trk.trkseg]) : [];
    
    for (const trkseg of trksegs) {
      const points = [];
      const trkpts = trkseg.trkpt ? (Array.isArray(trkseg.trkpt) ? trkseg.trkpt : [trkseg.trkpt]) : [];
      
      for (const trkpt of trkpts) {
        const lat = parseFloat(trkpt.lat);
        const lon = parseFloat(trkpt.lon);
        
        if (isNaN(lat) || isNaN(lon)) continue;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
        
        const point = {
          lat,
          lon,
          time: trkpt.time || null,
          speed: trkpt.speed ? parseFloat(trkpt.speed) : null, // m/s in GPX
          course: null,
          mmsi: null,
          color: null,
          status: 'Under way',
        };

        // Extract extensions if present
        if (trkpt.extensions) {
          if (trkpt.extensions.course) point.course = parseFloat(trkpt.extensions.course);
          if (trkpt.extensions.mmsi) point.mmsi = String(trkpt.extensions.mmsi);
          if (trkpt.extensions.color) point.color = String(trkpt.extensions.color);
          if (trkpt.extensions.status) point.status = String(trkpt.extensions.status);
        }

        points.push(point);
      }
      
      if (points.length > 0) {
        segments.push({ points });
      }
    }
    
    if (segments.length > 0) {
      tracks.push({ name: trackName, segments });
    }
  }

  return { metadata, tracks };
}

/**
 * Generate GPX XML from expedition/track data.
 * @param {Object} metadata - { name, description, time }
 * @param {Array} tracks - [{ boatId, name, color, mmsi, points: [{ lat, lon, timestamp, speed, course, status }] }]
 * @returns {String} - GPX XML string
 */
function generateGPX(metadata, tracks) {
  const escape = (str) => String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<gpx version="1.1" creator="AKZ Tracker" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n';
  
  // Metadata
  xml += '  <metadata>\n';
  xml += `    <name>${escape(metadata.name)}</name>\n`;
  if (metadata.description) {
    xml += `    <desc>${escape(metadata.description)}</desc>\n`;
  }
  if (metadata.time) {
    xml += `    <time>${new Date(metadata.time).toISOString()}</time>\n`;
  }
  xml += '  </metadata>\n';

  // Tracks
  for (const track of tracks) {
    xml += '  <trk>\n';
    xml += `    <name>${escape(track.name)}</name>\n`;
    xml += '    <trkseg>\n';
    
    for (const point of track.points) {
      xml += `      <trkpt lat="${point.lat}" lon="${point.lon}">\n`;
      
      if (point.timestamp) {
        xml += `        <time>${new Date(point.timestamp).toISOString()}</time>\n`;
      }
      
      // Speed: convert knots to m/s (GPX standard)
      if (point.speed != null && point.speed >= 0) {
        const speedMs = point.speed * 0.514444; // knots to m/s
        xml += `        <speed>${speedMs.toFixed(2)}</speed>\n`;
      }
      
      // Extensions for custom fields
      xml += '        <extensions>\n';
      if (point.course != null) {
        xml += `          <course>${point.course}</course>\n`;
      }
      if (point.mmsi) {
        xml += `          <mmsi>${escape(point.mmsi)}</mmsi>\n`;
      }
      if (track.color) {
        xml += `          <color>${escape(track.color)}</color>\n`;
      }
      if (point.status) {
        xml += `          <status>${escape(point.status)}</status>\n`;
      }
      xml += '        </extensions>\n';
      
      xml += '      </trkpt>\n';
    }
    
    xml += '    </trkseg>\n';
    xml += '  </trk>\n';
  }
  
  xml += '</gpx>\n';
  return xml;
}

/**
 * Calculate bearing (course) between two GPS points.
 * @param {Number} lat1 - Start latitude
 * @param {Number} lon1 - Start longitude
 * @param {Number} lat2 - End latitude
 * @param {Number} lon2 - End longitude
 * @returns {Number} - Bearing in degrees (0-360)
 */
function calculateCourse(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * (180 / Math.PI);
  return Math.round((brng + 360) % 360);
}

module.exports = {
  parseGPX,
  generateGPX,
  calculateCourse,
};
