#!/usr/bin/env python3
"""
Mock Moisture Sensor Microcontroller Simulator (FastAPI)
"""
from __future__ import annotations

import asyncio
import random
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Deque, Dict, List, Optional, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict
import os, math, uuid

TICK_SECONDS: float = float(os.getenv("TICK_SECONDS", "1.0"))
MAX_HISTORY: int = int(os.getenv("MAX_HISTORY", "2000"))
DEFAULT_ORIGINS = os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if os.getenv("CORS_ALLOW_ORIGINS") else ["*"]

class DeviceStatus(str):
    OK = "ok"
    FAULT = "fault"
    OFFLINE = "offline"

# Base model for device configuration
class DeviceConfig(BaseModel):
    # Dictionary of device configuration parameters (used for additional parameters)
    model_config = ConfigDict(extra="ignore")
    # Minimum threshold for moisture level (0-100%)
    min_threshold: float = Field(25.0, ge=0.0, le=100.0)
    # Maximum threshold for moisture level (0-100%)
    max_threshold: float = Field(60.0, ge=0.0, le=100.0)
    # Evaporation rate (0-5%)
    evaporation_rate: float = Field(0.015, ge=0.0, le=5.0)
    # Irrigation rate (0-5%)
    irrigation_rate: float = Field(0.25, ge=0.0, le=5.0)
    # Noise level (0-10%)
    noise: float = Field(0.35, ge=0.0, le=10.0)
    # Automatic mode (True/False)
    auto_mode: bool = Field(False)
    # Mean temperature (°C)
    temp_mean_c: float = Field(22.0)
    # Amplitude of temperature variation (°C)
    temp_amp_c: float = Field(4.0, ge=0.0)
    # Leak rate (0-2%)
    leak_rate: float = Field(0.0, ge=0.0, le=2.0)
    # Battery drain per hour (0-10%)
    battery_drain_per_hour: float = Field(0.2, ge=0.0, le=10.0)

# Base model for device creation
class DeviceCreate(BaseModel):
    # Device name (required, 1-120 characters)
    name: str = Field(..., min_length=1, max_length=120)
    # Plant type (default: "generic", 1-80 characters)
    plant_type: str = Field("generic", max_length=80)
    # Location (optional, 1-120 characters)
    location: Optional[str] = Field(None, max_length=120)
    # Initial moisture level (0-100%)
    initial_moisture: float = Field(50.0, ge=0.0, le=100.0)
    # Battery level (0-100%)
    battery: float = Field(100.0, ge=0.0, le=100.0)
    # Device configuration (optional)
    config: Optional[DeviceConfig] = None

# Base model for device update
class DeviceUpdate(BaseModel):
    # Device name (optional, 1-120 characters)
    name: Optional[str] = Field(None, max_length=120)
    # Plant type (optional, 1-80 characters)
    plant_type: Optional[str] = Field(None, max_length=80)
    # Location (optional, 1-120 characters)
    location: Optional[str] = Field(None, max_length=120)
    # Device configuration (optional)
    config: Optional[DeviceConfig] = None

# Base model for reading data
class Reading(BaseModel):
    timestamp: datetime
    device_id: str
    moisture: float
    temperature_c: float
    battery: float
    watering: bool
    status: str

# Base model for device
class Device(BaseModel):
    id: str
    name: str
    plant_type: str
    location: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    status: str = Field(DeviceStatus.OK)
    battery: float = Field(100.0, ge=0.0, le=100.0)
    watering: bool = False
    moisture: float = Field(50.0, ge=0.0, le=100.0)
    config: DeviceConfig
    model_config = ConfigDict(extra="ignore")

# Internal device state
@dataclass
class _DeviceState:
    device: Device
    history: Deque[Reading]

# Helper function to clamp values between a minimum and maximum
def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

# Helper function to calculate daily temperature based on mean and amplitude
def _daily_temp(ts: datetime, mean: float = 22.0, amp: float = 4.0) -> float:
    seconds = ts.hour * 3600 + ts.minute * 60 + ts.second
    phase = (2 * math.pi * seconds) / (24 * 3600)
    return mean + amp * math.sin(phase - math.pi / 2)

# Helper function to calculate heat factor based on temperature
def _heat_factor(ts: datetime, cfg: DeviceConfig) -> float:
    temp = _daily_temp(ts, cfg.temp_mean_c, cfg.temp_amp_c)
    return max(0.0, min(0.3, (temp - cfg.temp_mean_c) / 10.0))

# Device store class
class DeviceStore:
    def __init__(self) -> None:
        self._devices: Dict[str, _DeviceState] = {}
        self._lock = asyncio.Lock()
        self._ws_clients: Set[WebSocket] = set()
        self._stop = asyncio.Event()
        self._task: Optional[asyncio.Task] = None

    # Create a new device
    async def create(self, payload: DeviceCreate) -> Device:
        async with self._lock:
            device_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc)
            cfg = payload.config or DeviceConfig()
            device = Device(
                id=device_id,
                name=payload.name,
                plant_type=payload.plant_type,
                location=payload.location,
                created_at=now,
                updated_at=now,
                status=DeviceStatus.OK,
                battery=payload.battery,
                watering=False,
                moisture=payload.initial_moisture,
                config=cfg,
            )
            self._devices[device_id] = _DeviceState(device=device, history=deque(maxlen=MAX_HISTORY))
            self._append_reading_unlocked(device)
            return device

    # List all devices
    async def list(self) -> List[Device]:
        async with self._lock:
            return [s.device for s in self._devices.values()]

    # Get a device by ID
    async def get(self, device_id: str) -> Device:
        async with self._lock:
            s = self._devices.get(device_id)
            if not s: raise KeyError
            return s.device

    # Update a device
    async def update(self, device_id: str, payload: DeviceUpdate) -> Device:
        async with self._lock:
            s = self._devices.get(device_id)
            if not s: raise KeyError
            d = s.device
            if payload.name is not None: d.name = payload.name
            if payload.plant_type is not None: d.plant_type = payload.plant_type
            if payload.location is not None: d.location = payload.location
            if payload.config is not None: d.config = payload.config
            d.updated_at = datetime.now(timezone.utc)
            return d

    # Delete a device
    async def delete(self, device_id: str) -> None:
        async with self._lock:
            if device_id in self._devices: self._devices.pop(device_id)
            else: raise KeyError

    # Get device history
    async def history(self, device_id: str, limit: int = 100) -> List[Reading]:
        async with self._lock:
            s = self._devices.get(device_id)
            if not s: raise KeyError
            return list(s.history)[-limit:]

    # Get current reading for a device
    async def current(self, device_id: str) -> Reading:
        async with self._lock:
            s = self._devices.get(device_id)
            if not s: raise KeyError
            return s.history[-1]

    # Set device status
    async def set_status(self, device_id: str, status: str) -> Device:
        async with self._lock:
            s = self._devices.get(device_id)
            if not s: raise KeyError
            if status not in (DeviceStatus.OK, DeviceStatus.FAULT, DeviceStatus.OFFLINE): raise ValueError("invalid status")
            s.device.status = status
            s.device.updated_at = datetime.now(timezone.utc)
            return s.device

    # Set watering state
    async def set_watering(self, device_id: str, on: bool) -> Device:
        async with self._lock:
            s = self._devices.get(device_id)
            if not s: raise KeyError
            if s.device.status == DeviceStatus.OFFLINE: raise RuntimeError("device is offline")
            s.device.watering = on
            s.device.updated_at = datetime.now(timezone.utc)
            return s.device

    # Start the device store loop
    def start(self) -> None:
        if self._task and not self._task.done(): return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop())

    # Stop the device store loop
    async def stop(self) -> None:
        self._stop.set()
        if self._task: await self._task

    # Device store loop
    async def _loop(self) -> None:
        try:
            while not self._stop.is_set():
                await self._tick_all()
                await asyncio.sleep(TICK_SECONDS)
        except asyncio.CancelledError:
            pass

    # Tick all devices
    async def _tick_all(self) -> None:
        readings: List[Reading] = []
        async with self._lock:
            now = datetime.now(timezone.utc)
            for s in self._devices.values():
                d = s.device
                if d.status == DeviceStatus.OFFLINE:
                    d.battery = float(_clamp(d.battery - (d.config.battery_drain_per_hour/3600.0)*TICK_SECONDS*0.05, 0.0, 100.0))
                    d.updated_at = now
                    readings.append(self._append_reading_unlocked(d))
                    continue
                if d.status == DeviceStatus.FAULT:
                    d.moisture = float(_clamp(d.moisture + random.choice([-1,1])*random.uniform(0,4), 0.0, 100.0))
                if d.watering:
                    d.moisture = float(_clamp(d.moisture + d.config.irrigation_rate*TICK_SECONDS, 0.0, 100.0))
                else:
                    dry_rate = (d.config.evaporation_rate + d.config.leak_rate) * (1.0 + _heat_factor(now, d.config))
                    d.moisture = float(_clamp(d.moisture - dry_rate*TICK_SECONDS, 0.0, 100.0))

                # Auto mode: if moisture is below min threshold, turn on watering
                # If moisture is above max threshold, turn off watering
                if d.config.auto_mode and d.status == DeviceStatus.OK:
                    if d.moisture < d.config.min_threshold: d.watering = True
                    elif d.moisture >= d.config.max_threshold: d.watering = False
                d.battery = float(_clamp(d.battery - (d.config.battery_drain_per_hour/3600.0)*TICK_SECONDS, 0.0, 100.0))
                d.updated_at = now
                readings.append(self._append_reading_unlocked(d))
        await self._broadcast(readings)

    def _append_reading_unlocked(self, device: Device) -> Reading:
        temp = _daily_temp(datetime.now(timezone.utc), mean=device.config.temp_mean_c, amp=device.config.temp_amp_c)
        r = Reading(
            timestamp=datetime.now(timezone.utc),
            device_id=device.id,
            moisture=round(device.moisture,2),
            temperature_c=round(temp,2),
            battery=round(device.battery,2),
            watering=device.watering,
            status=device.status,
        )
        self._devices[device.id].history.append(r)
        return r

    async def register_ws(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock: self._ws_clients.add(ws)

    async def unregister_ws(self, ws: WebSocket) -> None:
        async with self._lock: self._ws_clients.discard(ws)
        try: await ws.close()
        except Exception: pass

    async def _broadcast(self, readings: List[Reading]) -> None:
        if not readings: return
        payload = [r.model_dump() for r in readings]
        dead = []
        for ws in list(self._ws_clients):
            try: await ws.send_json({"type":"readings_batch","data":payload})
            except Exception: dead.append(ws)
        for ws in dead: await self.unregister_ws(ws)

app = FastAPI(title="Mock Moisture Microcontroller Simulator", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=DEFAULT_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

store = DeviceStore()

@app.on_event("startup")
async def _startup() -> None:
    if not (await store.list()):
        await store.create(DeviceCreate(name="Monstera - Office", plant_type="monstera", location="Office", initial_moisture=58.0))
        await store.create(DeviceCreate(name="Fiddle Leaf Fig", plant_type="ficus", location="Living Room", initial_moisture=42.0, battery=86.0))
        await store.create(DeviceCreate(name="Cactus", plant_type="cactus", location="Kitchen", initial_moisture=22.0, battery=92.0,
                                        config=DeviceConfig(min_threshold=10.0, max_threshold=35.0, evaporation_rate=0.01, irrigation_rate=0.2, noise=0.2)))
    store.start()

@app.on_event("shutdown")
async def _shutdown() -> None:
    await store.stop()

@app.get("/health")
async def health():
    return {"status":"ok","now":datetime.now(timezone.utc).isoformat(),"tick_seconds":TICK_SECONDS}

@app.get("/devices")
async def list_devices(): return await store.list()

@app.post("/devices", status_code=status.HTTP_201_CREATED)
async def create_device(payload: DeviceCreate): return await store.create(payload)

@app.get("/devices/{device_id}")
async def get_device(device_id: str):
    try: return await store.get(device_id)
    except KeyError: raise HTTPException(status_code=404, detail="device not found")

@app.patch("/devices/{device_id}")
async def update_device(device_id: str, payload: DeviceUpdate):
    try: return await store.update(device_id, payload)
    except KeyError: raise HTTPException(status_code=404, detail="device not found")

@app.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(device_id: str):
    try: await store.delete(device_id)
    except KeyError: raise HTTPException(status_code=404, detail="device not found")

class WaterCommand(BaseModel):
    on: bool

@app.post("/devices/{device_id}/water")
async def set_watering(device_id: str, payload: WaterCommand):
    try: return await store.set_watering(device_id, payload.on)
    except KeyError: raise HTTPException(status_code=404, detail="device not found")
    except RuntimeError as e: raise HTTPException(status_code=409, detail=str(e))

class StatusCommand(BaseModel):
    status: str = Field(..., pattern="^(ok|fault|offline)$")

@app.post("/devices/{device_id}/status")
async def set_status(device_id: str, payload: StatusCommand):
    try: return await store.set_status(device_id, payload.status)
    except KeyError: raise HTTPException(status_code=404, detail="device not found")
    except ValueError as e: raise HTTPException(status_code=422, detail=str(e))

@app.get("/devices/{device_id}/reading")
async def current_reading(device_id: str):
    try: return await store.current(device_id)
    except KeyError: raise HTTPException(status_code=404, detail="device not found")

@app.get("/devices/{device_id}/readings")
async def past_readings(device_id: str, limit: int = 100):
    try:
        limit = max(1, min(MAX_HISTORY, limit))
        return await store.history(device_id, limit=limit)
    except KeyError:
        raise HTTPException(status_code=404, detail="device not found")

@app.websocket("/ws")
async def readings_ws(websocket: WebSocket):
    await store.register_ws(websocket)
    try:
        devices = await store.list()
        latest = []
        for d in devices:
            try:
                r = await store.current(d.id)
                latest.append(r.model_dump())
            except Exception:
                pass
        await websocket.send_json({"type":"readings_batch","data":latest})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await store.unregister_ws(websocket)
    except Exception:
        await store.unregister_ws(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("mock_moisture_simulator:app", host="0.0.0.0", port=8001, reload=False)
