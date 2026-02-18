const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const WebSocket = require('ws');
const config = require('./config');
const apiRoutes = require('./routes/api');
const expeditionRoutes = require('./routes/expeditions');
const gpxRoutes = require('./routes/gpx');
const nmeaRoutes = require('./routes/nmea');
const NMEAListenerManager = require('./services/nmea-listener-manager');
const SignalKServiceManager = require('./services/signalk-manager');
const AT4ListenerManager = require('./services/at4-listener-manager');

const app = express();
const server = http.createServer(app);

// --------------- WebSocket Server ---------------
const wss = new WebSocket.Server({ server, path: '/ws' });

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    clients.delete(ws);
  });

  // Send initial connection confirmation
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to AKZ Tracker' }));
});

// Broadcast function to send updates to all connected clients
function broadcastLocationUpdate(location) {
  const message = JSON.stringify({
    type: 'location-update',
    data: location,
  });

  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Export broadcast function for use in API routes
app.locals.broadcastLocationUpdate = broadcastLocationUpdate;

// --------------- Middleware ---------------
app.use(cors());
app.use(express.json());

// --------------- API routes ---------------
app.use('/api', apiRoutes);
app.use('/api', expeditionRoutes);
app.use('/api/gpx', gpxRoutes);
app.use('/api/nmea', nmeaRoutes);

// --------------- Serve PWA client ---------------
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// SPA fallback – serve index.html for any non-API, non-file request
app.get('/*splat', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// --------------- Error handler ---------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// --------------- Start ---------------
async function start() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log(`AKZ Tracker API listening on port ${config.port}`);
    console.log(`WebSocket server ready at ws://localhost:${config.port}/ws`);
  });

  // Initialize NMEA TCP listener manager if enabled
  if (config.nmeaTcpEnabled) {
    const nmeaManager = new NMEAListenerManager(broadcastLocationUpdate);
    await nmeaManager.startAll();
    // Store manager in app.locals for access in API routes
    app.locals.nmeaManager = nmeaManager;
  } else {
    console.log('NMEA TCP listener disabled');
  }

  // Initialize SignalK service manager if enabled
  if (config.signalkEnabled && config.signalkUrl) {
    const signalkManager = new SignalKServiceManager(
      config.signalkUrl, 
      config.signalkToken, 
      broadcastLocationUpdate
    );
    await signalkManager.startAll();
    // Store manager in app.locals for access in API routes
    app.locals.signalkManager = signalkManager;
  } else {
    console.log('SignalK client disabled');
  }

  // Initialize AT4 TCP listener manager if enabled
  if (config.at4TcpEnabled) {
    const at4Manager = new AT4ListenerManager(broadcastLocationUpdate);
    await at4Manager.startAll();
    // Store manager in app.locals for access in API routes
    app.locals.at4Manager = at4Manager;
  } else {
    console.log('AT4 TCP listener disabled');
  }
}

start();
