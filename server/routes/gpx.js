/* ===== GPX Import Routes ===== */

const express = require('express');
const multer = require('multer');
const { parseGPX, calculateCourse, resampleGPXTrack } = require('../utils/gpx');
const Location = require('../models/Location');
const Boat = require('../models/Boat');
const config = require('../config');

const router = express.Router();

// Middleware: API-key check for admin-only operations
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// Configure multer for file uploads (memory storage, 10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/gpx+xml' || 
        file.mimetype === 'application/xml' ||
        file.mimetype === 'text/xml' ||
        file.originalname.toLowerCase().endsWith('.gpx')) {
      cb(null, true);
    } else {
      cb(new Error('Only GPX files are allowed'));
    }
  },
});

// ---------- POST /api/gpx/import – Upload and parse GPX, return track list ----------
router.post('/import', requireApiKey, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const xmlData = req.file.buffer.toString('utf-8');
    const gpxData = await parseGPX(xmlData);

    if (gpxData.tracks.length === 0) {
      return res.status(400).json({ error: 'No tracks found in GPX file' });
    }

    // Calculate track statistics and prepare response
    const tracksSummary = gpxData.tracks.map((track, idx) => {
      let totalPoints = 0;
      let firstTime = null;
      let lastTime = null;

      track.segments.forEach(seg => {
        totalPoints += seg.points.length;
        seg.points.forEach(pt => {
          if (pt.time) {
            const t = new Date(pt.time).getTime();
            if (!firstTime || t < firstTime) firstTime = t;
            if (!lastTime || t > lastTime) lastTime = t;
          }
        });
      });

      return {
        index: idx,
        name: track.name,
        points: totalPoints,
        startTime: firstTime ? new Date(firstTime).toISOString() : null,
        endTime: lastTime ? new Date(lastTime).toISOString() : null,
      };
    });

    // Store parsed GPX in session or return to client for mapping
    res.json({
      metadata: gpxData.metadata,
      tracks: tracksSummary,
      rawData: gpxData, // Include for next step
    });
  } catch (err) {
    if (err.message.includes('GPX') || err.message.includes('XML')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ---------- POST /api/gpx/import/confirm – Import with boat mapping ----------
router.post('/import/confirm', requireApiKey, async (req, res, next) => {
  try {
    const { gpxData, mapping } = req.body;
    
    if (!gpxData || !mapping) {
      return res.status(400).json({ error: 'Missing gpxData or mapping' });
    }

    // Validate mapping structure: { trackIndex: { pin, resamplingMode? } }
    if (typeof mapping !== 'object') {
      return res.status(400).json({ error: 'Invalid mapping format' });
    }

    let locationsCreated = 0;
    let locationsSkipped = 0;
    const errors = [];

    // Process each track
    for (const [trackIdx, boatMapping] of Object.entries(mapping)) {
      const trackIndex = parseInt(trackIdx);
      if (trackIndex < 0 || trackIndex >= gpxData.tracks.length) {
        errors.push(`Invalid track index: ${trackIdx}`);
        continue;
      }

      let track = gpxData.tracks[trackIndex];
      const { pin, resamplingMode } = boatMapping;

      // Apply resampling if specified
      if (resamplingMode && resamplingMode !== 'none') {
        track = resampleGPXTrack(track, resamplingMode);
      }

      // Validate boat exists by PIN
      const boat = await Boat.findOne({ pin });
      if (!boat) {
        errors.push(`Invalid boat PIN for track "${track.name}"`);
        continue;
      }

      // Process all segments and points in this track
      for (const segment of track.segments) {
        const locationDocs = [];
        
        for (let i = 0; i < segment.points.length; i++) {
          const point = segment.points[i];
          
          // Skip points without timestamp
          if (!point.time) {
            locationsSkipped++;
            continue;
          }

          // Calculate course from consecutive points if not provided
          let course = point.course;
          if (course == null && i > 0) {
            const prevPoint = segment.points[i - 1];
            course = calculateCourse(prevPoint.lat, prevPoint.lon, point.lat, point.lon);
          }
          if (course == null) course = 0;

          // Convert speed from m/s to knots (if present)
          let speed = 0;
          if (point.speed != null && point.speed >= 0) {
            speed = point.speed / 0.514444; // m/s to knots
          }

          locationDocs.push({
            boatId: boat.boatId,
            name: boat.name,
            mmsi: point.mmsi || boat.mmsi || '',
            color: point.color || boat.color,
            lat: point.lat,
            lon: point.lon,
            course: Math.round(course),
            speed: Math.round(speed * 10) / 10,
            status: point.status || 'Under way',
            source: 'gpx',
            timestamp: new Date(point.time),
          });
        }

        // Bulk insert with error handling for duplicates
        if (locationDocs.length > 0) {
          try {
            await Location.insertMany(locationDocs, { ordered: false });
            locationsCreated += locationDocs.length;
          } catch (err) {
            // Handle duplicate key errors (timestamp + boatId uniqueness)
            if (err.code === 11000) {
              // Count successfully inserted docs
              const inserted = err.result?.nInserted || 0;
              locationsCreated += inserted;
              locationsSkipped += locationDocs.length - inserted;
            } else {
              throw err;
            }
          }
        }
      }
    }

    res.json({
      success: true,
      locationsCreated,
      locationsSkipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
