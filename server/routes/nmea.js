/* ===== NMEA Import Routes ===== */

const express = require('express');
const multer = require('multer');
const { parseNMEA, parseSentence, extractPosition } = require('../utils/nmea');
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
    const validExtensions = ['.nmea', '.txt', '.log', '.nmea0183'];
    const filename = file.originalname.toLowerCase();
    
    if (validExtensions.some(ext => filename.endsWith(ext)) ||
        file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only NMEA text files are allowed (.nmea, .txt, .log)'));
    }
  },
});

// ---------- POST /api/nmea/import – Upload and parse NMEA, return summary ----------
router.post('/import', requireApiKey, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const nmeaContent = req.file.buffer.toString('utf-8');
    const nmeaData = parseNMEA(nmeaContent);

    if (nmeaData.positions.length === 0) {
      return res.status(400).json({ 
        error: 'No valid positions found in NMEA file',
        details: nmeaData.summary,
      });
    }

    // Return summary for user review
    res.json({
      filename: req.file.originalname,
      summary: nmeaData.summary,
      positions: nmeaData.positions.length,
      timeRange: nmeaData.summary.timeRange,
      rawData: nmeaData, // Include for next step (confirm)
    });
  } catch (err) {
    if (err.message.includes('NMEA')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ---------- POST /api/nmea/import/confirm – Import with boat mapping ----------
router.post('/import/confirm', requireApiKey, async (req, res, next) => {
  try {
    const { nmeaData, boatId, pin } = req.body;
    
    if (!nmeaData || !boatId || !pin) {
      return res.status(400).json({ error: 'Missing nmeaData, boatId, or pin' });
    }

    if (!nmeaData.positions || nmeaData.positions.length === 0) {
      return res.status(400).json({ error: 'No positions in NMEA data' });
    }

    // Validate boat and PIN
    const boat = await Boat.findOne({ boatId, pin });
    if (!boat) {
      return res.status(401).json({ error: 'Invalid boat ID or PIN' });
    }

    // Check MMSI matching if boat has MMSI configured
    // NMEA positions might have MMSI from AIS messages
    const hasMMSI = boat.mmsi && boat.mmsi.trim().length > 0;
    const positionsWithMMSI = nmeaData.positions.filter(p => p.mmsi);
    
    if (hasMMSI && positionsWithMMSI.length > 0) {
      const mismatchedMMSI = positionsWithMMSI.filter(p => p.mmsi !== boat.mmsi);
      if (mismatchedMMSI.length > 0) {
        return res.status(400).json({ 
          error: `MMSI mismatch: Boat has MMSI ${boat.mmsi} but data contains different MMSI`,
          details: {
            boatMMSI: boat.mmsi,
            foundMMSI: [...new Set(positionsWithMMSI.map(p => p.mmsi))],
          },
        });
      }
    }

    let locationsCreated = 0;
    let locationsSkipped = 0;

    // Prepare location documents
    const locationDocs = nmeaData.positions.map(pos => ({
      boatId: boat.boatId,
      name: boat.name,
      mmsi: boat.mmsi || pos.mmsi || '',
      color: boat.color,
      lat: pos.lat,
      lon: pos.lon,
      course: Math.round(pos.course || 0),
      speed: Math.round((pos.speed || 0) * 10) / 10, // Already in knots from parser
      status: 'Under way',
      source: 'nmea',
      timestamp: new Date(pos.timestamp),
    }));

    // Bulk insert with error handling for duplicates
    try {
      await Location.insertMany(locationDocs, { ordered: false });
      locationsCreated = locationDocs.length;
    } catch (err) {
      // Handle duplicate key errors (timestamp + boatId uniqueness)
      if (err.code === 11000) {
        // Count successfully inserted docs
        const inserted = err.result?.nInserted || 0;
        locationsCreated = inserted;
        locationsSkipped = locationDocs.length - inserted;
      } else {
        throw err;
      }
    }

    res.json({
      success: true,
      locationsCreated,
      locationsSkipped,
      boatId: boat.boatId,
      boatName: boat.name,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/nmea/relay – Relay NMEA sentences from smartphone ----------
// This endpoint receives NMEA sentences from a smartphone that's connected to an external NMEA server.
// The smartphone acts as a client to the external server and relays the data to our backend.
router.post('/relay', async (req, res, next) => {
  try {
    const { sentences, boatId, pin } = req.body;
    
    if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
      return res.status(400).json({ error: 'sentences array is required' });
    }
    
    if (!boatId || !pin) {
      return res.status(400).json({ error: 'boatId and pin are required' });
    }

    // Validate boat and PIN
    const boat = await Boat.findOne({ boatId, pin });
    if (!boat) {
      return res.status(401).json({ error: 'Invalid boat ID or PIN' });
    }

    // Process sentences and accumulate state
    let state = {};
    let positionsToSave = [];
    
    for (const sentence of sentences) {
      const packet = parseSentence(sentence);
      if (packet) {
        const position = extractPosition(packet, state);
        if (position && position.lat != null && position.lon != null) {
          positionsToSave.push({
            boatId: boat.boatId,
            name: boat.name,
            mmsi: boat.mmsi || '',
            color: boat.color,
            lat: position.lat,
            lon: position.lon,
            course: Math.round(position.course * 10) / 10 || 0,
            speed: Math.round((position.speed || 0) * 10) / 10,
            status: 'Under way',
            source: 'nmea-client',
            timestamp: position.timestamp || new Date(),
          });
        }
      }
    }
    
    // Save positions and broadcast updates
    if (positionsToSave.length > 0) {
      // Save the most recent position
      const latestPosition = positionsToSave[positionsToSave.length - 1];
      
      try {
        await Location.create(latestPosition);
        
        // Broadcast to WebSocket clients
        if (req.app.locals.broadcastLocationUpdate) {
          req.app.locals.broadcastLocationUpdate(latestPosition);
        }
        
        res.json({ 
          success: true, 
          positionsProcessed: sentences.length,
          positionsSaved: 1
        });
      } catch (err) {
        // Handle duplicate key error gracefully
        if (err.code === 11000) {
          res.json({ 
            success: true, 
            positionsProcessed: sentences.length,
            positionsSaved: 0,
            note: 'Position already exists'
          });
        } else {
          throw err;
        }
      }
    } else {
      res.json({ 
        success: true, 
        positionsProcessed: sentences.length,
        positionsSaved: 0,
        note: 'No valid positions extracted'
      });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
