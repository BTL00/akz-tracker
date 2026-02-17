/* ===== tracker.js – phone GPS tracking module ===== */

var Tracker = (function () {
  'use strict';

  var POST_INTERVAL = 10000; // ms – send position every 10 s
  var API_BASE      = '';    // same origin

  var _watchId    = null;   // geolocation.watchPosition id
  var _intervalId = null;   // setInterval id for POST loop
  var _tracking   = false;
  var _wakeLock   = null;   // Screen Wake Lock sentinel
  var _onVisibilityChange = null; // bound handler ref

  // Identity
  var _boatId  = '';
  var _name    = '';
  var _color   = '#e74c3c';
  var _pin     = '';
  var _apiKey  = '';

  // Latest position data
  var _lat     = null;
  var _lon     = null;
  var _course  = 0;
  var _speed   = 0;        // knots
  var _prevLat = null;
  var _prevLon = null;

  /**
   * Configure tracker identity.
   * @param {Object} cfg – { boatId, name, color, pin, apiKey }
   */
  function configure(cfg) {
    _boatId = cfg.boatId || '';
    _name   = cfg.name   || '';
    _color  = cfg.color  || '#e74c3c';
    _pin    = cfg.pin    || '';
    _apiKey = cfg.apiKey  || '';
  }

  /**
   * Start GPS tracking and periodic POST.
   * @returns {boolean} true if started, false if geolocation unavailable
   */
  function start() {
    if (_tracking) return true;
    if (!navigator.geolocation) return false;

    _tracking = true;

    _watchId = navigator.geolocation.watchPosition(
      onPosition,
      onError,
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );

    // Immediately post when we get first position, then every POST_INTERVAL
    _intervalId = setInterval(postPosition, POST_INTERVAL);

    // Request wake lock to keep the screen on
    requestWakeLock();

    // Re-acquire wake lock when the tab becomes visible again
    _onVisibilityChange = function () {
      if (document.visibilityState === 'visible' && _tracking) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', _onVisibilityChange);

    return true;
  }

  /**
   * Stop GPS tracking.
   */
  function stop() {
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
    }
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    _tracking = false;
    _lat = null;
    _lon = null;

    // Release wake lock
    releaseWakeLock();

    // Remove visibility listener
    if (_onVisibilityChange) {
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      _onVisibilityChange = null;
    }
  }

  /**
   * @returns {boolean}
   */
  function isTracking() {
    return _tracking;
  }

  /**
   * @returns {boolean} true if the Screen Wake Lock API is supported
   */
  function hasWakeLock() {
    return 'wakeLock' in navigator;
  }

  // ---------- Internals ----------

  function onPosition(pos) {
    _prevLat = _lat;
    _prevLon = _lon;

    _lat = pos.coords.latitude;
    _lon = pos.coords.longitude;

    // Course: prefer device heading, fall back to computed bearing
    if (pos.coords.heading != null && !isNaN(pos.coords.heading) && pos.coords.heading >= 0) {
      _course = Math.round(pos.coords.heading);
    } else if (_prevLat != null && _prevLon != null) {
      _course = computeBearing(_prevLat, _prevLon, _lat, _lon);
    }

    // Speed: coords.speed is m/s → convert to knots (1 m/s = 1.94384 kn)
    if (pos.coords.speed != null && pos.coords.speed >= 0) {
      _speed = Math.round(pos.coords.speed * 1.94384 * 10) / 10;
    } else {
      _speed = 0;
    }

    // Post immediately on first fix
    if (_prevLat === null) {
      postPosition();
    }
  }

  function onError(err) {
    console.warn('Geolocation error:', err.message);
  }

  function postPosition() {
    if (_lat === null || _lon === null) return;

    var body = {
      boatId: _boatId,
      name:   _name,
      color:  _color,
      pin:    _pin,
      lat:    _lat,
      lon:    _lon,
      course: _course,
      speed:  _speed,
      status: 'Under way',
      source: 'phone',
    };

    var headers = {
      'Content-Type': 'application/json',
    };
    if (_apiKey) {
      headers['x-api-key'] = _apiKey;
    }

    fetch(API_BASE + '/api/location', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    }).catch(function (err) {
      console.warn('Tracker POST failed:', err);
    });
  }

  /**
   * Compute bearing in degrees from (lat1,lon1) → (lat2,lon2).
   */
  function computeBearing(lat1, lon1, lat2, lon2) {
    var toRad = Math.PI / 180;
    var dLon  = (lon2 - lon1) * toRad;
    var y     = Math.sin(dLon) * Math.cos(lat2 * toRad);
    var x     = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
                Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
    var brng  = Math.atan2(y, x) * (180 / Math.PI);
    return Math.round((brng + 360) % 360);
  }

  /**
   * Request a screen wake lock to prevent the device from sleeping.
   */
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen')
      .then(function (sentinel) {
        _wakeLock = sentinel;
        _wakeLock.addEventListener('release', function () {
          _wakeLock = null;
        });
      })
      .catch(function (err) {
        console.warn('Wake Lock request failed:', err.message);
      });
  }

  /**
   * Release the screen wake lock if held.
   */
  function releaseWakeLock() {
    if (_wakeLock) {
      _wakeLock.release().catch(function () {});
      _wakeLock = null;
    }
  }

  // ---------- Public API ----------
  return {
    configure:   configure,
    start:       start,
    stop:        stop,
    isTracking:  isTracking,
    hasWakeLock: hasWakeLock,
  };
})();
