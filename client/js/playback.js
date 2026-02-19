/* ===== playback.js – expedition playback engine ===== */

var Playback = (function () {
  'use strict';

  var _map        = null;
  var _tracks     = null;   // { boatId: Location[] }
  var _boats      = null;   // Boat configuration objects
  var _startTime  = 0;      // ms
  var _endTime    = 0;      // ms
  var _currentTime = 0;     // ms – virtual playback clock
  var _playing    = false;
  var _speed      = 60;     // multiplier (matches HTML default)
  var _lastFrame  = 0;      // performance.now() of last rAF tick
  var _rafId      = null;

  // Progressive path drawing state
  var _drawnPathSegments = {};  // { boatId: { polylines: [], lastDrawnIndex: 0 } }
  var _progressiveMode = false; // Track if we're in progressive drawing mode

  // Skip-idle feature state
  var _skipIdleEnabled = false;         // toggle for skip-idle feature
  var _idleThreshold = 0.5;             // knots – speed below this is considered idle
  var _idleMinDuration = 2 * 60 * 1000; // 2 minutes in ms
  var _idleSegments = [];               // [{ startTime, endTime }, ...]

  // Callbacks set by app.js
  var _onTimeUpdate = null; // function(currentTime, startTime, endTime)
  var _onFinished   = null; // function()
  var _onRender     = null; // function(boats) – called every frame with interpolated boats

  /**
   * Initialize the playback engine.
   * @param {L.Map} map
   * @param {Object} opts  – { onTimeUpdate, onFinished }
   */
  function init(map, opts) {
    _map = map;
    if (opts) {
      _onTimeUpdate = opts.onTimeUpdate || null;
      _onFinished   = opts.onFinished   || null;
      _onRender     = opts.onRender     || null;
    }
  }

  /**
   * Compute idle segments where all boats are stationary for _idleMinDuration.
   * @param {Object} tracks – { boatId: Location[] }
   * @returns {Array} – [{ startTime, endTime }, ...]
   */
  function computeIdleSegments(tracks) {
    if (!tracks || Object.keys(tracks).length === 0) {
      return [];
    }

    // Get time range
    var timeRange = getTrackTimeRange(tracks);
    var minTime = timeRange.min;
    var maxTime = timeRange.max;

    var idleSegments = [];
    var checkInterval = 10 * 1000; // Check every 10 seconds
    var startIdleTime = null;

    for (var checkTime = minTime; checkTime <= maxTime; checkTime += checkInterval) {
      // Interpolate all boats at this time
      var boats = interpolatePositions(tracks, checkTime);
      var allIdle = boats.length > 0 && boats.every(function (boat) {
        return boat.speed < _idleThreshold;
      });

      if (allIdle) {
        // Start or continue idle period
        if (startIdleTime === null) {
          startIdleTime = checkTime;
        }
      } else {
        // End idle period if duration exceeded
        if (startIdleTime !== null && checkTime - startIdleTime >= _idleMinDuration) {
          idleSegments.push({ startTime: startIdleTime, endTime: checkTime });
        }
        startIdleTime = null;
      }
    }

    // Handle idle period that extends to end of track
    if (startIdleTime !== null && maxTime - startIdleTime >= _idleMinDuration) {
      idleSegments.push({ startTime: startIdleTime, endTime: maxTime });
    }

    return idleSegments;
  }

  /**
   * Get the earliest and latest timestamp across all tracks.
   * Helper function (mirrors expedition.js getTrackTimeRange)
   */
  function getTrackTimeRange(tracks) {
    var min = Infinity;
    var max = -Infinity;

    Object.keys(tracks).forEach(function (boatId) {
      var arr = tracks[boatId];
      if (!arr.length) return;
      var first = new Date(arr[0].timestamp).getTime();
      var last = new Date(arr[arr.length - 1].timestamp).getTime();
      if (first < min) min = first;
      if (last > max) max = last;
    });

    return { min: min, max: max };
  }

  /**
   * Check if current time is within an idle segment and return next non-idle time.
   * @param {number} time – current time in ms
   * @returns {number|null} – time to skip to (null if not in idle segment)
   */
  function getIdleSkipTarget(time) {
    for (var i = 0; i < _idleSegments.length; i++) {
      var segment = _idleSegments[i];
      if (time >= segment.startTime && time < segment.endTime) {
        return segment.endTime;
      }
    }
    return null;
  }

  /**
   * Load track data and configure time bounds.
   * @param {Object} tracks – { boatId: Location[] }
   * @param {number} startTime – ms timestamp
   * @param {number} endTime   – ms timestamp
   * @param {Array} boats – Boat configuration objects (optional)
   */
  function loadTrack(tracks, startTime, endTime, boats) {
    stop();
    _tracks     = tracks;
    _boats      = boats || null;
    _startTime  = startTime;
    _endTime    = endTime;
    _currentTime = startTime;

    // Precompute idle segments for skip-idle feature
    _idleSegments = computeIdleSegments(tracks);

    // Draw simplified track polylines initially
    drawTrackLines(_map, tracks, _boats, true);

    // Show boats at start position
    render();
  }

  /**
   * Start or resume playback.
   */
  function play() {
    if (!_tracks) return;
    if (_currentTime >= _endTime) {
      _currentTime = _startTime; // restart if at end
    }

    // If in simplified mode, switch to progressive rendering
    if (isSimplifiedMode()) {
      clearTrackLines();
      setSimplifiedMode(false);
      _progressiveMode = true;

      // Initialize progressive drawing state for each boat
      _drawnPathSegments = {};
      Object.keys(_tracks).forEach(function (boatId) {
        _drawnPathSegments[boatId] = {
          polylines: [],
          lastDrawnIndex: 0,
        };
      });

      // Initialize empty track layer for progressive drawing
      initTrackLayerForProgressive(_map);
    }

    _playing   = true;
    _lastFrame = performance.now();
    _rafId     = requestAnimationFrame(tick);
  }

  /**
   * Pause playback.
   */
  function pause() {
    _playing = false;
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
  }

  /**
   * Stop playback and reset to start.
   */
  function stop() {
    pause();
    _currentTime = _startTime;

    // Clear progressive paths and restore simplified view
    if (_progressiveMode) {
      clearTrackLines();
      _drawnPathSegments = {};
      _progressiveMode = false;

      // Redraw simplified tracks
      if (_tracks) {
        drawTrackLines(_map, _tracks, _boats, true);
      }
    }

    render();
  }

  /**
   * Jump to a specific time.
   * @param {number} time – ms timestamp
   */
  function seekTo(time) {
    _currentTime = Math.max(_startTime, Math.min(_endTime, time));
    render();
  }

  /**
   * Set playback speed multiplier.
  * @param {number} s – e.g. 1, 10, 60, 240, 480, 1440
   */
  function setSpeed(s) {
    _speed = s;
  }

  /**
   * Enable or disable the skip-idle feature.
   * @param {boolean} enabled
   */
  function setSkipIdle(enabled) {
    _skipIdleEnabled = enabled;
  }

  /**
   * The requestAnimationFrame tick.
   */
  function tick(now) {
    if (!_playing) return;

    var dt = (now - _lastFrame) * _speed; // ms of virtual time
    _lastFrame = now;
    _currentTime += dt;

    // Check if we're entering an idle segment and skip if enabled
    if (_skipIdleEnabled) {
      var skipTarget = getIdleSkipTarget(_currentTime);
      if (skipTarget !== null) {
        _currentTime = skipTarget;
      }
    }

    // Clamp to end
    if (_currentTime >= _endTime) {
      _currentTime = _endTime;
      _playing = false;
      render();
      if (_onFinished) _onFinished();
      return;
    }

    render();
    _rafId = requestAnimationFrame(tick);
  }

  /**
   * Render the current state: interpolate positions and update markers.
   * Also handles progressive path drawing during playback.
   */
  function render() {
    if (!_tracks || !_map) return;

    var boats = interpolatePositions(_tracks, _currentTime);
    updateBoats(_map, boats, { fitBounds: false });

    // Draw progressive path segments if in progressive mode
    if (_progressiveMode) {
      drawProgressivePaths();
    }

    if (_onRender) {
      _onRender(boats);
    }

    if (_onTimeUpdate) {
      _onTimeUpdate(_currentTime, _startTime, _endTime);
    }
  }

  /**
   * Draw path segments progressively behind boats up to current time.
   */
  function drawProgressivePaths() {
    var FALLBACK_COLORS = ['#2196F3', '#FF9800', '#4CAF50', '#9C27B0', '#F44336', '#00BCD4'];
    var colorIdx = 0;

    // Build map of boatId -> enabledSources for filtering
    var boatSourcesMap = {};
    if (_boats) {
      _boats.forEach(function (b) {
        boatSourcesMap[b.boatId] = b.enabledSources || ['phone', 'at4', 'gpx', 'nmea-file'];
      });
    }

    Object.keys(_tracks).forEach(function (boatId) {
      var allPoints = _tracks[boatId];
      if (!allPoints || allPoints.length < 2) return;

      // Filter by enabled sources
      var enabledSources = boatSourcesMap[boatId];
      if (enabledSources) {
        allPoints = allPoints.filter(function (p) {
          return p.source && enabledSources.indexOf(p.source) !== -1;
        });
      }

      if (allPoints.length < 2) return;

      var segmentState = _drawnPathSegments[boatId];
      if (!segmentState) return;

      // Find all points up to current time that haven't been drawn yet
      var pointsToDraw = [];
      for (var i = segmentState.lastDrawnIndex; i < allPoints.length; i++) {
        var point = allPoints[i];
        var pointTime = new Date(point.timestamp).getTime();
        if (pointTime <= _currentTime) {
          pointsToDraw.push(point);
          segmentState.lastDrawnIndex = i + 1;
        } else {
          break;
        }
      }

      // Draw new points in batches of ~50-100 for performance
      if (pointsToDraw.length > 0) {
        var BATCH_SIZE = 75;
        var color = (allPoints[0] && allPoints[0].color) || FALLBACK_COLORS[colorIdx % FALLBACK_COLORS.length];

        for (var j = 0; j < pointsToDraw.length; j += BATCH_SIZE) {
          var batch = pointsToDraw.slice(j, j + BATCH_SIZE);
          if (batch.length > 0) {
            var latlngs = batch.map(function (p) { return [p.lat, p.lon]; });
            var polyline = addProgressivePathSegment(latlngs, {
              color: color,
              weight: 3,
              opacity: 0.6,
            });

            if (polyline) {
              segmentState.polylines.push(polyline);
            }
          }
        }
      }

      colorIdx++;
    });
  }

  /**
   * Clean up: stop playback, remove tracks.
   */
  function destroy() {
    stop();
    _tracks = null;
    _boats = null;
    _idleSegments = [];
    _drawnPathSegments = {};
    _progressiveMode = false;
    clearTrackLines();
  }

  // ---------- Public API ----------
  return {
    init:      init,
    loadTrack: loadTrack,
    play:      play,
    pause:     pause,
    stop:      stop,
    seekTo:    seekTo,
    setSpeed:  setSpeed,
    setSkipIdle: setSkipIdle,
    destroy:   destroy,
    isPlaying: function () { return _playing; },
    getSpeed:  function () { return _speed; },
    getCurrentTime: function () { return _currentTime; },
  };
})();
