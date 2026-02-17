const express = require('express');
const Expedition = require('../models/Expedition');
const Location = require('../models/Location');
const config = require('../config');
const { generateGPX } = require('../utils/gpx');

const router = express.Router();

// ---------- Middleware: API-key check for write endpoints ----------
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// ---------- GET /api/expeditions – list all ----------
router.get('/expeditions', async (_req, res, next) => {
  try {
    const list = await Expedition.find()
      .sort({ startDate: -1 })
      .select('-_id -__v')
      .lean();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/expeditions/:expeditionId ----------
router.get('/expeditions/:expeditionId', async (req, res, next) => {
  try {
    const doc = await Expedition.findOne({ expeditionId: req.params.expeditionId })
      .select('-_id -__v')
      .lean();
    if (!doc) return res.status(404).json({ error: 'Expedition not found' });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/expeditions/:expeditionId/track ----------
// Returns all Location docs for the expedition's boats between startDate and endDate,
// grouped by boatId, sorted ascending by timestamp.
router.get('/expeditions/:expeditionId/track', async (req, res, next) => {
  try {
    const expedition = await Expedition.findOne({ expeditionId: req.params.expeditionId }).lean();
    if (!expedition) return res.status(404).json({ error: 'Expedition not found' });

    const filter = {
      boatId: { $in: expedition.boatIds },
      timestamp: { $gte: expedition.startDate },
    };
    if (expedition.endDate) {
      filter.timestamp.$lte = expedition.endDate;
    }

    const locations = await Location.find(filter)
      .sort({ boatId: 1, timestamp: 1 })
      .select('-_id -__v')
      .lean();

    // Group by boatId
    const grouped = {};
    for (const loc of locations) {
      if (!grouped[loc.boatId]) grouped[loc.boatId] = [];
      grouped[loc.boatId].push(loc);
    }

    res.json({
      expedition: {
        expeditionId: expedition.expeditionId,
        name: expedition.name,
        boatIds: expedition.boatIds,
        startDate: expedition.startDate,
        endDate: expedition.endDate,
      },
      tracks: grouped,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/expeditions/:expeditionId/export/gpx ----------
// Export expedition as GPX file
router.get('/expeditions/:expeditionId/export/gpx', requireApiKey, async (req, res, next) => {
  try {
    const expedition = await Expedition.findOne({ expeditionId: req.params.expeditionId }).lean();
    if (!expedition) return res.status(404).json({ error: 'Expedition not found' });

    const filter = {
      boatId: { $in: expedition.boatIds },
      timestamp: { $gte: expedition.startDate },
    };
    if (expedition.endDate) {
      filter.timestamp.$lte = expedition.endDate;
    }

    const locations = await Location.find(filter)
      .sort({ boatId: 1, timestamp: 1 })
      .lean();

    // Group by boatId
    const tracks = [];
    const grouped = {};
    
    for (const loc of locations) {
      if (!grouped[loc.boatId]) {
        grouped[loc.boatId] = {
          boatId: loc.boatId,
          name: loc.name,
          color: loc.color,
          points: [],
        };
      }
      grouped[loc.boatId].points.push(loc);
    }

    // Convert to array for GPX generation
    for (const boatId in grouped) {
      tracks.push(grouped[boatId]);
    }

    const metadata = {
      name: expedition.name,
      description: expedition.description || '',
      time: expedition.startDate,
    };

    const gpxXml = generateGPX(metadata, tracks);

    // Clean filename
    const filename = `${expedition.expeditionId}.gpx`.replace(/[^a-z0-9_-]/gi, '_');

    res.set({
      'Content-Type': 'application/gpx+xml',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(gpxXml);
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/expeditions – create ----------
router.post('/expeditions', requireApiKey, async (req, res, next) => {
  try {
    const { expeditionId, name, boatIds, live, startDate, endDate, description } = req.body;

    const errors = [];
    if (!expeditionId) errors.push('expeditionId is required');
    if (!name) errors.push('name is required');
    if (!boatIds || !Array.isArray(boatIds) || boatIds.length === 0)
      errors.push('boatIds must be a non-empty array');
    if (!startDate) errors.push('startDate is required');
    if (errors.length) return res.status(400).json({ errors });

    const doc = await Expedition.create({
      expeditionId,
      name,
      boatIds,
      live: live !== undefined ? live : false,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      description: description || '',
    });

    res.status(201).json({
      expeditionId: doc.expeditionId,
      name: doc.name,
      startDate: doc.startDate,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Expedition ID already exists' });
    }
    next(err);
  }
});

// ---------- PUT /api/expeditions/:expeditionId – update ----------
router.put('/expeditions/:expeditionId', requireApiKey, async (req, res, next) => {
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.boatIds !== undefined) update.boatIds = req.body.boatIds;
    if (req.body.live !== undefined) update.live = req.body.live;
    if (req.body.startDate !== undefined) update.startDate = new Date(req.body.startDate);
    if (req.body.endDate !== undefined) update.endDate = req.body.endDate ? new Date(req.body.endDate) : null;
    if (req.body.description !== undefined) update.description = req.body.description;

    const doc = await Expedition.findOneAndUpdate(
      { expeditionId: req.params.expeditionId },
      { $set: update },
      { new: true }
    )
      .select('-_id -__v')
      .lean();

    if (!doc) return res.status(404).json({ error: 'Expedition not found' });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// ---------- DELETE /api/expeditions/:expeditionId ----------
router.delete('/expeditions/:expeditionId', requireApiKey, async (req, res, next) => {
  try {
    const doc = await Expedition.findOneAndDelete({ expeditionId: req.params.expeditionId });
    if (!doc) return res.status(404).json({ error: 'Expedition not found' });
    res.json({ deleted: true, expeditionId: req.params.expeditionId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
