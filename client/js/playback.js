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

    // Draw track polylines with boat configurations for filtering
    drawTrackLines(_map, tracks, _boats);

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
   */
  function render() {
    if (!_tracks || !_map) return;

    var boats = interpolatePositions(_tracks, _currentTime);
    updateBoats(_map, boats, { fitBounds: false });

    if (_onRender) {
      _onRender(boats);
    }

    if (_onTimeUpdate) {
      _onTimeUpdate(_currentTime, _startTime, _endTime);
    }
  }

  /**
   * Clean up: stop playback, remove tracks.
   */
  function destroy() {
    stop();
    _tracks = null;
    _boats = null;
    _idleSegments = [];
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
