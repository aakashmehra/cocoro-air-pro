// ECHONET Lite frames for talking to the air conditioner directly on the home Wi‑Fi.
// Properties are the same EPCs the Sharp cloud relays, so aircon.ts encodes/decodes them;
// this file only converts between ECHONET bytes and the cloud's status entries.
import type { StatusEntry } from './sharp';

export type Prop = { epc: number; edt: number[] };
export type Frame = { tid: number; seoj: string; deoj: string; esv: number; props: Prop[] };

export const ESV = { SetC: 0x61, Get: 0x62, SetC_SNA: 0x51, Get_SNA: 0x52, Set_Res: 0x71, Get_Res: 0x72 };
export const AIRCON = '013001';
const CONTROLLER = '05ff01';

export const toHex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));

export function buildFrame(tid: number, deoj: string, esv: number, props: Prop[]) {
  return toHex([
    0x10, 0x81, (tid >> 8) & 0xff, tid & 0xff,
    ...fromHex(CONTROLLER), ...fromHex(deoj), esv, props.length,
    ...props.flatMap((p) => [p.epc, p.edt.length, ...p.edt]),
  ]);
}

export function parseFrame(hex: string): Frame | null {
  const b = fromHex(hex);
  if (b.length < 12 || b[0] !== 0x10 || b[1] !== 0x81) return null;
  const props: Prop[] = [];
  let i = 12;
  for (let n = 0; n < b[11] && i + 1 < b.length; n++) {
    const pdc = b[i + 1];
    props.push({ epc: b[i], edt: b.slice(i + 2, i + 2 + pdc) });
    i += 2 + pdc;
  }
  return { tid: (b[2] << 8) | b[3], seoj: toHex(b.slice(4, 7)), deoj: toHex(b.slice(7, 10)), esv: b[10], props };
}

/** Property map (EPC 0x9D/0x9E/0x9F): a list when < 16 entries, otherwise a 16-byte bitmap. */
export function parsePropMap(edt: number[]): Set<number> {
  const n = edt[0] ?? 0;
  if (n < 16) return new Set(edt.slice(1, 1 + n));
  const set = new Set<number>();
  for (let i = 0; i < 16; i++) {
    for (let bit = 0; bit < 8; bit++) if ((edt[1 + i] ?? 0) & (1 << bit)) set.add(0x80 + i + 0x10 * bit);
  }
  return set;
}

// Same value types the cloud uses (protocol-aircon.md §1); BB/BE are signed temperatures.
const SINGLE = new Set([0x80, 0x88, 0xa0, 0xa1, 0xb0, 0xcf]);
const RANGE = new Set([0xb3, 0xba, 0xbb, 0xbe]);
const SIGNED = new Set([0xbb, 0xbe]);

export function toStatus(p: Prop): StatusEntry {
  const statusCode = p.epc.toString(16).toUpperCase().padStart(2, '0');
  if (SINGLE.has(p.epc)) return { statusCode, valueType: 'valueSingle', valueSingle: { code: toHex(p.edt.slice(0, 1)) } };
  if (RANGE.has(p.epc)) {
    const v = p.edt[0];
    return { statusCode, valueType: 'valueRange', valueRange: { type: 'int', code: String(SIGNED.has(p.epc) && v > 127 ? v - 256 : v) } };
  }
  return { statusCode, valueType: 'valueBinary', valueBinary: { code: toHex(p.edt) } };
}

export function fromStatus(e: StatusEntry): Prop {
  const epc = parseInt(e.statusCode, 16);
  if (e.valueType === 'valueRange') return { epc, edt: [Number(e.valueRange?.code) & 0xff] };
  return { epc, edt: fromHex(e.valueSingle?.code ?? e.valueBinary?.code ?? '') };
}

/** ECHONET relative timer value (EPC 0x92 / 0x96): [hours, minutes]. */
export const timerEdt = (minutes: number) => [Math.min(23, Math.floor(minutes / 60)), minutes % 60];
