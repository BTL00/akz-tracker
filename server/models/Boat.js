const mongoose = require('mongoose');

// Port range constants
const NMEA_PORT_MIN = 10110;
const NMEA_PORT_MAX = 10129;
const SIGNALK_PORT_MIN = 13110;
const SIGNALK_PORT_MAX = 13129;
const AT4_PORT_MIN = 15110;
const AT4_PORT_MAX = 15129;

const boatSchema = new mongoose.Schema(
  {
    boatId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    color: {
      type: String,
      default: '#3388ff',
    },
    mmsi: {
      type: String,
      default: '',
    },
    pin: {
      type: String,
      required: true,
      index: true,
      match: /^[0-9]{6}$/,
    },
    apiKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    nmeaTcpPort: {
      type: Number,
      default: null,
      min: NMEA_PORT_MIN,
      max: NMEA_PORT_MAX,
    },
    at4TcpPort: {
      type: Number,
      default: null,
      min: 15110,
      max: 15129,
    },
    signalkPort: {
      type: Number,
      default: null,
      min: SIGNALK_PORT_MIN,
      max: SIGNALK_PORT_MAX,
    },
    at4TcpPort: {
      type: Number,
      default: null,
      min: AT4_PORT_MIN,
      max: AT4_PORT_MAX,
    },
    signalkUrl: {
      type: String,
      default: null,
    },
    signalkToken: {
      type: String,
      default: null,
    },
    enabledSources: {
      type: [String],
      enum: ['phone', 'tracker', 'gpx', 'nmea', 'signalk', 'ais'],
      default: ['phone', 'tracker', 'gpx', 'nmea', 'signalk', 'ais'],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Boat', boatSchema);
