const mongoose = require('mongoose');

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
      min: 10110,
      max: 10129,
    },
    signalkPort: {
      type: Number,
      default: null,
      min: 13110,
      max: 13129,
    },
    at4TcpPort: {
      type: Number,
      default: null,
      min: 15110,
      max: 15129,
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
