const express = require('express');
const crypto = require('crypto');
const Location = require('../models/Location');
const Boat = require('../models/Boat');
const config = require('../config');
const { generateGPX } = require('../utils/gpx');

const router = express.Router();

// Port range constants
const NMEA_PORT_MIN = 10110;
const NMEA_PORT_MAX = 10129;
const SIGNALK_PORT_MIN = 13110;
const SIGNALK_PORT_MAX = 13129;
const AT4_PORT_MIN = 21100;
const AT4_PORT_MAX = 21129;

// ---------- Middleware: API-key check for write endpoints ----------
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// ---------- GET /api/boats – latest position of every boat ----------
router.get('/boats', async (_req, res, next) => {
  try {
    const boats = await Location.aggregate([
      { $sort: { boatId: 1, timestamp: -1 } },
      {
        $group: {
          _id: '$boatId',
          boatId: { $first: '$boatId' },
          name: { $first: '$name' },
          mmsi: { $first: '$mmsi' },
          color: { $first: '$color' },
          lat: { $first: '$lat' },
          lon: { $first: '$lon' },
          course: { $first: '$course' },
          speed: { $first: '$speed' },
          status: { $first: '$status' },
          timestamp: { $first: '$timestamp' },
        },
      },
      {
        $lookup: {
          from: 'boats',
          localField: 'boatId',
          foreignField: 'boatId',
          as: 'boat',
        },
      },
      { $unwind: { path: '$boat', preserveNullAndEmptyArrays: true } },
      { $addFields: { live: { $ifNull: ['$boat.live', true] } } },
      { $project: { _id: 0, boat: 0 } },
    ]);
    res.json(boats);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/boats/:boatId/history – track history ----------
// Supports optional ?from=ISO&to=ISO date-range filtering.
// When from/to are provided, results are sorted ascending (chronological)
// and the limit is raised to 10000.
router.get('/boats/:boatId/history', async (req, res, next) => {
  try {
    const { boatId } = req.params;
    const { from, to } = req.query;

    const filter = { boatId };
    const hasDateRange = from || to;

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }

    const maxLimit = hasDateRange ? 10000 : 1000;
    const limit = Math.min(parseInt(req.query.limit, 10) || (hasDateRange ? 10000 : 100), maxLimit);
    // Ascending when date range specified (playback needs chronological order)
    const sortDir = hasDateRange ? 1 : -1;

    const history = await Location.find(filter)
      .sort({ timestamp: sortDir })
      .limit(limit)
      .select('-_id -__v')
      .lean();
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/location – push a new position ----------
router.post('/location', async (req, res, next) => {
  try {
    const { lat, lon, course, speed, status, pin, source } = req.body;

    // Validate required fields
    const errors = [];
    if (!pin) errors.push('pin is required');
    if (lat == null || lat < -90 || lat > 90) errors.push('lat must be between -90 and 90');
    if (lon == null || lon < -180 || lon > 180) errors.push('lon must be between -180 and 180');
    if (course == null || course < 0 || course > 360) errors.push('course must be between 0 and 360');
    if (speed == null || speed < 0) errors.push('speed must be >= 0');

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    // Lookup boat by PIN (PINs are unique)
    const boat = await Boat.findOne({ pin });
    if (!boat) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    if (source === 'validation') {
      return res.status(204).end();
    }

    // Use boat's stored details
    const doc = await Location.create({
      boatId: boat.boatId,
      name: boat.name,
      mmsi: boat.mmsi || '',
      color: boat.color,
      lat,
      lon,
      course,
      speed,
      status: status || 'Under way',
      source: source || 'phone',
    });

    // Broadcast location update via WebSocket
    if (req.app.locals.broadcastLocationUpdate) {
      req.app.locals.broadcastLocationUpdate({
        boatId: doc.boatId,
        name: doc.name,
        mmsi: doc.mmsi,
        color: doc.color,
        lat: doc.lat,
        lon: doc.lon,
        course: doc.course,
        speed: doc.speed,
        status: doc.status,
        source: doc.source,
        timestamp: doc.timestamp,
      });
    }

    res.status(201).json({
      boatId: doc.boatId,
      timestamp: doc.timestamp,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/boats – create a new boat ----------
router.post('/boats', requireApiKey, async (req, res, next) => {
  try {
    const { boatId, name, color, mmsi, nmeaTcpPort, signalkPort, signalkUrl, signalkToken, at4TcpPort, enabledSources, live } = req.body;

    // Validate required fields
    const errors = [];
    if (!boatId) errors.push('boatId is required');
    if (!name) errors.push('name is required');

    // Validate port ranges if provided
    if (nmeaTcpPort && (nmeaTcpPort < NMEA_PORT_MIN || nmeaTcpPort > NMEA_PORT_MAX)) {
      errors.push(`NMEA TCP Port must be between ${NMEA_PORT_MIN} and ${NMEA_PORT_MAX}`);
    }
    if (signalkPort && (signalkPort < SIGNALK_PORT_MIN || signalkPort > SIGNALK_PORT_MAX)) {
      errors.push(`SignalK Port must be between ${SIGNALK_PORT_MIN} and ${SIGNALK_PORT_MAX}`);
    }
    if (at4TcpPort && (at4TcpPort < AT4_PORT_MIN || at4TcpPort > AT4_PORT_MAX)) {
      errors.push(`AT4 TCP Port must be between ${AT4_PORT_MIN} and ${AT4_PORT_MAX}`);
    }

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    // Generate 6-digit PIN
    const pin = String(Math.floor(100000 + Math.random() * 900000));

    // Generate API key for GPS trackers (UUID)
    const apiKey = crypto.randomUUID();

    const doc = await Boat.create({
      boatId,
      name,
      color: color || '#3388ff',
      mmsi: mmsi || '',
      pin,
      apiKey,
      nmeaTcpPort: nmeaTcpPort || null,
      signalkPort: signalkPort || null,
      signalkUrl: signalkUrl || null,
      signalkToken: signalkToken || null,
      at4TcpPort: at4TcpPort || null,
      enabledSources: enabledSources || undefined,
      live: live !== undefined ? live : true,
    });

    // Start services for this boat if managers are available and configs are set
    if (nmeaTcpPort && req.app.locals.nmeaManager) {
      await req.app.locals.nmeaManager.startForBoat(boatId, nmeaTcpPort, mmsi);
    }
    if ((signalkUrl || signalkPort) && req.app.locals.signalkManager) {
      await req.app.locals.signalkManager.startForBoat(doc);
    }
    if (at4TcpPort && req.app.locals.at4Manager) {
      await req.app.locals.at4Manager.startForBoat(boatId, at4TcpPort, mmsi);
    }

    res.status(201).json({
      boatId: doc.boatId,
      name: doc.name,
      color: doc.color,
      mmsi: doc.mmsi,
      live: doc.live,
      pin: doc.pin,
      apiKey: doc.apiKey,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Boat ID already exists' });
    }
    next(err);
  }
});

// ---------- PATCH /api/boats/:boatId – update boat properties ----------
router.patch('/boats/:boatId', requireApiKey, async (req, res, next) => {
  try {
    const { boatId } = req.params;
    const { name, color, mmsi, nmeaTcpPort, at4TcpPort, signalkPort, signalkUrl, signalkToken, enabledSources, live } = req.body;

    // Validate port ranges if provided
    if (nmeaTcpPort !== undefined && nmeaTcpPort !== null) {
      if (nmeaTcpPort < NMEA_PORT_MIN || nmeaTcpPort > NMEA_PORT_MAX) {
        return res.status(400).json({ error: `NMEA TCP Port must be between ${NMEA_PORT_MIN} and ${NMEA_PORT_MAX}` });
      }
    }
    if (at4TcpPort !== undefined && at4TcpPort !== null) {
      if (at4TcpPort < AT4_PORT_MIN || at4TcpPort > AT4_PORT_MAX) {
        return res.status(400).json({ error: `AT4 TCP Port must be between ${AT4_PORT_MIN} and ${AT4_PORT_MAX}` });
      }
    }
    if (signalkPort !== undefined && signalkPort !== null) {
      if (signalkPort < SIGNALK_PORT_MIN || signalkPort > SIGNALK_PORT_MAX) {
        return res.status(400).json({ error: `SignalK Port must be between ${SIGNALK_PORT_MIN} and ${SIGNALK_PORT_MAX}` });
      }
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (mmsi !== undefined) updates.mmsi = mmsi;
    if (nmeaTcpPort !== undefined) updates.nmeaTcpPort = nmeaTcpPort;
    if (at4TcpPort !== undefined) updates.at4TcpPort = at4TcpPort;
    if (signalkPort !== undefined) updates.signalkPort = signalkPort;
    if (signalkUrl !== undefined) updates.signalkUrl = signalkUrl;
    if (signalkToken !== undefined) updates.signalkToken = signalkToken;
    if (enabledSources !== undefined) updates.enabledSources = enabledSources;
    if (live !== undefined) updates.live = live;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Update the Boat model
    const boat = await Boat.findOneAndUpdate(
      { boatId },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!boat) {
      return res.status(404).json({ error: 'Boat not found' });
    }

    // Update location records with new boat properties (name, color, mmsi only)
    const locationUpdates = {};
    if (name !== undefined) locationUpdates.name = name;
    if (color !== undefined) locationUpdates.color = color;
    if (mmsi !== undefined) locationUpdates.mmsi = mmsi;

    if (Object.keys(locationUpdates).length > 0) {
      await Location.updateMany(
        { boatId },
        { $set: locationUpdates }
      );
    }

    // Restart services if configs changed
    if (nmeaTcpPort !== undefined && req.app.locals.nmeaManager) {
      await req.app.locals.nmeaManager.restartForBoat(boatId);
    }
    if (at4TcpPort !== undefined && req.app.locals.at4Manager) {
      await req.app.locals.at4Manager.restartForBoat(boatId);
    }
    if ((signalkPort !== undefined || signalkUrl !== undefined || signalkToken !== undefined) && req.app.locals.signalkManager) {
      await req.app.locals.signalkManager.restartForBoat(boatId);
    }

    res.json({
      boatId: boat.boatId,
      name: boat.name,
      color: boat.color,
      mmsi: boat.mmsi,
      live: boat.live,
      nmeaTcpPort: boat.nmeaTcpPort,
      signalkPort: boat.signalkPort,
      signalkUrl: boat.signalkUrl,
      // Don't expose signalkToken in response for security
      at4TcpPort: boat.at4TcpPort,
      enabledSources: boat.enabledSources,
      message: 'Boat updated successfully'
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/boats/:boatId/export/gpx – Export boat history as GPX ----------
router.get('/boats/:boatId/export/gpx', requireApiKey, async (req, res, next) => {
  try {
    const { boatId } = req.params;
    const { startDate, endDate } = req.query;

    // Validate boat exists
    const boat = await Boat.findOne({ boatId });
    if (!boat) {
      return res.status(404).json({ error: 'Boat not found' });
    }

    // Build query filter
    const filter = { boatId };
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const locations = await Location.find(filter)
      .sort({ timestamp: 1 })
      .lean();

    if (locations.length === 0) {
      return res.status(404).json({ error: 'No location data found for this boat' });
    }

    // Prepare track
    const track = {
      boatId: boat.boatId,
      name: boat.name,
      color: boat.color,
      points: locations,
    };

    const metadata = {
      name: `${boat.name} Track`,
      description: `GPS track for ${boat.name}${startDate ? ` from ${startDate}` : ''}${endDate ? ` to ${endDate}` : ''}`,
      time: locations[0].timestamp,
    };

    const gpxXml = generateGPX(metadata, [track]);

    // Clean filename
    const filename = `${boat.boatId}_track.gpx`.replace(/[^a-z0-9_-]/gi, '_');

    res.set({
      'Content-Type': 'application/gpx+xml',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(gpxXml);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/boats-metadata – Get all boat metadata (PIN, API keys, etc.) – Admin only ----------
router.get('/boats-metadata', requireApiKey, async (req, res, next) => {
  try {
    const boats = await Boat.find()
      .select('-_id -__v')
      .lean();

    // Enrich each boat with tracker status information
    const enrichedBoats = await Promise.all(boats.map(async (boat) => {
      // Check AT4 tracker status
      let at4Status = { active: false, connected: false };
      if (boat.at4TcpPort && req.app.locals.at4Manager) {
        const listener = req.app.locals.at4Manager.listeners.get(boat.boatId);
        if (listener) {
          at4Status.active = listener.server && listener.server.listening;
          at4Status.connected = listener.clients.size > 0;
        }
      }

      // Check phone tracker status (active if location update within last 5 minutes)
      let phoneStatus = { active: false };
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentPhoneLocation = await Location.findOne({
        boatId: boat.boatId,
        source: 'phone',
        timestamp: { $gte: fiveMinutesAgo }
      }).select('timestamp').lean();

      if (recentPhoneLocation) {
        phoneStatus.active = true;
        phoneStatus.lastUpdate = recentPhoneLocation.timestamp;
      }

      return {
        ...boat,
        trackerStatus: {
          at4: at4Status,
          phone: phoneStatus
        }
      };
    }));

    res.json(enrichedBoats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
