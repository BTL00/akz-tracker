/* ===== expedition.js – expedition data fetching & selector ===== */

var _expeditions = [];      // cached list
var _activeExpedition = null; // currently selected expedition object
var _trackData = null;        // { boatId: Location[] }

/**
 * Fetch all expeditions from the API.
 * @returns {Promise<Array>}
 */
function fetchExpeditions() {
  return fetch('/api/expeditions')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (list) {
      _expeditions = list;
      return list;
    });
}

/**
 * Fetch the full track data for an expedition.
 * Pre-processes timestamps for faster interpolation.
 * @param {string} expeditionId
 * @returns {Promise<{ expedition, tracks }>}
 */
function fetchExpeditionTrack(expeditionId) {
  return fetch('/api/expeditions/' + encodeURIComponent(expeditionId) + '/track')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      _activeExpedition = data.expedition;
      
      // Pre-process tracks: cache timestamp as ms for faster interpolation
      var processedTracks = {};
      Object.keys(data.tracks).forEach(function (boatId) {
        var arr = data.tracks[boatId];
        processedTracks[boatId] = arr.map(function (loc) {
          // Add cached timestamp in milliseconds to avoid repeated Date parsing
          loc._cachedTime = new Date(loc.timestamp).getTime();
          return loc;
        });
      });
      
      _trackData = processedTracks;
      return data;
    });
}

/**
 * Populate the expedition <select> dropdown.
 * @param {Array} expeditions
 */
function populateExpeditionSelect(expeditions) {
  var sel = document.getElementById('expedition-select');
  if (!sel) return;

  // Clear existing options (keep first "All Boats" option)
  while (sel.options.length > 1) sel.remove(1);

  expeditions.forEach(function (exp) {
    if (exp.live) {
      // For live expeditions, add two options: Live and Playback
      var optLive = document.createElement('option');
      optLive.value = exp.expeditionId + ':live';
      optLive.textContent = exp.name + ' - Live';
      sel.appendChild(optLive);

      var optPlayback = document.createElement('option');
      optPlayback.value = exp.expeditionId + ':playback';
      optPlayback.textContent = exp.name + ' - Playback';
      sel.appendChild(optPlayback);
    } else {
      // For historical expeditions, add single option with Playback suffix only
      var opt = document.createElement('option');
      opt.value = exp.expeditionId;
      opt.textContent = exp.name + ' - Playback';
      sel.appendChild(opt);
    }
  });
}

/**
 * Get the earliest and latest timestamp across all tracks.
 * Uses cached timestamps for better performance.
 * @param {Object} tracks – { boatId: Location[] }
 * @returns {{ min: number, max: number }} – ms timestamps
 */
function getTrackTimeRange(tracks) {
  var min = Infinity;
  var max = -Infinity;

  Object.keys(tracks).forEach(function (boatId) {
    var arr = tracks[boatId];
    if (!arr.length) return;
    // Use cached timestamps if available, otherwise parse
    var first = arr[0]._cachedTime || new Date(arr[0].timestamp).getTime();
    var last = arr[arr.length - 1]._cachedTime || new Date(arr[arr.length - 1].timestamp).getTime();
    if (first < min) min = first;
    if (last > max) max = last;
  });

  return { min: min, max: max };
}

/**
 * Binary search to find the index of the last point <= time.
 * @param {Array} arr – Location array with _cachedTime
 * @param {number} time – ms timestamp
 * @returns {number} – index or -1 if time < first point
 */
function binarySearchTime(arr, time) {
  var left = 0;
  var right = arr.length - 1;
  var result = -1;

  while (left <= right) {
    var mid = Math.floor((left + right) / 2);
    var midTime = arr[mid]._cachedTime || new Date(arr[mid].timestamp).getTime();
    
    if (midTime <= time) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  
  return result;
}

/**
 * For a given timestamp, find the interpolated position of each boat.
 * Uses binary search and cached timestamps for better performance.
 *
 * @param {Object} tracks – { boatId: Location[] } (ascending by timestamp)
 * @param {number} time   – ms timestamp to interpolate at
 * @returns {Array} – [{ boatId, name, lat, lon, course, speed, status, timestamp }]
 */
function interpolatePositions(tracks, time) {
  var results = [];

  Object.keys(tracks).forEach(function (boatId) {
    var arr = tracks[boatId];
    if (!arr.length) return;

    // Use cached timestamps for boundary checks
    var firstTime = arr[0]._cachedTime || new Date(arr[0].timestamp).getTime();
    var lastTime = arr[arr.length - 1]._cachedTime || new Date(arr[arr.length - 1].timestamp).getTime();

    // Before first point → use first point
    if (time <= firstTime) {
      results.push(makeBoat(arr[0], firstTime));
      return;
    }

    // After last point → use last point
    if (time >= lastTime) {
      results.push(makeBoat(arr[arr.length - 1], lastTime));
      return;
    }

    // Binary search for bracketing points
    var i = binarySearchTime(arr, time);
    if (i >= 0 && i < arr.length - 1) {
      var p1 = arr[i];
      var p2 = arr[i + 1];
      var t1 = p1._cachedTime || new Date(p1.timestamp).getTime();
      var t2 = p2._cachedTime || new Date(p2.timestamp).getTime();
      
      var frac = (t2 === t1) ? 0 : (time - t1) / (t2 - t1);

      results.push({
        boatId: boatId,
        name: p1.name,
        lat: p1.lat + (p2.lat - p1.lat) * frac,
        lon: p1.lon + (p2.lon - p1.lon) * frac,
        course: interpolateCourse(p1.course, p2.course, frac),
        speed: p1.speed + (p2.speed - p1.speed) * frac,
        status: p1.status,
        timestamp: new Date(time).toISOString(),
      });
    }
  });

  return results;
}

/**
 * Interpolate between two course angles via shortest arc.
 */
function interpolateCourse(a, b, frac) {
  var diff = b - a;
  // Shortest path around the circle
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  var result = a + diff * frac;
  if (result < 0) result += 360;
  if (result >= 360) result -= 360;
  return Math.round(result);
}

function makeBoat(loc, time) {
  return {
    boatId: loc.boatId,
    name: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    course: loc.course,
    speed: loc.speed,
    status: loc.status,
    timestamp: new Date(time).toISOString(),
  };
}
