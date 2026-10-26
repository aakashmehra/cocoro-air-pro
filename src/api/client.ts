// App-facing client: Sharp cloud (sharp.ts + aircon.ts), home Wi‑Fi (local.ts), or the demo.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as sharp from './sharp';
import { capsFromSpec, decode, encode, parseSpec, timerBody, timerKind, timersToState, type Spec } from './aircon';
import { demo } from './demo';
import * as local from './local';
import type { AcState, Device, TimerKind } from './types';

type Entry = { dev: sharp.SharpDevice; spec: Spec; last?: AcState };
const devices = new Map<string, Entry>();

function entry(id: string) {
  const e = devices.get(id);
  if (!e) throw new Error('This air conditioner is no longer available');
  return e;
}

const statusCode = (status: sharp.StatusEntry[], epc: string) =>
  status.find((e) => e.statusCode.toUpperCase() === epc)?.valueBinary?.code ?? undefined;

/** First MCU version from vendor EPC FD: [count][major][minor][build hi][build lo]... */
function firmware(fd?: string) {
  if (!fd || fd.length < 10) return undefined;
  const b = (i: number) => parseInt(fd.substr(i * 2, 2), 16);
  return `${b(1)}.${b(2)}.${(b(3) << 8) | b(4)}`;
}

const real = {
  isSignedIn: sharp.isSignedIn,
  signIn: sharp.signIn,
  signOut: sharp.signOut,

  async listDevices(): Promise<Device[]> {
    const [list, table] = await Promise.all([sharp.listDevices(), sharp.specTable()]);
    return Promise.all(list.map(async (dev) => {
      const prop = await sharp.getProperty(dev).catch(() => null);
      const status = prop?.status ?? [];
      // Sharp's list first (how the app does it), then the unit's own spec EPC F0, then defaults.
      const hex = table.get(dev.model) ?? table.get(dev.model.replace(/-[A-Z]{1,2}$/, '')) ?? statusCode(status, 'F0');
      const spec = parseSpec(hex);
      const id = String(dev.deviceId);
      devices.set(id, { dev, spec, last: status.length ? decode(status, spec) : undefined });
      return { id, name: dev.name, room: dev.place || undefined, model: dev.model, firmware: firmware(statusCode(status, 'FD')), caps: capsFromSpec(spec) };
    }));
  },

  async getState(id: string): Promise<AcState> {
    const e = entry(id);
    const [{ status }, timers] = await Promise.all([
      sharp.getStatus(e.dev),
      sharp.listTimers(e.dev).catch(() => null), // timers are optional; never block the status
    ]);
    const state = { ...decode(status, e.spec), ...(timers ? timersToState(timers) : {}) };
    e.last = state;
    return state;
  },

  async setState(id: string, patch: Partial<AcState>): Promise<AcState> {
    const e = entry(id);
    const cur = e.last ?? (await real.getState(id));
    for (const cmd of encode(cur, patch, e.spec)) await sharp.control(e.dev, cmd);
    const fresh = await real.getState(id);
    // The cloud's cached status can lag a confirmed command by a few seconds; keep what the
    // unit just accepted so the UI doesn't flick back. The next poll shows the real value.
    const merged = { ...fresh, ...patch, specials: { ...fresh.specials, ...patch.specials } };
    e.last = merged;
    return merged;
  },

  async setTimer(id: string, kind: TimerKind, minutes: number | null): Promise<AcState> {
    const e = entry(id);
    const cur = e.last ?? (await real.getState(id));
    let body: object | null = null;
    if (minutes != null) {
      try {
        body = timerBody(kind, minutes, cur, e.spec);
      } catch {
        throw new sharp.SharpError('sleep_mode');
      }
    }
    await sharp.replaceTimer(e.dev, kind, body, timerKind);
    return real.getState(id);
  },
};

// Home Wi‑Fi: talks to the unit directly; keeps the last state so changes encode against it.
const lastLocal = new Map<string, AcState>();
const home = {
  isSignedIn: local.isConnected,
  signIn: local.connect,
  signOut: local.disconnect,
  listDevices: local.listDevices,
  async getState(id: string) {
    const st = await local.getState(id);
    lastLocal.set(id, st);
    return st;
  },
  async setState(id: string, patch: Partial<AcState>) {
    const st = await local.setState(id, lastLocal.get(id) ?? (await home.getState(id)), patch);
    lastLocal.set(id, st);
    return st;
  },
  async setTimer(id: string, kind: TimerKind, minutes: number | null) {
    const st = await local.setTimer(id, kind, minutes);
    lastLocal.set(id, st);
    return st;
  },
};

/** How the app reaches the air conditioner: Sharp account (cloud), home Wi‑Fi, or the demo. */
export type Connection = 'cloud' | 'local' | 'demo';
const backends = { cloud: real, local: home, demo };
const MODE_KEY = 'connection';
let mode: Connection | undefined;

async function current() {
  mode ??= ((await AsyncStorage.getItem(MODE_KEY)) as Connection | null) ?? 'cloud';
  return backends[mode];
}

export const localAvailable = local.localAvailable;

export const client = {
  async connection(): Promise<Connection> {
    await current();
    return mode!;
  },
  isSignedIn: async () => (await current()).isSignedIn(),
  async signIn(via: Connection = 'cloud') {
    mode = via;
    await AsyncStorage.setItem(MODE_KEY, via);
    await backends[via].signIn();
  },
  async signOut() {
    await (await current()).signOut();
    devices.clear();
    lastLocal.clear();
    mode = 'cloud';
    await AsyncStorage.removeItem(MODE_KEY);
  },
  listDevices: async (): Promise<Device[]> => (await current()).listDevices(),
  getState: async (id: string): Promise<AcState> => (await current()).getState(id),
  setState: async (id: string, patch: Partial<AcState>): Promise<AcState> => (await current()).setState(id, patch),
  setTimer: async (id: string, kind: TimerKind, min: number | null): Promise<AcState> => (await current()).setTimer(id, kind, min),
};
