// First-time Wi‑Fi setup over the air conditioner's own network (AP-SHARP-…).
// Spec: docs/protocol-wifi-setup.md §2. No Sharp account or cloud involved.
import * as Crypto from 'expo-crypto';
import Udp from '../../modules/echonet-udp';
import { fromHex, toHex } from './echonet';
import { encryptPkcs1, parsePublicKey } from './rsa';

const HEADERS = ['X-AiotKey', 'ZghFpx0h6xlzeP4M'];
const NOT_JOINED = "Couldn't reach the air conditioner. Make sure this iPhone is joined to its AP-SHARP network, then try again";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let lastBase: string | null = null; // the address that answered, reused for the next steps

/** The unit is meant to answer as aiot.sharp; if iOS doesn't resolve that, try its address on its own network. */
function bases() {
  const ip = Udp?.localIp();
  const gateway = ip ? `http://${ip.split('.').slice(0, 3).join('.')}.1` : null;
  return [...new Set([lastBase, 'http://aiot.sharp', gateway])].filter((b): b is string => !!b);
}

async function call(method: string, path: string, body: number[] = []) {
  if (!Udp) throw new Error('Wi‑Fi setup needs the installed app, not Expo Go');
  const headers = body.length ? [...HEADERS, 'Content-Type', 'application/octet-stream'] : HEADERS;
  const tried: string[] = [];
  let res: [string, string] | null = null;
  for (const base of bases()) {
    try {
      res = await Udp.http(method, base + path, headers, toHex(body), 8000);
      lastBase = base;
      break;
    } catch (e) {
      tried.push(`${base.slice(7)}: ${message(e)}`);
    }
  }
  if (!res) {
    const ip = Udp.localIp();
    throw new Error(`${NOT_JOINED}. ${ip ? `This iPhone is at ${ip}.` : 'This iPhone has no Wi‑Fi address.'} ${tried.join(' ')}`);
  }
  if (res[0] !== '200') throw new Error(`The air conditioner answered with an error (${res[0]})`);
  return fromHex(res[1]);
}

export type HostInfo = { model: string; mac: string; wifi5g: boolean };

/** Confirms we're talking to an air conditioner's setup network. */
export async function hostInfo(): Promise<HostInfo> {
  const raw = await call('GET', '/get/hostinfo');
  let info: Record<string, unknown>;
  try {
    info = JSON.parse(new TextDecoder().decode(new Uint8Array(raw)));
  } catch {
    throw new Error("Something answered on this network, but it isn't an air conditioner");
  }
  if (!String(info.EOJ ?? '').startsWith('0130')) throw new Error("This device doesn't look like an air conditioner");
  return { model: String(info.ProductName ?? ''), mac: String(info.mac ?? ''), wifi5g: info.WiFi_5G === true };
}

/** Hands the home Wi‑Fi name and password to the unit, encrypted with its own public key. */
export async function sendWifi(ssid: string, passphrase: string) {
  const key = parsePublicKey(await call('GET', '/get/rsapub'));
  const plain = [...new TextEncoder().encode(JSON.stringify({ ssid, passphrase }))];
  await call('POST', '/set/wlaninfo', encryptPkcs1(key, plain, (n) => [...Crypto.getRandomBytes(n)]));
}
