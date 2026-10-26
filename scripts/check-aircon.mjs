// Self-check for the aircon codec against frames from docs/protocol-aircon.md.
// Run: node scripts/check-aircon.mjs
import { buildFA, encode, decode, parseSpec, DEFAULT_SPEC } from '../src/api/aircon.ts';

const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  got:  ${JSON.stringify(a)}\n  want: ${JSON.stringify(b)}`);
};
const pad = (s) => s.padEnd(160, '0');

// Known-good frames (doc §2 test vectors and §7 worked examples).
eq(buildFA({ 27: 40 }, 80), pad('48000020000000000000000000000000000000000000000000002800'), 'temp 20.0 frame');
eq(buildFA({ 27: 48, 42: 0 }, 80), pad('90000020004000000000000000000000000000000000000000003000'), 'example A frame');
eq(buildFA({ 49: 3, 50: 1 }, 80).slice(0, 100), 'c40000000000c0' + '0'.repeat(82) + '0301', 'example B frame');
eq(buildFA({ 27: 48 }, 128).length, 256, '2018 frame length');

const off = { power: false, mode: 'auto', targetTemp: 24, fan: 'auto', louverV: 'auto', louverH: 'front', specials: {} };
const spec = { ...DEFAULT_SPEC };

// Example A: power on, cool, 24 °C.
const a = encode(off, { power: true, mode: 'cool', targetTemp: 24 }, spec);
eq(a.length, 1, 'example A one command');
eq(a[0].map((e) => e.statusCode), ['80', 'cf', 'b0', 'fa'], 'example A order');
eq(a[0][3].valueBinary.code, pad('90000020004000000000000000000000000000000000000000003000'), 'example A fa');

// Example B: fan auto, vertical 03 while on.
const on = { ...off, power: true, mode: 'cool', specials: { plasmacluster: true } };
const b = encode(on, { louverV: '3' }, spec);
eq(b.length, 1, 'example B one command');
eq(b[0][0].valueBinary.code.slice(0, 2), 'c4', 'example B checksum');
eq(b[0][1].valueSingle.code, '41', 'example B fan');

// Non-half-degree model uses b3; off sends 80=31; nothing sent when off and only fan changes.
eq(encode(off, { mode: 'heat', targetTemp: 22.4 }, { ...spec, halfDeg: false })[0].at(-1).valueRange.code, '22', 'b3 whole degrees');
eq(encode(on, { power: false }, spec), [[{ statusCode: '80', valueType: 'valueSingle', valueSingle: { code: '31' } }]], 'power off');
eq(encode(off, { fan: 'turbo' }, spec), [], 'no wind command while off');

// Decode round trip from a status read.
const status = [
  { statusCode: 'F1', valueType: 'valueBinary', valueBinary: { code: '4142' } },
  { statusCode: 'FA', valueType: 'valueBinary', valueBinary: { code: a[0][3].valueBinary.code.toUpperCase() } },
  { statusCode: 'A0', valueType: 'valueSingle', valueSingle: { code: '37' } },
  { statusCode: 'BB', valueType: 'valueRange', valueRange: { type: 'int', code: '27' } },
  { statusCode: 'CF', valueType: 'valueSingle', valueSingle: { code: '41' } },
];
const d = decode(status, spec);
eq([d.power, d.mode, d.targetTemp, d.fan, d.roomTemp, d.specials.plasmacluster], [true, 'cool', 24, 'high', 27, true], 'decode');
eq(decode([{ statusCode: 'BB', valueType: 'valueRange', valueRange: { type: 'int', code: '125' } }], spec).roomTemp, undefined, 'room temp sentinel');

// Spec parsing from a real spec_0130.csv row.
const s = parseSpec('0000288822004206110002000100000000000000000000000000000000220001');
eq([s.year, s.vert, s.horz, s.fan], [22, 2, 0, 1], 'spec AY-P28DM');

console.log('aircon codec ok');

// Timer time math (Tokyo is UTC+9). 2026-10-24 05:07 UTC = 14:07 JST.
import { tokyoTime, minutesUntil, timersToState, timerBody } from '../src/api/aircon.ts';
const now = Date.UTC(2026, 9, 24, 5, 7);
eq(tokyoTime(120, now), '16:10', 'off in 2 h rounds up to 10 min');
eq(tokyoTime(0, Date.UTC(2026, 9, 24, 14, 55)), '00:00', 'wraps past midnight');
eq(minutesUntil('16:10', now), 123, 'minutes until');
eq(minutesUntil('14:00', now), 1433, 'tomorrow');
eq(
  timersToState([
    { timer_id: 1, enabled: true, time: '16:10', repetition: { repeatable: false }, control: { type: 49 } },
    { timer_id: 2, enabled: true, time: '07:00', repetition: { repeatable: true }, control: { type: 48 } },
    { timer_id: 3, enabled: true, type: 'sleep', time: '14:10', end_time: '17:10', advance: true, repetition: { repeatable: false }, control: { type: 48 } },
  ], now),
  { onTimerMin: null, offTimerMin: 123, sleepTimerMin: 183 },
  'timers to state',
);
const cool = { ...on, targetTemp: 24 };
eq(timerBody('off', 120, cool, spec, now).control, { type: 49, mode: 66, temperature: 48, air_flow: 65, wind_vertical: 0, wind_horizontal: 1 }, 'off timer body');
eq([timerBody('sleep', 60, cool, spec, now).time, timerBody('sleep', 60, cool, spec, now).end_time], ['14:10', '17:10'], 'sleep window min 3 h');
console.log('timer math ok');

// Home Wi-Fi (ECHONET Lite) framing, reusing the same codec.
import { buildFrame, parseFrame, parsePropMap, toStatus, fromStatus, ESV, AIRCON, timerEdt } from '../src/api/echonet.ts';
eq(buildFrame(1, AIRCON, ESV.Get, [{ epc: 0x80, edt: [] }]), '1081000105ff010130016201' + '8000', 'Get frame');
eq(parseFrame('108100010130010' + '5ff0172018001' + '30'), { tid: 1, seoj: '013001', deoj: '05ff01', esv: 0x72, props: [{ epc: 0x80, edt: [0x30] }] }, 'parse Get_Res');
eq([...parsePropMap([3, 0x80, 0xb0, 0xb3])], [0x80, 0xb0, 0xb3], 'prop map list');
const bitmap = [17, 0b1001, 0, 0, 0b1000, ...Array(12).fill(0)];
eq([...parsePropMap(bitmap)].sort(), [0x80, 0xb0, 0xb3].sort(), 'prop map bitmap');
eq(toStatus({ epc: 0xbb, edt: [0xfe] }).valueRange.code, '-2', 'signed room temp');
eq(fromStatus({ statusCode: 'b3', valueType: 'valueRange', valueRange: { type: 'int', code: '24' } }), { epc: 0xb3, edt: [24] }, 'range to edt');
eq(a[0].map(fromStatus).map((p) => p.epc), [0x80, 0xcf, 0xb0, 0xfa], 'cloud command as ECHONET props');
eq(a[0].map(fromStatus)[3].edt.length, 80, 'FA frame bytes');
const localStatus = [
  { epc: 0x80, edt: [0x30] }, { epc: 0xb0, edt: [0x42] }, { epc: 0xb3, edt: [24] }, { epc: 0xa0, edt: [0x41] },
  { epc: 0xbb, edt: [25] }, { epc: 0xbe, edt: [0xfb] }, { epc: 0x84, edt: [0x01, 0x2c] },
].map(toStatus);
const ld = decode(localStatus, { ...spec, halfDeg: false });
eq([ld.power, ld.mode, ld.targetTemp, ld.fan, ld.roomTemp, ld.outdoorTemp, ld.powerW], [true, 'cool', 24, 'auto', 25, -5, 300], 'decode local status');
eq(timerEdt(150), [2, 30], 'relative timer');
console.log('echonet ok');

// Wi-Fi setup: RSA PKCS#1 v1.5 against a Node-generated key (decrypt with the raw private exponent).
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { parsePublicKey, encryptPkcs1 } from '../src/api/rsa.ts';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = pair.privateKey.export({ format: 'jwk' });
const b64n = (s) => BigInt('0x' + Buffer.from(s, 'base64url').toString('hex'));
const rsaKey = parsePublicKey([...pair.publicKey.export({ type: 'spki', format: 'der' })]);
eq([rsaKey.n === b64n(jwk.n), String(rsaKey.e), rsaKey.size], [true, '65537', 256], 'parse SPKI key');
const secret = [...new TextEncoder().encode('{"ssid":"Home","passphrase":"p4ssw0rd!"}')];
const cipher = encryptPkcs1(rsaKey, secret, (n) => [...randomBytes(n)]);
let m = 1n, base = BigInt('0x' + Buffer.from(cipher).toString('hex')), exp = b64n(jwk.d);
for (base %= rsaKey.n; exp > 0n; exp >>= 1n, base = (base * base) % rsaKey.n) if (exp & 1n) m = (m * base) % rsaKey.n;
const block = [...Buffer.from(m.toString(16).padStart(510, '0'), 'hex')];
eq([block[0], block.slice(1, block.indexOf(0, 1)).every((x) => x !== 0), block.slice(block.indexOf(0, 1) + 1)], [2, true, secret], 'PKCS#1 v1.5 block');
console.log('rsa ok');

// Schedules/favorites from Shortcuts: diffing against an empty state must send every setting.
const FROM_NOTHING = { power: false, mode: 'auto', targetTemp: -1, fan: '', louverV: '', louverH: '', specials: {} };
const fav = encode(FROM_NOTHING, { power: true, mode: 'cool', targetTemp: 24, fan: 'high', louverV: '2', louverH: 'front', specials: { plasmacluster: true } }, spec);
eq(fav.length, 2, 'favorite sends mode and wind commands');
eq(fav[0].map((e) => e.statusCode), ['80', 'cf', 'b0', 'fa'], 'favorite mode command');
eq([fav[1][1].valueSingle.code, fav[1][0].valueBinary.code.slice(96, 100)], ['37', '0201'], 'favorite fan high, louver level/front');
console.log('schedule frames ok');
