// Direct control over the home Wi‑Fi (ECHONET Lite on UDP 3610). No Sharp account involved.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Udp from '../../modules/echonet-udp';
import { capsFromSpec, decode, encode, parseSpec, type Spec } from './aircon';
import { AIRCON, ESV, buildFrame, fromStatus, parseFrame, parsePropMap, timerEdt, toHex, toStatus, type Frame, type Prop } from './echonet';
import { specTable } from './sharp';
import type { AcState, Device, TimerKind } from './types';

/** False in Expo Go, where the UDP native module isn't available. */
export const localAvailable = !!Udp;

const SAVED_KEY = 'localDevices';
type Saved = { id: string; ip: string; model: string };
type Entry = Saved & { spec: Spec; setmap: Set<number>; getmap: Set<number> };
const devices = new Map<string, Entry>();

const get = (...epcs: number[]): Prop[] => epcs.map((epc) => ({ epc, edt: [] }));
let tid = 0;

async function request(ip: string, esv: number, props: Prop[]): Promise<Frame> {
  if (!Udp) throw new Error('Home Wi‑Fi control needs the installed app, not Expo Go');
  const t = (tid = (tid % 0xfffe) + 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    const replies = await Udp.exchange([ip], buildFrame(t, AIRCON, esv, props), 2500, 1);
    const frame = replies.map((r) => parseFrame(r.split(' ')[1])).find((f) => f?.tid === t);
    if (frame) return frame;
  }
  throw new Error("The air conditioner didn't answer. Check that this phone is on your home Wi‑Fi");
}

/** Every aircon that answers on this /24 network. ponytail: assumes a /24 home subnet; add a manual IP field if a router uses something wider. */
async function scan(): Promise<Saved[]> {
  if (!Udp) return [];
  const ip = Udp.localIp();
  if (!ip) throw new Error('Connect this phone to your home Wi‑Fi first');
  const base = ip.split('.').slice(0, 3).join('.');
  const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`).filter((h) => h !== ip);
  const replies = await Udp.exchange(hosts, buildFrame(1, AIRCON, ESV.Get, get(0x83, 0x8c)), 3000, 0);
  const found = new Map<string, Saved>();
  for (const r of replies) {
    const [from, hex] = r.split(' ');
    const f = parseFrame(hex);
    if (!f || !f.seoj.startsWith('0130') || (f.esv !== ESV.Get_Res && f.esv !== ESV.Get_SNA)) continue;
    const prop = (epc: number) => f.props.find((p) => p.epc === epc)?.edt ?? [];
    const ident = toHex(prop(0x83));
    const model = String.fromCharCode(...prop(0x8c).filter((c) => c > 32 && c < 127)).trim();
    const id = `local:${ident || from}`;
    found.set(id, { id, ip: from, model });
  }
  return [...found.values()];
}

async function saved(): Promise<Saved[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(SAVED_KEY)) ?? '[]');
  } catch {
    return [];
  }
}

/** First scan (the iOS Local Network prompt drops packets until allowed, so try twice). */
export async function connect() {
  let list = await scan();
  if (!list.length) {
    await new Promise((r) => setTimeout(r, 1500));
    list = await scan();
  }
  if (!list.length) {
    throw new Error('No air conditioners found on this Wi‑Fi. Allow local network access in Settings, then try again');
  }
  await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

export const isConnected = async () => (await saved()).length > 0;

export async function disconnect() {
  devices.clear();
  await AsyncStorage.removeItem(SAVED_KEY);
}

/** Run against the unit; if its address changed (DHCP), rescan once and retry at the new one. */
async function withUnit<T>(id: string, fn: (e: Entry) => Promise<T>): Promise<T> {
  const e = devices.get(id);
  if (!e) throw new Error('This air conditioner is no longer available');
  try {
    return await fn(e);
  } catch (err) {
    const moved = (await scan()).find((s) => s.id === id);
    if (!moved || moved.ip === e.ip) throw err;
    e.ip = moved.ip;
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify([...devices.values()].map(({ id, ip, model }) => ({ id, ip, model }))));
    return fn(e);
  }
}

export async function listDevices(): Promise<Device[]> {
  const [list, table] = await Promise.all([saved(), specTable()]);
  return Promise.all(list.map(async (s) => {
    const maps = await request(s.ip, ESV.Get, get(0x9e, 0x9f)).catch(() => null);
    const map = (epc: number) => parsePropMap(maps?.props.find((p) => p.epc === epc)?.edt ?? []);
    const setmap = map(0x9e);
    const getmap = map(0x9f);
    const spec = { ...parseSpec(table.get(s.model) ?? table.get(s.model.replace(/-[A-Z]{1,2}$/, ''))) };
    spec.humidity = getmap.has(0xba);
    // Without Sharp's detail property (0xFA) only the standard settings work: whole degrees, no louvers.
    if (setmap.size && !setmap.has(0xfa)) Object.assign(spec, { halfDeg: false, vert: 0, horz: 0, gentle: false });
    if (setmap.size && !setmap.has(0xa0)) spec.fan = 0;
    devices.set(s.id, { ...s, spec, setmap, getmap });

    const caps = capsFromSpec(spec);
    caps.specials = caps.specials.filter((o) => o.id !== 'plasmacluster' || !setmap.size || setmap.has(0xcf));
    caps.timers = { on: setmap.has(0x90) && setmap.has(0x92), off: setmap.has(0x94) && setmap.has(0x96), sleep: false };
    caps.outdoor = getmap.has(0xbe);
    return { id: s.id, name: s.model ? `Sharp ${s.model}` : 'Air conditioner', room: `Home Wi‑Fi · ${s.ip}`, model: s.model || 'Unknown', caps };
  }));
}

const STATUS_EPCS = [0x80, 0xb0, 0xb3, 0xa0, 0xcf, 0xbb, 0xba, 0xbe, 0x84, 0x88, 0x86, 0xf1, 0xfa, 0x90, 0x92, 0x94, 0x96];

export function getState(id: string): Promise<AcState> {
  return withUnit(id, async (e) => {
    const epcs = e.getmap.size ? STATUS_EPCS.filter((x) => e.getmap.has(x)) : STATUS_EPCS.slice(0, 8);
    const res = await request(e.ip, ESV.Get, get(...epcs));
    const props = res.props.filter((p) => p.edt.length);
    const edt = (epc: number) => props.find((p) => p.epc === epc)?.edt;
    const timer = (reserve: number, time: number) =>
      edt(reserve)?.[0] === 0x41 && edt(time) ? edt(time)![0] * 60 + edt(time)![1] : null;
    return {
      ...decode(props.map(toStatus), e.spec),
      onTimerMin: timer(0x90, 0x92),
      offTimerMin: timer(0x94, 0x96),
      sleepTimerMin: null,
    };
  });
}

async function set(e: Entry, props: Prop[]) {
  const usable = props.filter((p) => !e.setmap.size || e.setmap.has(p.epc));
  if (!usable.length) return;
  const res = await request(e.ip, ESV.SetC, usable);
  if (res.esv !== ESV.Set_Res) throw new Error('The air conditioner refused that setting');
}

export function setState(id: string, cur: AcState, patch: Partial<AcState>): Promise<AcState> {
  return withUnit(id, async (e) => {
    for (const cmd of encode(cur, patch, e.spec)) await set(e, cmd.map(fromStatus));
    return getState(id);
  });
}

export function setTimer(id: string, kind: TimerKind, minutes: number | null): Promise<AcState> {
  return withUnit(id, async (e) => {
    if (kind === 'sleep') throw new Error('The sleep timer needs the Sharp account connection');
    const [reserve, time] = kind === 'on' ? [0x90, 0x92] : [0x94, 0x96];
    await set(e, minutes == null ? [{ epc: reserve, edt: [0x42] }] : [{ epc: time, edt: timerEdt(minutes) }, { epc: reserve, edt: [0x41] }]);
    return getState(id);
  });
}

// --- For the Shortcuts action (plugins/CocoroIntents.swift): ready-made frames, no JS needed to run them ---

const FROM_NOTHING: AcState = { power: false, mode: 'auto', targetTemp: -1, fan: '', louverV: '', louverH: '', specials: {} };

/** ECHONET SetC frames: power on/off only, or turn on with `settings`. */
export function actionFrames(id: string, settings: Partial<AcState> | 'on' | 'off'): string[] {
  const e = devices.get(id);
  if (!e) return [];
  // Diffing against an empty state makes encode() send every setting, not just changes.
  const cmds = typeof settings === 'string'
    ? [[{ epc: 0x80, edt: [settings === 'on' ? 0x30 : 0x31] }]]
    : encode(FROM_NOTHING, { ...settings, power: true }, e.spec).map((cmd) => cmd.map(fromStatus));
  return cmds
    .map((props) => props.filter((p) => !e.setmap.size || e.setmap.has(p.epc)))
    .filter((props) => props.length)
    .map((props, i) => buildFrame(0x7000 + i, AIRCON, ESV.SetC, props));
}

/** Where the Shortcuts action finds the unit, and how it recognizes it after an address change. */
export function deviceRecord(id: string) {
  const e = devices.get(id);
  return e && { id, ip: e.ip, ident: e.id.startsWith('local:') && !/^\d+\./.test(e.id.slice(6)) ? e.id.slice(6) : '' };
}
