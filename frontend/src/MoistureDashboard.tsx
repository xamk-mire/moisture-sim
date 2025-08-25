import React, { useEffect, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
type DeviceStatus = 'ok' | 'fault' | 'offline';
type DeviceConfig = {
  min_threshold: number;
  max_threshold: number;
  evaporation_rate: number;
  irrigation_rate: number;
  noise: number;
  auto_mode: boolean;
  temp_mean_c: number;
  temp_amp_c: number;
  leak_rate: number;
  battery_drain_per_hour: number;
};
type Device = {
  id: string;
  name: string;
  plant_type: string;
  location?: string | null;
  created_at: string;
  updated_at: string;
  status: DeviceStatus;
  battery: number;
  watering: boolean;
  moisture: number;
  config: DeviceConfig;
};
type Reading = {
  timestamp: string;
  device_id: string;
  moisture: number;
  temperature_c: number;
  battery: number;
  watering: boolean;
  status: DeviceStatus;
};
const API_BASE: string = (import.meta as any)?.env?.VITE_SIM_API ?? '/api';
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}
function StatusBadge({ status }: { status: DeviceStatus }) {
  const map: Record<DeviceStatus, string> = {
    ok: 'bg-emerald-100 text-emerald-700',
    fault: 'bg-amber-100 text-amber-700',
    offline: 'bg-rose-100 text-rose-700',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        map[status]
      )}
    >
      {status}
    </span>
  );
}
function SectionCard({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
        <div className="flex gap-2">{actions}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}
async function listDevices(): Promise<Device[]> {
  return api<Device[]>('/devices');
}
async function createDevice(body: any): Promise<Device> {
  return api<Device>('/devices', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
async function updateDevice(id: string, body: any): Promise<Device> {
  return api<Device>(`/devices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
async function deleteDevice(id: string): Promise<void> {
  await api<void>(`/devices/${id}`, { method: 'DELETE' });
}
async function setWatering(id: string, on: boolean): Promise<Device> {
  return api<Device>(`/devices/${id}/water`, {
    method: 'POST',
    body: JSON.stringify({ on }),
  });
}
async function setStatus(id: string, status: DeviceStatus): Promise<Device> {
  return api<Device>(`/devices/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}
async function getHistory(id: string, limit = 120): Promise<Reading[]> {
  return api<Reading[]>(`/devices/${id}/readings?limit=${limit}`);
}
function CreateDeviceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (d: Device) => void;
}) {
  const [name, setName] = useState('');
  const [plantType, setPlantType] = useState('generic');
  const [location, setLocation] = useState('');
  const [initialMoisture, setInitialMoisture] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await createDevice({
        name,
        plant_type: plantType,
        location,
        initial_moisture: initialMoisture,
      });
      onCreated(d);
      setName('');
      setPlantType('generic');
      setLocation('');
      setInitialMoisture(50);
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-base font-semibold">Create Device</h3>
          <button
            className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <form className="space-y-4 p-5" onSubmit={submit}>
          {error && (
            <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">
              {error}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium">Name</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">Plant type</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={plantType}
                onChange={(e) => setPlantType(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Location</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium">
              Initial moisture (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={initialMoisture}
              onChange={(e) => setInitialMoisture(Number(e.target.value))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded-xl border px-4 py-2 hover:bg-zinc-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              disabled={busy}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
function DeviceDrawer({
  device,
  onClose,
  onDeviceUpdate,
}: {
  device: Device | null;
  onClose: () => void;
  onDeviceUpdate: (d: Device) => void;
}) {
  const [history, setHistory] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    async function load() {
      if (!device) return;
      setLoading(true);
      setError(null);
      try {
        const h = await getHistory(device.id, 240);
        if (alive) setHistory(h);
      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [device?.id]);
  if (!device) return null;
  const last = history[history.length - 1];
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-3">
          <div>
            <h3 className="text-lg font-semibold">{device.name}</h3>
            <p className="text-sm text-zinc-500">
              {device.plant_type} · {device.location || '—'}
            </p>
          </div>
          <button
            className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="space-y-5 p-5">
          <SectionCard
            title="Snapshot"
            actions={<StatusBadge status={device.status} />}
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Metric
                label="Moisture"
                value={`${(last?.moisture ?? device.moisture).toFixed(1)}%`}
              />
              <Metric
                label="Temperature"
                value={`${(last?.temperature_c ?? 0).toFixed(1)} °C`}
              />
              <Metric
                label="Battery"
                value={`${(last?.battery ?? device.battery).toFixed(0)}%`}
              />
              <Metric label="Watering" value={device.watering ? 'ON' : 'OFF'} />
            </div>
          </SectionCard>
          <SectionCard title="Controls">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={clsx(
                  'rounded-xl px-4 py-2 font-semibold text-white',
                  device.watering
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                )}
                onClick={async () => {
                  const updated = await setWatering(
                    device.id,
                    !device.watering
                  );
                  onDeviceUpdate(updated);
                }}
              >
                {device.watering ? 'Stop Watering' : 'Start Watering'}
              </button>
              <select
                className="rounded-xl border px-3 py-2"
                value={device.status}
                onChange={async (e) => {
                  const updated = await setStatus(
                    device.id,
                    e.target.value as DeviceStatus
                  );
                  onDeviceUpdate(updated);
                }}
              >
                <option value="ok">ok</option>
                <option value="fault">fault</option>
                <option value="offline">offline</option>
              </select>
              <button
                className="rounded-xl border px-4 py-2 hover:bg-zinc-50"
                onClick={async () => {
                  const updated = await updateDevice(device.id, {
                    config: {
                      ...device.config,
                      auto_mode: !device.config.auto_mode,
                    },
                  });
                  onDeviceUpdate(updated);
                }}
              >
                {device.config.auto_mode
                  ? 'Disable Auto-Mode'
                  : 'Enable Auto-Mode'}
              </button>
            </div>
          </SectionCard>
          <SectionCard title="Moisture History">
            {loading && (
              <p className="text-sm text-zinc-500">Loading history…</p>
            )}
            {error && (
              <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">
                {error}
              </p>
            )}
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={history.map((r) => ({
                    t: new Date(r.timestamp).toLocaleTimeString(),
                    moisture: r.moisture,
                    temperature: r.temperature_c,
                    battery: r.battery,
                  }))}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={24} />
                  <YAxis yAxisId="left" domain={[0, 100]} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    hide
                  />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="moisture"
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="battery"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
export default function MoistureDashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Device | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const ds = await listDevices();
        if (alive) setDevices(ds);
      } catch (e: any) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    function wsUrlFromApiBase(base: string) {
      if (/^https?:\/\//i.test(base)) {
        return base.replace(/^http/i, 'ws') + '/ws';
      }
      const origin = window.location.origin.replace(/^http/i, 'ws');
      return `${origin}${base}/ws`;
    }
    const url = wsUrlFromApiBase(API_BASE);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === 'readings_batch') {
          const latest: Record<string, Reading> = {};
          (msg.data as Reading[]).forEach((r) => (latest[r.device_id] = r));
          setDevices((prev) =>
            prev.map((d) =>
              latest[d.id]
                ? {
                    ...d,
                    moisture: latest[d.id].moisture,
                    battery: latest[d.id].battery,
                    watering: latest[d.id].watering,
                    status: latest[d.id].status,
                  }
                : d
            )
          );
        }
      } catch {}
    };
    ws.onopen = () => {
      const ping = setInterval(
        () => ws.readyState === ws.OPEN && ws.send('ping'),
        15000
      );
      (ws as any)._ping = ping;
    };
    ws.onclose = () => {
      const ping = (ws as any)._ping;
      if (ping) clearInterval(ping);
    };
    return () => {
      try {
        const ping = (ws as any)._ping;
        if (ping) clearInterval(ping);
        ws.close();
      } catch {}
    };
  }, []);
  function upsertDevice(updated: Device) {
    setDevices((prev) => {
      const i = prev.findIndex((d) => d.id === updated.id);
      if (i === -1) return [updated, ...prev];
      const next = [...prev];
      next[i] = updated;
      return next;
    });
    setSelected((cur) => (cur && cur.id === updated.id ? updated : cur));
  }
  async function removeDevice(d: Device) {
    if (!confirm(`Delete "${d.name}"?`)) return;
    try {
      await deleteDevice(d.id);
      setDevices((prev) => prev.filter((x) => x.id !== d.id));
      if (selected?.id === d.id) setSelected(null);
    } catch (e: any) {
      alert(e.message || String(e));
    }
  }
  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Plant Watering — Device Manager
          </h1>
          <p className="text-sm text-zinc-500">API: {API_BASE}</p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-xl border px-4 py-2 hover:bg-zinc-50"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
          <button
            className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
            onClick={() => setCreateOpen(true)}
          >
            + Create Device
          </button>
        </div>
      </header>
      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>
      )}
      {loading ? (
        <p className="text-zinc-600">Loading devices…</p>
      ) : devices.length === 0 ? (
        <div className="rounded-2xl border p-8 text-center text-zinc-600">
          No devices yet. Create your first one!
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <div
              key={d.id}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <div className="text-base font-semibold text-zinc-800">
                    {d.name}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {d.plant_type} · {d.location || '—'}
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
                <MiniMetric
                  label="Moisture"
                  value={`${d.moisture.toFixed(1)}%`}
                />
                <MiniMetric
                  label="Battery"
                  value={`${d.battery.toFixed(0)}%`}
                />
                <MiniMetric
                  label="Watering"
                  value={d.watering ? 'ON' : 'OFF'}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={clsx(
                    'rounded-xl px-3 py-1.5 text-sm text-white',
                    d.watering
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  )}
                  onClick={async () =>
                    upsertDevice(await setWatering(d.id, !d.watering))
                  }
                >
                  {d.watering ? 'Stop' : 'Water'}
                </button>
                <select
                  className="rounded-xl border px-2 py-1.5 text-sm"
                  value={d.status}
                  onChange={async (e) =>
                    upsertDevice(
                      await setStatus(d.id, e.target.value as DeviceStatus)
                    )
                  }
                >
                  <option value="ok">ok</option>
                  <option value="fault">fault</option>
                  <option value="offline">offline</option>
                </select>
                <button
                  className="rounded-xl border px-3 py-1.5 text-sm hover:bg-zinc-50"
                  onClick={() => setSelected(d)}
                >
                  View
                </button>
                <button
                  className="rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50"
                  onClick={() => removeDevice(d)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <CreateDeviceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(d) => upsertDevice(d)}
      />
      <DeviceDrawer
        device={selected}
        onClose={() => setSelected(null)}
        onDeviceUpdate={(d) => upsertDevice(d)}
      />
    </div>
  );
}
