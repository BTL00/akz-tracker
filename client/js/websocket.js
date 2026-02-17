/* ===== WebSocket Client – Real-time location updates ===== */

let ws = null;
let reconnectAttempts = 0;
let autoReconnect = true; // Flag to control reconnection behavior
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds

// Callback for when location updates are received
let onLocationUpdateCallback = null;

function initWebSocket() {
  // Determine WebSocket URL based on current location
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/ws`;

  console.log('Connecting to WebSocket:', wsUrl);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    reconnectAttempts = 0;
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'connected':
          console.log('WebSocket:', message.message);
          break;
          
        case 'location-update':
          if (onLocationUpdateCallback) {
            onLocationUpdateCallback(message.data);
          }
          break;
          
        default:
          console.log('Unknown WebSocket message type:', message.type);
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    ws = null;
    
    // Attempt to reconnect only if autoReconnect is enabled
    if (autoReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`Reconnecting... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(initWebSocket, RECONNECT_DELAY);
    } else if (!autoReconnect) {
      console.log('Auto-reconnect disabled. WebSocket will not reconnect.');
    } else {
      console.error('Max reconnection attempts reached. Falling back to polling.');
    }
  };
}

function setLocationUpdateCallback(callback) {
  onLocationUpdateCallback = callback;
}

function closeWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

function connectWebSocket() {
  autoReconnect = true;
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    reconnectAttempts = 0;
    initWebSocket();
  }
}

function disconnectWebSocket() {
  autoReconnect = false;
  if (ws) {
    ws.close();
    ws = null;
  }
}

function isWebSocketConnected() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// Auto-initialize when module loads
initWebSocket();

// Export functions
window.wsClient = {
  connect: connectWebSocket,
  disconnect: disconnectWebSocket,
  setLocationUpdateCallback,
  isConnected: isWebSocketConnected,
};
