const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    boatId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    lat: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    lon: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    course: {
      type: Number,
      required: true,
      min: 0,
      max: 360,
    },
    speed: {
      type: Number,
      required: true,
      min: 0,
    },
    mmsi: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      default: '#e74c3c',
    },
    status: {
      type: String,
      default: 'Under way',
    },
    source: {
      type: String,
      enum: ['phone', 'tracker', 'gpx', 'nmea', 'signalk', 'ais'],
      default: 'tracker',
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

// Compound index for efficient "latest per boat" queries
locationSchema.index({ boatId: 1, timestamp: -1 });

module.exports = mongoose.model('Location', locationSchema);
