// Sharp aircon property codec. Spec: docs/protocol-aircon.md
import type { StatusEntry } from './sharp';
import type { AcState, Capabilities, Mode, Option, TimerKind } from './types';

/** Decoded 32-byte model spec (spec_0130.csv row, same layout as vendor EPC 0xF0). */
export type Spec = {
  year: number;
  halfDeg: boolean;
  gentle: boolean;
  humidity: boolean;
  cleaner: boolean;
  vert: number; // 0 none, 1 full, 2 limited
  horz: number;
  fan: number;
  coolMin: number;
  heatMin: number;
  max: number;
  sleepTimer: boolean;
};

// Used when the model isn't in Sharp's spec list: a typical 2021 unit.
export const DEFAULT_SPEC: Spec = {
  year: 21, halfDeg: true, gentle: false, humidity: false, cleaner: false,
  vert: 1, horz: 1, fan: 1, coolMin: 18, heatMin: 18, max: 32, sleepTimer: true,
};

const byteAt = (hex: string, k: number) => parseInt(hex.substr((k - 1) * 2, 2), 16); // k is 1-based
const hexAt = (hex: string, k: number) => hex.substr((k - 1) * 2, 2).toLowerCase();

export function parseSpec(hex?: string | null): Spec {
  if (!hex || hex.length < 64 || /^0+$/.test(hex)) return DEFAULT_SPEC;
  const b = (i: number) => byteAt(hex, i + 1) || 0; // 0-based spec index
  const range = b(13);
  return {
    year: parseInt(hex.substr(8, 2), 10) || DEFAULT_SPEC.year, // year byte reads as decimal text
    halfDeg: !!(b(8) & 0x10),
    gentle: !!(b(8) & 0x20),
    humidity: !!(b(7) & 0x80),
    cleaner: !!(b(7) & 0x20),
    vert: b(10),
    horz: b(11),
    fan: b(12),
    max: range === 2 ? 30 : 32,
    coolMin: range === 2 ? 14 : 18,
    heatMin: range === 1 ? 15 : 18,
    sleepTimer: b(4) >= 0x20,
  };
}

const MODE_CODE: Record<Mode, string> = { auto: '41', cool: '42', heat: '43', dry: '44', fan: '45' };
const MODE_BY_CODE: Record<string, Mode> = { 41: 'auto', 42: 'cool', 43: 'heat', 44: 'dry', 45: 'fan' };

// UI ids are readable; `code` is the Sharp byte (A0 for fan, FA[49]/FA[50] for louvers).
type Coded = Option & { code: string };
const FAN: Coded[] = [
  { id: 'auto', label: 'Auto', code: '41' },
  { id: 'quiet', label: 'Quiet', code: '31' },
  { id: 'breeze', label: 'Breeze', code: '33' },
  { id: 'low', label: 'Low', code: '35' },
  { id: 'high', label: 'High', code: '37' },
  { id: 'turbo', label: 'Turbo', code: '38' },
];
const LOUVER_V: Coded[] = [
  { id: 'auto', label: 'Auto', code: '00' },
  { id: '1', label: 'Up', code: '01' },
  { id: '2', label: 'Level', code: '02' },
  { id: '3', label: 'Slightly down', code: '03' },
  { id: '4', label: 'Lower', code: '04' },
  { id: '5', label: 'Down', code: '05' },
  { id: 'swing', label: 'Swing', code: '07' },
];
const LOUVER_H: Coded[] = [
  { id: 'auto', label: 'Auto', code: '0a' },
  { id: 'front', label: 'Front', code: '01' },
  { id: 'left', label: 'Left', code: '02' },
  { id: 'right', label: 'Right', code: '03' },
  { id: 'wide', label: 'Wide', code: '07' },
  { id: 'enclose', label: 'Enclose', code: '08' },
  { id: 'swing', label: 'Swing', code: '0f' },
];
const toCode = (list: Coded[], id: string | undefined, fallback: string) => list.find((o) => o.id === id)?.code ?? fallback;
const toId = (list: Coded[], code: string) => list.find((o) => o.code === code)?.id;
const options = (list: Coded[]): Option[] => list.map(({ id, label }) => ({ id, label }));

export function capsFromSpec(s: Spec): Capabilities {
  const step = s.halfDeg ? 0.5 : 1;
  const wind = s.year >= 18; // older units can't change fan or louvers over the network
  return {
    modes: ['auto', 'cool', 'heat', 'dry', 'fan'],
    tempRange: {
      auto: null, dry: null, fan: null,
      cool: { min: s.coolMin, max: s.max, step },
      heat: { min: s.heatMin, max: 32, step },
    },
    fanLevels: wind && s.fan ? options(FAN.filter((f) => !(s.fan === 2 && f.id === 'quiet'))) : [],
    louverV: wind && s.vert ? options(LOUVER_V) : [],
    louverH: wind && s.horz ? options(LOUVER_H.filter((o) => s.horz !== 2 || !['wide', 'enclose', 'auto'].includes(o.id))) : undefined,
    specials: [
      { id: 'plasmacluster', label: 'Plasmacluster' },
      ...(s.gentle ? [{ id: 'gentle', label: 'Gentle airflow' }] : []),
    ],
    timers: { on: true, off: true, sleep: s.sleepTimer },
    humidity: s.humidity,
  };
}

// --- 0xFA sparse frame ---

const bitFor = (k: number) => (k <= 52 ? k - 16 : k <= 54 ? 36 : k - 18);

export function buildFA(fields: Record<number, number>, n: 80 | 128): string {
  const b = new Uint8Array(n);
  for (const [ks, v] of Object.entries(fields)) {
    const k = +ks;
    if (k < 17 || k > 80) throw new Error(`FA field ${k} out of range`);
    b[k - 1] = v & 0xff;
    const bit = bitFor(k) - 1;
    b[2 + (bit >> 3)] |= 0x80 >> (bit & 7);
  }
  b[0] = b.slice(1).reduce((sum, x) => sum + x, 0) & 0xff;
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const frameLen = (s: Spec): 80 | 128 => (s.year >= 19 ? 80 : 128);

// --- decode ---

export type DecodedState = AcState & { fault?: string };

export function decode(status: StatusEntry[], s: Spec): DecodedState {
  const m = new Map(status.map((e) => [e.statusCode.toUpperCase(), e]));
  const code = (c: string) =>
    (m.get(c)?.valueSingle?.code ?? m.get(c)?.valueBinary?.code ?? '').toLowerCase();
  const num = (c: string) => {
    const v = m.get(c)?.valueRange?.code;
    return v == null || v === '' ? undefined : Number(v);
  };
  const f1 = code('F1');
  const fa = code('FA');

  const powerByte = hexAt(f1, 1);
  const power = powerByte ? powerByte !== '31' : code('80') === '30';
  const mode = MODE_BY_CODE[hexAt(f1, 2)] ?? MODE_BY_CODE[code('B0')] ?? 'auto';

  const faTemp = fa.length >= 54 ? byteAt(fa, 27) / 2 : 0;
  const targetTemp = s.halfDeg && faTemp > 0 ? faTemp : num('B3') || 24;


  const room = num('BB');
  const hum = num('BA');
  const outdoor = num('BE');
  let fault: string | undefined;
  if (code('88') === '41') {
    const b = byteAt(code('86'), 5);
    fault = ({ 0x1c: '28-0', 0x3c: '28-1', 0x15: '21-0' } as Record<number, string>)[b]
      ?? (Number.isNaN(b) ? 'Unknown' : `${b & 31}-${b >> 5}`);
  }

  return {
    power,
    mode,
    targetTemp,
    fan: toId(FAN, code('A0')) ?? 'auto',
    louverV: toId(LOUVER_V, hexAt(fa, 49)) ?? 'auto',
    louverH: toId(LOUVER_H, hexAt(fa, 50)),
    specials: { plasmacluster: code('CF') === '41', gentle: fa.length >= 84 && hexAt(fa, 42) === '01' },
    // 125 / -127 / 126 are "above range", "below range", "unknown" sentinels.
    roomTemp: room != null && room > -50 && room < 100 ? room : undefined,
    humidity: s.humidity && hum != null && hum <= 100 ? hum : undefined,
    // Only reported over the local network (the cloud never relays these).
    outdoorTemp: outdoor != null && outdoor > -50 && outdoor < 100 ? outdoor : undefined,
    powerW: code('84') ? parseInt(code('84'), 16) : undefined,
    fault,
  };
}

// --- encode ---

const single = (c: string, v: string): StatusEntry => ({ statusCode: c, valueType: 'valueSingle', valueSingle: { code: v } });
const range = (c: string, v: number): StatusEntry => ({ statusCode: c, valueType: 'valueRange', valueRange: { type: 'int', code: String(v) } });
const binary = (c: string, v: string): StatusEntry => ({ statusCode: c, valueType: 'valueBinary', valueBinary: { code: v } });

export function clampTemp(t: number, mode: Mode, s: Spec) {
  const min = mode === 'heat' ? s.heatMin : s.coolMin;
  const max = mode === 'heat' ? 32 : s.max;
  const step = s.halfDeg ? 0.5 : 1;
  return Math.min(max, Math.max(min, Math.round(t / step) * step));
}

const MODE_KEYS = ['power', 'mode', 'targetTemp'] as const;
const WIND_KEYS = ['fan', 'louverV', 'louverH'] as const;

/**
 * Turns a state change into deviceControl commands (one status[] per request), in the
 * same order and grouping the official app uses: a mode command, then a wind command.
 */
export function encode(cur: AcState, patch: Partial<AcState>, s: Spec): StatusEntry[][] {
  const next: AcState = { ...cur, ...patch, specials: { ...cur.specials, ...patch.specials } };
  const differs = (k: keyof AcState) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(cur[k]);
  const specialChanged = (id: string) => patch.specials != null && id in patch.specials && !!patch.specials[id] !== !!cur.specials[id];

  if (patch.power === false) {
    return cur.power || differs('power')
      ? [[single('80', '31'), ...(s.cleaner ? [binary('fa', buildFA({ 71: 1 }, 80))] : [])]]
      : [];
  }
  // Choosing a mode turns the unit on, like the official app. Other changes need it on.
  const on = patch.power ?? (cur.power || 'mode' in patch);
  if (!on) return [];

  const cmds: StatusEntry[][] = [];
  const gentle = s.gentle && !!next.specials.gentle;
  const coolOrHeat = next.mode === 'cool' || next.mode === 'heat';

  if (!cur.power || MODE_KEYS.some(differs) || specialChanged('plasmacluster') || specialChanged('gentle')) {
    const cmd = [single('80', '30')];
    if (s.year <= 17) cmd.push(single('a0', '41'), single('a1', '41'));
    cmd.push(single('cf', next.specials.plasmacluster === false ? '42' : '41'), single('b0', MODE_CODE[next.mode]));
    if (coolOrHeat) {
      const t = clampTemp(next.targetTemp, next.mode, s);
      if (!s.halfDeg) {
        cmd.push(range('b3', Math.trunc(t)));
      } else {
        const f: Record<number, number> = { 27: t * 2 };
        if (s.gentle || s.year >= 21) f[42] = gentle ? 1 : 0;
        if (gentle && s.year > 17) {
          cmd.push(single('a0', next.mode === 'cool' ? '41' : '31'));
          f[49] = next.mode === 'cool' ? 0 : 1;
        }
        cmd.push(binary('fa', buildFA(f, s.year <= 17 ? 128 : frameLen(s))));
      }
    }
    cmds.push(cmd);
  }

  // Gentle airflow owns fan and louvers while active.
  if (s.year >= 18 && WIND_KEYS.some(differs) && !(gentle && coolOrHeat)) {
    let v = toCode(LOUVER_V, next.louverV, 'ff');
    if (s.vert === 0) v = 'ff';
    if (s.vert === 2 && v === '05' && (next.mode === 'heat' || next.mode === 'auto')) v = '00';
    let h = toCode(LOUVER_H, next.louverH, 'ff');
    if (s.horz === 0) h = 'ff';
    if (s.horz === 2 && ['07', '08', '0a'].includes(h)) h = '01';
    const fan = s.fan === 2 && next.fan === 'quiet' ? '41' : toCode(FAN, next.fan, '41');
    cmds.push([binary('fa', buildFA({ 49: parseInt(v, 16), 50: parseInt(h, 16) }, frameLen(s))), single('a0', fan)]);
  }
  return cmds;
}

// --- Cloud timers (cboard). They take Tokyo wall-clock "HH:mm", so countdowns are converted here. ---

export type CloudTimer = {
  timer_id: number;
  enabled: boolean;
  type?: string | null;
  advance?: boolean;
  time: string;
  end_time?: string | null;
  repetition?: { repeatable: boolean };
  control?: { type: number };
};

const TOKYO_OFFSET = 9 * 60; // UTC+9, Japan has no DST
const DAY = 1440;
const two = (n: number) => String(n).padStart(2, '0');
const tokyoMinute = (now: number) => (((Math.floor(now / 60000) + TOKYO_OFFSET) % DAY) + DAY) % DAY;

/** "HH:mm" in Tokyo for now + minutes, rounded up to the 10-minute steps the cloud uses. */
export function tokyoTime(minutesFromNow: number, now = Date.now()) {
  const m = (Math.ceil((tokyoMinute(now) + minutesFromNow) / 10) * 10) % DAY;
  return `${two(Math.floor(m / 60))}:${two(m % 60)}`;
}

export function minutesUntil(hhmm: string, now = Date.now()) {
  const [h, m] = hhmm.split(':').map(Number);
  return (((h * 60 + m - tokyoMinute(now)) % DAY) + DAY) % DAY;
}

/** Which countdown a timer represents; repeating schedules and pre-run timers aren't shown as countdowns. */
export function timerKind(t: CloudTimer): TimerKind | null {
  if (!t.enabled || t.repetition?.repeatable) return null;
  if (t.type === 'sleep') return 'sleep';
  if (t.control?.type === 48 && !t.advance) return 'on';
  if (t.control?.type === 49) return 'off';
  return null;
}

export function timersToState(timers: CloudTimer[], now = Date.now()) {
  const left: Record<TimerKind, number | null> = { on: null, off: null, sleep: null };
  for (const t of timers) {
    const kind = timerKind(t);
    if (!kind) continue;
    const min = minutesUntil(kind === 'sleep' ? t.end_time || t.time : t.time, now);
    left[kind] = left[kind] == null ? min : Math.min(left[kind]!, min);
  }
  return { onTimerMin: left.on, offTimerMin: left.off, sleepTimerMin: left.sleep };
}

const NO_REPEAT = { repeatable: false, sun: false, mon: false, tue: false, wed: false, thu: false, fri: false, sat: false };
const MODE_NUM: Record<Mode, number> = { auto: 65, cool: 66, heat: 67, dry: 68, fan: 69 };

/** Request body for a one-shot timer that fires `minutes` from now with the current settings. */
export function timerBody(kind: TimerKind, minutes: number, st: AcState, s: Spec, now = Date.now()) {
  const coolOrHeat = st.mode === 'cool' || st.mode === 'heat';
  if (kind === 'sleep' && !coolOrHeat) throw new Error('sleep_mode');
  const control = {
    type: kind === 'off' ? 49 : 48,
    mode: MODE_NUM[st.mode],
    temperature: coolOrHeat ? Math.round(clampTemp(st.targetTemp, st.mode, s) * 2) : 255,
    air_flow: parseInt(toCode(FAN, st.fan, '41'), 16),
    wind_vertical: parseInt(toCode(LOUVER_V, st.louverV, '00'), 16),
    wind_horizontal: parseInt(toCode(LOUVER_H, st.louverH, 'ff'), 16),
  };
  const base = { enabled: true, title: 'timer', timezone: 'Asia/Tokyo', repetition: NO_REPEAT, control };
  if (kind !== 'sleep') return { ...base, time: tokyoTime(minutes, now), advance: false };
  // Sleep runs from now until the end; the cloud needs a 3 h to 23 h 50 min window.
  const length = Math.min(Math.max(minutes, 180), 1430);
  return { ...base, type: 'sleep', time: tokyoTime(0, now), end_time: tokyoTime(length, now), advance: true };
}
