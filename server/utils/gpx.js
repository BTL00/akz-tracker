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

/**
 * Resample GPX track using time-bucket decimation.
 * Keeps only the point closest to each interval boundary.
 * @param {Object} track - Track object with segments and points
 * @param {String} samplingMode - 'none', '1min', '10min', or '1hour'
 * @returns {Object} - Resampled track
 */
function resampleGPXTrack(track, samplingMode) {
  if (samplingMode === 'none') {
    return track;
  }

  // Map sampling mode to interval in milliseconds
  const intervals = {
    '1min': 60 * 1000,
    '10min': 10 * 60 * 1000,
    '1hour': 60 * 60 * 1000,
  };

  const interval = intervals[samplingMode];
  if (!interval) {
    return track;
  }

  // Resample each segment
  const resampledSegments = track.segments.map(segment => {
    if (!segment.points || segment.points.length === 0) {
      return segment;
    }

    // Sort points by time to ensure chronological order
    const sortedPoints = [...segment.points].sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0;
      const timeB = b.time ? new Date(b.time).getTime() : 0;
      return timeA - timeB;
    });

    if (sortedPoints.length === 0) {
      return segment;
    }

    // Build time buckets and find closest point to each boundary
    const firstTime = new Date(sortedPoints[0].time).getTime();
    const lastTime = new Date(sortedPoints[sortedPoints.length - 1].time).getTime();
    
    const buckets = new Map(); // bucket number -> closest point
    
    sortedPoints.forEach(point => {
      if (!point.time) return;
      
      const pointTime = new Date(point.time).getTime();
      const bucketNum = Math.floor((pointTime - firstTime) / interval);
      const bucketBoundary = firstTime + (bucketNum * interval);
      
      // Keep point if it's the first in this bucket or closer to boundary than existing
      if (!buckets.has(bucketNum)) {
        buckets.set(bucketNum, point);
      } else {
        const existing = buckets.get(bucketNum);
        const existingTime = new Date(existing.time).getTime();
        const existingDist = Math.abs(existingTime - bucketBoundary);
        const newDist = Math.abs(pointTime - bucketBoundary);
        
        if (newDist < existingDist) {
          buckets.set(bucketNum, point);
        }
      }
    });

    // Convert map to sorted array
    const resampledPoints = Array.from(buckets.values())
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return { points: resampledPoints };
  });

  return {
    name: track.name,
    segments: resampledSegments,
  };
}

module.exports = {
  parseGPX,
  generateGPX,
  calculateCourse,
  resampleGPXTrack,
};
