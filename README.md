# Plant Watering — Full Stack (FastAPI + React + Nginx + Docker)

## Run

```bash
docker compose up -d --build
# open http://localhost:8080
```

- Frontend served at `http://localhost:8080`
- API proxied at `/api/*` (and WebSocket at `/api/ws`)

## Notes

- Adjust simulation speed via `.env` (`TICK_SECONDS`).
- If you bypass proxy and call the API directly from another origin, set `CORS_ALLOW_ORIGINS` in `.env`.
- Verify proxy: `curl http://localhost:8080/api/health`

## Dev cleanup

```bash
docker compose down -v
```

# Mock Moisture Sensor Microcontroller Simulator — API Documentation

FastAPI app that simulates plant moisture sensors and watering behavior.

- Base URL (when using Docker Compose proxy): `http://localhost:8080/api`
- Base URL (direct API, if exposed): `http://localhost:8001`
- Interactive docs (when running): `/docs` (Swagger), `/redoc` (ReDoc)
- WebSocket stream: `ws://<BASE>/ws` (proxied as `ws://localhost:8080/api/ws`)

---

## Quick Start (CURL)

```bash
# Health
curl http://localhost:8080/api/health

# List devices
curl http://localhost:8080/api/devices

# Create device
curl -X POST http://localhost:8080/api/devices -H "Content-Type: application/json" -d '{
  "name": "Aloe Vera",
  "plant_type": "succulent",
  "location": "Bedroom Window",
  "initial_moisture": 45
}'

# Get device
curl http://localhost:8080/api/devices/{device_id}

# Update device (patch name or config)
curl -X PATCH http://localhost:8080/api/devices/{device_id} -H "Content-Type: application/json" -d '{
  "name": "Aloe in Bedroom",
  "config": { "auto_mode": true, "min_threshold": 30, "max_threshold": 55 }
}'

# Toggle watering
curl -X POST http://localhost:8080/api/devices/{device_id}/water -H "Content-Type: application/json" -d '{"on": true}'

# Set status: ok | fault | offline
curl -X POST http://localhost:8080/api/devices/{device_id}/status -H "Content-Type: application/json" -d '{"status": "fault"}'

# Latest reading
curl http://localhost:8080/api/devices/{device_id}/reading

# History
curl "http://localhost:8080/api/devices/{device_id}/readings?limit=200"
```

---

## Endpoints

### `GET /health`

Health/uptime check.

- **200 OK**: `{"status":"ok","now":"2025-08-25T12:00:00Z","tick_seconds":1.0}`

---

### `GET /devices`

List all simulated devices.

- **200 OK** → `[Device]`

### `POST /devices`

Create a new simulated device.

- Request body: **DeviceCreate**
- **201 Created** → **Device**

### `GET /devices/{device_id}`

Return a device by id.

- **200 OK** → **Device**
- **404 Not Found**

### `PATCH /devices/{device_id}`

Update device metadata or config (partial).

- Request body: **DeviceUpdate**
- **200 OK** → **Device**
- **404 Not Found**

### `DELETE /devices/{device_id}`

Delete a device.

- **204 No Content**
- **404 Not Found**

---

### `POST /devices/{device_id}/water`

Turn watering on/off.

- Request body:
  ```json
  { "on": true }
  ```
- **200 OK** → **Device**
- **404 Not Found**
- **409 Conflict** (if device is `offline`)

### `POST /devices/{device_id}/status`

Set status: `"ok" | "fault" | "offline"`.

- Request body:
  ```json
  { "status": "ok" }
  ```
- **200 OK** → **Device**
- **404 Not Found**
- **422 Unprocessable Entity** (invalid status)

---

### `GET /devices/{device_id}/reading`

Most recent reading for a device.

- **200 OK** → **Reading**
- **404 Not Found**

### `GET /devices/{device_id}/readings?limit=n`

Historical readings (newest last).

- Query: `limit` (1..MAX_HISTORY; default 100)
- **200 OK** → `[Reading]`
- **404 Not Found**

---

## WebSocket

### `GET /ws`

Real-time batched readings. On connect, server immediately sends the latest reading for each device:

```json
{
  "type": "readings_batch",
  "data": [ Reading, ... ]
}
```

Then, periodic updates are pushed as batches.

- Proxied URL with Docker: `ws://localhost:8080/api/ws`
- Direct (if exposed): `ws://localhost:8001/ws`

Client ping is optional. This server accepts any text to keep the connection alive.

---

## Data Models

### DeviceStatus

`"ok" | "fault" | "offline"`

### DeviceConfig

```json
{
  "min_threshold": 25.0,
  "max_threshold": 60.0,
  "evaporation_rate": 0.015,
  "irrigation_rate": 0.25,
  "noise": 0.35,
  "auto_mode": false,
  "temp_mean_c": 22.0,
  "temp_amp_c": 4.0,
  "leak_rate": 0.0,
  "battery_drain_per_hour": 0.2
}
```

### Device

```json
{
  "id": "uuid",
  "name": "Monstera - Office",
  "plant_type": "monstera",
  "location": "Office",
  "created_at": "2025-08-25T08:50:00Z",
  "updated_at": "2025-08-25T08:50:00Z",
  "status": "ok",
  "battery": 86.0,
  "watering": false,
  "moisture": 54.2,
  "config": DeviceConfig
}
```

### DeviceCreate

```json
{
  "name": "Aloe Vera",
  "plant_type": "succulent",
  "location": "Bedroom Window",
  "initial_moisture": 45,
  "battery": 100,
  "config": DeviceConfig (optional)
}
```

### DeviceUpdate

```json
{
  "name": "New Name (optional)",
  "plant_type": "optional",
  "location": "optional",
  "config": DeviceConfig (optional)
}
```

### Reading

```json
{
  "timestamp": "2025-08-25T08:55:11.123Z",
  "device_id": "uuid",
  "moisture": 47.6,
  "temperature_c": 23.0,
  "battery": 95.2,
  "watering": false,
  "status": "ok"
}
```

---

## Errors

- **404 Not Found** — device id does not exist
- **409 Conflict** — watering changes requested while device is `offline`
- **422 Unprocessable Entity** — invalid `status` payload for `/status`

Standard FastAPI validation errors return JSON describing mismatched fields.

---

## Environment Variables

- `TICK_SECONDS` (float, default 1.0) — simulation step interval in seconds
- `MAX_HISTORY` (int, default 2000) — per-device readings kept in memory
- `CORS_ALLOW_ORIGINS` (CSV, default `*`) — allowed origins for browsers

When using Docker Compose and the provided Nginx proxy, call the API from the browser via **`/api/...`** to avoid CORS entirely.

---

## Notes on Simulation

- Moisture decreases over time due to evaporation (+ optional leak), increases during watering.
- Noise and fault spikes may perturb readings (zero-mean noise; fault can spike up/down).
- Auto-mode can toggle watering automatically to keep moisture between thresholds.
