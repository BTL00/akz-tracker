/* ===== boats.js – render boat markers, course lines & popups ===== */

var _markerPool  = {};    // { boatId: { marker, line, tooltip } }
var _boatLayer   = null;  // L.LayerGroup
var _trackLayer  = null;  // L.LayerGroup for historical track polylines
var _isSimplifiedMode = false;  // Track if simplified paths are currently shown
var _fullTracks = null;  // Store full track data for later progressive rendering

/**
 * Build an SVG arrow icon as an L.divIcon, rotated to `course` degrees.
 * Red (#e74c3c) when moving, grey (#7f8c8d) when stopped.
 */
function boatIcon(course, speed, color) {
  var fill   = speed > 0 ? (color || '#e74c3c') : '#7f8c8d';
  var stroke = '#222';
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"' +
    ' style="transform:rotate(' + course + 'deg);transition:transform 0.3s ease">' +
    '<polygon points="14,2 24,24 14,19 4,24"' +
    ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.2"/>' +
    '</svg>';

  return L.divIcon({
    html: svg,
    className: 'boat-icon',
    iconSize:   [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

/**
 * Build popup HTML for a boat.
 */
function boatPopupHtml(b) {
  var ts = b.timestamp ? new Date(b.timestamp).toLocaleString() : '—';
  return (
    '<div class="boat-popup">' +
      '<div class="boat-name">' + escHtml(b.name) + '</div>' +
      '<hr/>' +
      '<div class="field"><b>MMSI:</b> '   + escHtml(b.mmsi || '—') + '</div>' +
      '<div class="field"><b>Course:</b> ' + b.course + '&deg;</div>' +
      '<div class="field"><b>Speed:</b> '  + b.speed.toFixed(1)  + ' kn</div>' +
      '<div class="field"><b>Status:</b> ' + escHtml(b.status) + '</div>' +
      '<div class="field"><b>Pos:</b> '    + b.lat.toFixed(4) + ', ' + b.lon.toFixed(4) + '</div>' +
      '<div class="field"><b>Updated:</b> ' + ts + '</div>' +
    '</div>'
  );
}

/**
 * Build the permanent tooltip text: name, course, speed.
 */
function tooltipContent(b) {
  return '<b>' + escHtml(b.name) + '</b><br/>' +
    b.course + '° &middot; ' + b.speed.toFixed(1) + ' kn';
}

/**
 * Minimal HTML escaping.
 */
function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

/**
 * Compute the end-point of a course line (dashed) from a boat position.
 * Returns [lat, lon] offset ~600 m in the heading direction.
 */
function courseLineEnd(lat, lon, course) {
  var DISTANCE_M  = 600;
  var EARTH_R     = 6371000;
  var rad         = course * Math.PI / 180;
  var dLat        = (DISTANCE_M / EARTH_R) * Math.cos(rad) * (180 / Math.PI);
  var dLon        = (DISTANCE_M / (EARTH_R * Math.cos(lat * Math.PI / 180))) *
                    Math.sin(rad) * (180 / Math.PI);
  return [lat + dLat, lon + dLon];
}

/**
 * Ensure the boat layer group exists.
 */
function ensureBoatLayer(map) {
  if (!_boatLayer) {
    _boatLayer = L.layerGroup().addTo(map);
  }
}

/**
 * Update boat markers using a persistent marker pool (no teardown).
 * Existing markers are moved; new ones are created; stale ones are removed.
 *
 * @param {L.Map} map
 * @param {Array} boats  – [{ boatId, name, lat, lon, course, speed, status, timestamp }]
 * @param {Object} [opts]
 * @param {boolean} [opts.fitBounds=true]  – auto-fit the viewport to markers
 */
function updateBoats(map, boats, opts) {
  opts = opts || {};
  var fitBounds = opts.fitBounds !== undefined ? opts.fitBounds : true;

  ensureBoatLayer(map);

  var seenIds = {};

  boats.forEach(function (b) {
    seenIds[b.boatId] = true;
    var existing = _markerPool[b.boatId];

    if (existing) {
      // Move existing marker smoothly
      existing.marker.setLatLng([b.lat, b.lon]);
      existing.marker.setIcon(boatIcon(b.course, b.speed, b.color));
      existing.marker.setPopupContent(boatPopupHtml(b));
      existing.marker.setTooltipContent(tooltipContent(b));

      // Update course line
      var end = courseLineEnd(b.lat, b.lon, b.course);
      existing.line.setLatLngs([[b.lat, b.lon], end]);
      existing.line.setStyle({ color: b.speed > 0 ? (b.color || '#c0392b') : '#7f8c8d' });
    } else {
      // Create new marker
      var marker = L.marker([b.lat, b.lon], {
        icon: boatIcon(b.course, b.speed, b.color),
        title: b.name,
      });

      marker.bindTooltip(tooltipContent(b), {
        permanent: true,
        direction: 'right',
        offset: [14, 0],
        className: 'boat-tooltip',
      });

      marker.bindPopup(boatPopupHtml(b), { maxWidth: 260 });
      marker.addTo(_boatLayer);

      // Course line
      var end = courseLineEnd(b.lat, b.lon, b.course);
      var color = b.speed > 0 ? (b.color || '#c0392b') : '#7f8c8d';
      var line = L.polyline([[b.lat, b.lon], end], {
        color: color,
        weight: 2,
        opacity: 0.8,
        dashArray: '6,6',
      });
      line.addTo(_boatLayer);

      _markerPool[b.boatId] = { marker: marker, line: line };
    }
  });

  // Remove markers for boats no longer in the data
  Object.keys(_markerPool).forEach(function (id) {
    if (!seenIds[id]) {
      _boatLayer.removeLayer(_markerPool[id].marker);
      _boatLayer.removeLayer(_markerPool[id].line);
      delete _markerPool[id];
    }
  });

  // Fit bounds
  if (fitBounds && boats.length) {
    var markers = [];
    Object.keys(_markerPool).forEach(function (id) {
      markers.push(_markerPool[id].marker);
    });
    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15));
    }
  }
}

/**
 * Render boats using the marker pool. No teardown — markers move smoothly.
 * @param {L.Map} map
 * @param {Array} boats
 * @param {Object} [opts]  – passed to updateBoats
 */
function renderBoats(map, boats, opts) {
  updateBoats(map, boats, opts || { fitBounds: true });
}

/**
 * Remove all boat markers and course lines from the map.
 */
function clearBoats() {
  if (_boatLayer) {
    _boatLayer.clearLayers();
    _boatLayer.remove();
    _boatLayer = null;
  }
  _markerPool = {};
  clearTrackLines();
}

/**
 * Simplify track data using time-bucket decimation.
 * @param {Array} locations – Array of Location objects with timestamp
 * @param {number} intervalMs – Time interval in milliseconds (e.g., 600000 for 10 min)
 * @returns {Array} – Simplified array of locations
 */
function simplifyTrackByTime(locations, intervalMs) {
  if (!locations || locations.length < 2) {
    return locations;
  }

  // Sort by timestamp to ensure chronological order
  var sortedPoints = locations.slice().sort(function (a, b) {
    var timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    var timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeA - timeB;
  });

  var firstTime = new Date(sortedPoints[0].timestamp).getTime();
  var lastTime = new Date(sortedPoints[sortedPoints.length - 1].timestamp).getTime();

  // Build time buckets and find closest point to each boundary
  var buckets = {}; // bucket number -> closest point

  sortedPoints.forEach(function (point) {
    if (!point.timestamp) return;

    var pointTime = new Date(point.timestamp).getTime();
    var bucketNum = Math.floor((pointTime - firstTime) / intervalMs);
    var bucketBoundary = firstTime + (bucketNum * intervalMs);

    // Keep point if it's the first in this bucket or closer to boundary than existing
    if (!buckets[bucketNum]) {
      buckets[bucketNum] = point;
    } else {
      var existing = buckets[bucketNum];
      var existingTime = new Date(existing.timestamp).getTime();
      var existingDist = Math.abs(existingTime - bucketBoundary);
      var newDist = Math.abs(pointTime - bucketBoundary);

      if (newDist < existingDist) {
        buckets[bucketNum] = point;
      }
    }
  });

  // Convert to sorted array
  var simplified = Object.keys(buckets)
    .map(function (key) { return buckets[key]; })
    .sort(function (a, b) {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

  return simplified;
}

/**
 * Draw historical track polylines on the map.
 * @param {L.Map} map
 * @param {Object} tracks  – { boatId: Location[] }  (ascending by timestamp)
 * @param {Array} boats    – Boat configuration objects with enabledSources
 * @param {boolean} [simplified=false] – Whether to draw simplified tracks
 */
function drawTrackLines(map, tracks, boats, simplified) {
  clearTrackLines();
  _trackLayer = L.layerGroup().addTo(map);

  // Store full tracks for later use
  _fullTracks = tracks;
  _isSimplifiedMode = !!simplified;

  var FALLBACK_COLORS = ['#2196F3', '#FF9800', '#4CAF50', '#9C27B0', '#F44336', '#00BCD4'];
  var colorIdx = 0;

  // Build map of boatId -> enabledSources for quick lookup
  var boatSourcesMap = {};
  if (boats) {
    boats.forEach(function (b) {
      boatSourcesMap[b.boatId] = b.enabledSources || ['phone', 'at4', 'gpx', 'nmea-file'];
    });
  }

  Object.keys(tracks).forEach(function (boatId) {
    var points = tracks[boatId];
    if (points.length < 2) return;

    // Filter points by enabled sources if boat configuration is available
    var enabledSources = boatSourcesMap[boatId];
    if (enabledSources) {
      points = points.filter(function (p) {
        return p.source && enabledSources.indexOf(p.source) !== -1;
      });
    }

    // Skip if filtering removed too many points
    if (points.length < 2) return;

    // Apply simplification if requested (10-minute intervals)
    if (simplified) {
      var TEN_MINUTES_MS = 10 * 60 * 1000;
      points = simplifyTrackByTime(points, TEN_MINUTES_MS);
      if (points.length < 2) return;
    }

    var latlngs = points.map(function (p) { return [p.lat, p.lon]; });
    // Use the boat's stored color if available, otherwise fall back to palette
    var color = (points[0] && points[0].color) || FALLBACK_COLORS[colorIdx % FALLBACK_COLORS.length];
    colorIdx++;

    L.polyline(latlngs, {
      color: color,
      weight: 3,
      opacity: 0.6,
    }).addTo(_trackLayer);
  });
}

/**
 * Remove historical track polylines.
 */
function clearTrackLines() {
  if (_trackLayer) {
    _trackLayer.clearLayers();
    _trackLayer.remove();
    _trackLayer = null;
  }
}

/**
 * Get the simplified mode state.
 * @returns {boolean}
 */
function isSimplifiedMode() {
  return _isSimplifiedMode;
}

/**
 * Set the simplified mode state.
 * @param {boolean} value
 */
function setSimplifiedMode(value) {
  _isSimplifiedMode = value;
}

/**
 * Get the full tracks data.
 * @returns {Object|null}
 */
function getFullTracks() {
  return _fullTracks;
}

/**
 * Initialize an empty track layer for progressive drawing.
 * @param {L.Map} map
 */
function initTrackLayerForProgressive(map) {
  if (!_trackLayer) {
    _trackLayer = L.layerGroup().addTo(map);
  }
}

/**
 * Add a progressive path segment to the track layer.
 * @param {Array} latlngs - Array of [lat, lon] coordinates
 * @param {Object} style - Polyline style options
 * @returns {L.Polyline} - The created polyline
 */
function addProgressivePathSegment(latlngs, style) {
  if (!_trackLayer) {
    return null;
  }

  var polyline = L.polyline(latlngs, style);
  polyline.addTo(_trackLayer);
  return polyline;
}
