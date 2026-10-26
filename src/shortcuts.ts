// Keeps the Shortcuts "Run air conditioner action" list (plugins/CocoroIntents.swift) in step with
// the app: turn on/off, every favorite, and every schedule, as ready-made frames.
import Udp from '../modules/echonet-udp';
import * as local from './api/local';
import type { Device } from './api/types';
import { describeSchedule, onAnyChange, presets, schedules } from './store';

let known: Device[] = [];

/** Call whenever the device list loads. Only home Wi‑Fi devices can run from Shortcuts. */
export function setShortcutDevices(devices: Device[]) {
  known = devices.filter((d) => d.id.startsWith('local:'));
  sync();
}

onAnyChange(() => { sync(); });

async function sync() {
  if (!Udp || !known.length) return; // never overwrite saved actions before the devices are known
  await schedules.load();
  const actions = [];
  for (const d of known) {
    const label = known.length > 1 ? `${d.name}: ` : '';
    await presets(d.id).load();
    actions.push(
      { id: `on:${d.id}`, title: `${label}Turn on`, deviceId: d.id, frames: local.actionFrames(d.id, 'on'), enabled: true, days: null },
      { id: `off:${d.id}`, title: `${label}Turn off`, deviceId: d.id, frames: local.actionFrames(d.id, 'off'), enabled: true, days: null },
      ...presets(d.id).get().map((p) => ({
        id: `fav:${d.id}:${p.id}`, title: `${label}Favorite: ${p.name}`, deviceId: d.id, frames: local.actionFrames(d.id, p), enabled: true, days: null,
      })),
    );
  }
  for (const s of schedules.get()) {
    if (!known.some((d) => d.id === s.deviceId)) continue;
    actions.push({
      id: `sched:${s.id}`,
      title: `Schedule: ${describeSchedule(s)}`,
      deviceId: s.deviceId,
      frames: local.actionFrames(s.deviceId, s.action === 'off' ? 'off' : s.settings ?? 'on'),
      enabled: s.enabled,
      days: s.days.length === 7 ? null : s.days,
    });
  }
  const devices = known.map((d) => local.deviceRecord(d.id)).filter(Boolean);
  Udp.setShortcutData(JSON.stringify({ devices, actions }));
}

/** When each action last ran from Shortcuts, by action id. */
export function lastRuns(): Record<string, string> {
  try {
    return JSON.parse(Udp?.shortcutRuns() ?? '{}');
  } catch {
    return {};
  }
}
