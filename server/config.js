require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3001,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/akz-tracker',
  apiKey: process.env.API_KEY || 'change-me-to-a-real-secret',
  
  // NMEA TCP Listener (disabled by default for simplified GUI)
  nmeaTcpEnabled: false, // process.env.NMEA_TCP_ENABLED === 'true',
  nmeaTcpPort: parseInt(process.env.NMEA_TCP_PORT, 10) || 10110,
  
  // SignalK Client (disabled by default for simplified GUI)
  signalkEnabled: false, // process.env.SIGNALK_ENABLED === 'true',
  signalkUrl: process.env.SIGNALK_URL || '',
  signalkToken: process.env.SIGNALK_TOKEN || '',
  
  // AT4 GPS Tracker TCP Listener
  at4TcpEnabled: process.env.AT4_TCP_ENABLED === 'true',
  at4TcpPort: parseInt(process.env.AT4_TCP_PORT, 10) || 21100,
};
