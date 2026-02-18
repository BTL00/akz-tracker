/* ===== nmea-client.js – NMEA TCP client relay module ===== */

var NMEAClient = (function () {
  'use strict';

  // Configuration
  var RECONNECT_DELAY_MIN = 1000;    // 1 second
  var RECONNECT_DELAY_MAX = 30000;   // 30 seconds
  var RELAY_INTERVAL = 2000;         // Send buffered data every 2 seconds
  var MAX_BUFFER_SIZE = 100;         // Max sentences to buffer

  // Connection state
  var _socket = null;
  var _connected = false;
  var _reconnectAttempts = 0;
  var _reconnectTimer = null;
  var _relayTimer = null;
  var _enabled = false;

  // Configuration
  var _host = '';
  var _port = 10110;
  var _boatId = '';
  var _pin = '';
  var _useWebSocket = false; // Use WebSocket or TCP

  // Data buffer
  var _sentenceBuffer = [];
  
  // Callbacks
  var _onStatusChange = null;

  /**
   * Configure NMEA client connection.
   * @param {Object} cfg - { host, port, boatId, pin, onStatusChange }
   */
  function configure(cfg) {
    _host = cfg.host || '';
    _port = cfg.port || 10110;
    _boatId = cfg.boatId || '';
    _pin = cfg.pin || '';
    _onStatusChange = cfg.onStatusChange || null;
    
    // Detect if we should use WebSocket (ws:// or wss://) or TCP
    _useWebSocket = _host.startsWith('ws://') || _host.startsWith('wss://');
  }

  /**
   * Start NMEA client connection.
   * @returns {boolean} true if started
   */
  function start() {
    if (_enabled) return true;
    if (!_host || !_boatId || !_pin) {
      notifyStatus('error', 'Missing configuration');
      return false;
    }

    _enabled = true;
    _reconnectAttempts = 0;
    connect();
    
    // Start relay timer
    if (!_relayTimer) {
      _relayTimer = setInterval(relayBufferedData, RELAY_INTERVAL);
    }
    
    return true;
  }

  /**
   * Stop NMEA client connection.
   */
  function stop() {
    _enabled = false;
    
    if (_socket) {
      try {
        _socket.close();
      } catch (e) {
        // Ignore
      }
      _socket = null;
    }
    
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
    
    if (_relayTimer) {
      clearInterval(_relayTimer);
      _relayTimer = null;
    }
    
    _connected = false;
    _sentenceBuffer = [];
    _reconnectAttempts = 0;
    notifyStatus('disconnected', 'Disconnected');
  }

  /**
   * Check if client is connected.
   * @returns {boolean}
   */
  function isConnected() {
    return _connected;
  }

  /**
   * Check if client is enabled.
   * @returns {boolean}
   */
  function isEnabled() {
    return _enabled;
  }

  // ---------- Internal methods ----------

  function connect() {
    if (!_enabled) return;

    notifyStatus('connecting', 'Connecting to NMEA server...');

    try {
      if (_useWebSocket) {
        // WebSocket connection (for NMEA servers with WebSocket support)
        var wsUrl = _host + ':' + _port;
        _socket = new WebSocket(wsUrl);
        
        _socket.onopen = function () {
          _connected = true;
          _reconnectAttempts = 0;
          notifyStatus('connected', 'Connected to NMEA server');
        };
        
        _socket.onmessage = function (event) {
          handleData(event.data);
        };
        
        _socket.onerror = function (err) {
          console.error('NMEA WebSocket error:', err);
          notifyStatus('error', 'Connection error');
        };
        
        _socket.onclose = function () {
          _connected = false;
          _socket = null;
          notifyStatus('disconnected', 'Connection closed');
          scheduleReconnect();
        };
      } else {
        // TCP connection via WebSocket proxy not supported
        // Since direct TCP is not available in browsers, we provide clear feedback
        notifyStatus('error', 'Direct TCP connections not supported in browsers. Use NMEA server with WebSocket support or a proxy.');
        _enabled = false;
        return;
      }
    } catch (err) {
      console.error('NMEA connection error:', err);
      notifyStatus('error', 'Failed to connect: ' + err.message);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!_enabled) return;
    
    _reconnectAttempts++;
    
    // Exponential backoff with max delay
    var delay = Math.min(
      RECONNECT_DELAY_MIN * Math.pow(2, _reconnectAttempts - 1),
      RECONNECT_DELAY_MAX
    );
    
    notifyStatus('reconnecting', 'Reconnecting in ' + Math.round(delay / 1000) + 's... (attempt ' + _reconnectAttempts + ')');
    
    _reconnectTimer = setTimeout(function () {
      _reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleData(data) {
    // Data is typically NMEA sentences separated by newlines
    var lines = data.split(/\r?\n/);
    
    lines.forEach(function (line) {
      line = line.trim();
      if (line && (line.startsWith('$') || line.startsWith('!'))) {
        // Valid NMEA sentence
        if (_sentenceBuffer.length >= MAX_BUFFER_SIZE) {
          console.warn('NMEA buffer full, dropping oldest sentence');
          _sentenceBuffer.shift(); // Remove oldest
        }
        _sentenceBuffer.push(line);
      }
    });
  }

  function relayBufferedData() {
    if (!_enabled || _sentenceBuffer.length === 0) return;
    
    var sentences = _sentenceBuffer.splice(0, _sentenceBuffer.length);
    
    // Send to backend
    fetch('/api/nmea/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sentences: sentences,
        boatId: _boatId,
        pin: _pin,
      }),
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Relay failed: ' + response.statusText);
        }
        return response.json();
      })
      .then(function (data) {
        // Successfully relayed
        if (data.positionsSaved > 0) {
          notifyStatus('relaying', 'Relaying data (' + data.positionsSaved + ' positions saved)');
        }
      })
      .catch(function (err) {
        console.error('Failed to relay NMEA data:', err);
        // Don't notify on every relay failure to avoid spam
      });
  }

  function notifyStatus(status, message) {
    if (_onStatusChange) {
      _onStatusChange(status, message);
    }
  }

  // ---------- Public API ----------
  return {
    configure: configure,
    start: start,
    stop: stop,
    isConnected: isConnected,
    isEnabled: isEnabled,
  };
})();
