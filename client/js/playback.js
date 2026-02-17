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
  var _speed      = 50;     // multiplier (matches HTML default)
  var _lastFrame  = 0;      // performance.now() of last rAF tick
  var _rafId      = null;

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
   * @param {number} s – e.g. 1, 2, 5, 10, 50
   */
  function setSpeed(s) {
    _speed = s;
  }

  /**
   * The requestAnimationFrame tick.
   */
  function tick(now) {
    if (!_playing) return;

    var dt = (now - _lastFrame) * _speed; // ms of virtual time
    _lastFrame = now;
    _currentTime += dt;

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
    destroy:   destroy,
    isPlaying: function () { return _playing; },
    getSpeed:  function () { return _speed; },
    getCurrentTime: function () { return _currentTime; },
  };
})();
