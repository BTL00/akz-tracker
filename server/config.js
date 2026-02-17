require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/akz-tracker',
  apiKey: process.env.API_KEY || 'change-me-to-a-real-secret',
  
  // NMEA TCP Listener
  nmeaTcpEnabled: process.env.NMEA_TCP_ENABLED === 'true',
  nmeaTcpPort: parseInt(process.env.NMEA_TCP_PORT, 10) || 10110,
  
  // SignalK Client
  signalkEnabled: process.env.SIGNALK_ENABLED === 'true',
  signalkUrl: process.env.SIGNALK_URL || '',
  signalkToken: process.env.SIGNALK_TOKEN || '',
};
