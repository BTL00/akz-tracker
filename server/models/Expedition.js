const mongoose = require('mongoose');

const expeditionSchema = new mongoose.Schema(
  {
    expeditionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    boatIds: {
      type: [String],
      required: true,
      validate: {
        validator: function (v) {
          return v && v.length > 0;
        },
        message: 'At least one boatId is required',
      },
    },
    live: {
      type: Boolean,
      default: false,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    description: {
      type: String,
      default: '',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Expedition', expeditionSchema);
