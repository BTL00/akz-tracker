# AT4 GPS Tracker Configuration Guide

This guide explains how to configure and use AT4 GPS trackers (Concox protocol) with the AKZ Tracker system.

## Overview

The AT4 GPS tracker uses a binary GPRS protocol to send location data over TCP/IP. The tracker connects to a configured server and periodically sends location updates.

## Prerequisites

- AT4 GPS tracker device
- Active SIM card with GPRS/data plan
- APN configured on the device
- Server with a public IP address (or port forwarding configured)

## Server Configuration

### 1. Enable AT4 Support

Edit your `.env` file and enable AT4 support:

```bash
AT4_TCP_ENABLED=true
AT4_TCP_PORT=15110
```

The default port is 15110, but you can use any port in the range 15110-15129 for different boats.

### 2. Restart the Server

Restart the AKZ Tracker server to apply the configuration:

```bash
docker compose restart
```

## Boat Configuration

### 1. Create or Update a Boat

When creating a boat via the API, specify the `at4TcpPort` and store the device IMEI in the `mmsi` field:

```bash
curl -X POST http://your-server.com/api/boats \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "boatId": "my-boat-1",
    "name": "My Boat",
    "color": "#FF5733",
    "mmsi": "123456789012345",
    "at4TcpPort": 15110
  }'
```

**Important:** The `mmsi` field should contain the 15-digit IMEI of your AT4 device. This is used to authenticate the device when it connects.

### 2. Note the Credentials

The API will return a `pin` and `apiKey`. Save these for device configuration.

## AT4 Device Configuration

### Configure Server Settings via SMS

Send SMS commands to your AT4 device to configure the server connection:

1. **Set APN** (replace with your carrier's APN):
   ```
   APN,your-carrier-apn#
   ```

2. **Set Server IP and Port**:
   ```
   SERVER,1,your-server-ip,15110,0#
   ```
   
   Replace:
   - `your-server-ip` with your server's public IP address
   - `15110` with your configured AT4_TCP_PORT

3. **Set Upload Interval** (optional, in seconds):
   ```
   TIMER,60#
   ```
   This sets the device to send updates every 60 seconds.

4. **Reset Device** (to apply settings):
   ```
   RESET#
   ```

### Example Configuration

For a server at IP `203.0.113.10` with the default port:

```
APN,internet#
SERVER,1,203.0.113.10,15110,0#
TIMER,30#
RESET#
```

## Protocol Details

### Supported Packet Types

The system supports the following AT4 protocol packets:

1. **Login Packet (0x01)**
   - Sent when device first connects
   - Contains device IMEI
   - Server responds with acknowledgment

2. **Location Packet (0x22)**
   - Contains GPS coordinates, speed, course
   - Timestamp and cellular network info
   - Server responds with acknowledgment

### Data Flow

1. Device connects to server via TCP
2. Device sends login packet with IMEI
3. Server validates IMEI against boat configuration
4. Device sends periodic location updates
5. Server stores locations and broadcasts to WebSocket clients

## Troubleshooting

### Device Won't Connect

1. Verify the device has network connectivity:
   - Send `STATUS#` SMS to check device status
   - Check that SIM card has data plan active

2. Verify server configuration:
   - Check `AT4_TCP_ENABLED=true` in `.env`
   - Verify port is open in firewall
   - Test with: `nc -l 15110` (should accept connections)

3. Check server logs:
   ```bash
   docker compose logs -f server
   ```
   Look for "AT4 client connected" messages

### Location Updates Not Appearing

1. Verify IMEI is correctly configured:
   - Check boat's `mmsi` field matches device IMEI
   - IMEI should be 15 digits

2. Check device GPS status:
   - Send `WHERE#` SMS to get current location
   - Device needs clear view of sky for GPS lock

3. Review server logs for errors:
   ```bash
   docker compose logs -f server | grep AT4
   ```

### Testing Without Physical Device

Use the integration test script to simulate an AT4 device:

```bash
# Start server with AT4 enabled
AT4_TCP_ENABLED=true npm start

# In another terminal, run the test
node /path/to/test-at4-integration.js
```

## Security Notes

- The AT4 protocol does not have built-in encryption
- Use VPN or secure network for production deployments
- Consider using a reverse proxy with TLS termination
- Regularly update device firmware

## Advanced Configuration

### Multiple Boats

You can configure multiple boats with different ports:

```bash
# Boat 1
at4TcpPort: 15110

# Boat 2
at4TcpPort: 15111

# Boat 3
at4TcpPort: 15112
```

Each boat needs its own AT4 device with IMEI configured in the `mmsi` field.

### Custom Upload Intervals

Adjust the upload interval based on your needs:

- Racing: `TIMER,10#` (every 10 seconds)
- Cruising: `TIMER,60#` (every minute)  
- Anchored: `TIMER,300#` (every 5 minutes)

## Support

For issues specific to:
- AT4 device configuration: Consult device manual
- Server configuration: Check server logs and GitHub issues
- Protocol implementation: Review `server/utils/at4.js`

## References

The following external resources were verified as of February 2026:

- [AT4 User Manual](https://www.jimilab.com/wp-content/uploads/2022/09/AT4.pdf)
- [Concox Protocol Documentation](https://www.traccar.org/protocol/5023-gt06/)
- [AKZ Tracker API Documentation](../README.md)

Note: External links may change over time. For the most current protocol details, refer to the implementation in `server/utils/at4.js`.
