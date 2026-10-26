// Sharp COCORO AIR cloud transport. Spec: docs/protocol-cloud.md
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { CloudTimer } from './aircon';
import type { TimerKind } from './types';

const API = 'https://hms.cloudlabs.sharp.co.jp/hems/pfApi/ta/';
const SECRET = 'pngtfljRoYsJE9NW7opn1t2cXA5MtZDKbwon368hs80%3D'; // already url-encoded, don't encode again
const AUTH = 'https://auth.cocoromembers.jp.sharp';
const CLIENT_ID = 'lYCfqtg8PF4wrVUF0IosOME9UiObmY4F';
const AUDIENCE = 'https://api.cocoromembers.jp.sharp/';
const HMS_REDIRECT = 'cocoroair://hms-login';
const UA = 'smartlink_v200i Mozilla/5.0 (iPhone; CPU iPhone OS like Mac OS X)';
const TID_KEY = 'sharp.terminalAppId';
const CBOARD = 'https://cboard.cloudlabs.sharp.co.jp/cocoroapp/api/v1/';
const CBOARD_CLIENT = 'CocoroAppAPI/c65031fa6101217db12231931fe01e6c';
const CBOARD_KEY = 'sharp.cboard'; // { terminalId, appliances: { [boxId]: applianceId } }

export type StatusEntry = {
  statusCode: string;
  valueType: 'valueSingle' | 'valueRange' | 'valueBinary';
  valueSingle?: { code: string } | null;
  valueRange?: { type: 'int'; code: string } | null;
  valueBinary?: { code: string | null } | null;
};

export type SharpDevice = {
  boxId: string;
  deviceId: number;
  echonetNode: string;
  echonetObject: string;
  model: string;
  name: string;
  place: string;
};

const ERRORS: Record<string, string> = {
  E0101006: 'Your Sharp account is locked',
  E1001001: 'The air conditioner is offline',
  E1001002: 'The air conditioner did not respond in time',
  E1004001: 'Could not reach the air conditioner',
  E1004002: 'The air conditioner is busy, try again in a moment',
  timer_overlap: 'That timer overlaps another timer',
  sleep_mode: 'The sleep timer works in cool or heat mode',
  cancelled: 'Sign-in was cancelled',
  not_signed_in: 'Please sign in again',
};

export class SharpError extends Error {
  constructor(public code: string, public status?: number) {
    super(ERRORS[code] ?? `Sharp server error (${code})`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CallOpts = { method?: 'GET' | 'POST'; query?: string; body?: unknown };

async function call<T = any>(path: string, opts: CallOpts = {}, retry = true): Promise<T> {
  // boxId / terminalAppId are passed raw in the query, as the app does.
  const res = await fetch(`${API}${path}?appSecret=${SECRET}${opts.query ?? ''}`, {
    method: opts.method ?? 'GET',
    credentials: 'include', // JSESSIONID lives in the native cookie store
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && retry && !path.startsWith('setting/login')) {
    await tidLogin();
    return call(path, opts, false);
  }
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  if (!res.ok) throw new SharpError(json.errorCode ?? `HTTP ${res.status}`, res.status);
  return json;
}

// --- Sign-in (COCORO MEMBERS / Auth0, PKCE) ---

const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n: number) => b64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(n))));
const param = (url: string, key: string) => {
  const m = url.match(new RegExp(`[?&]${key}=([^&#]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
};

async function authorize(redirect: string, scope: string, silent: boolean) {
  const verifier = randomToken(32);
  const challenge = b64url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  const state = randomToken(16);
  const q: Record<string, string> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    audience: AUDIENCE,
    ...(silent ? { prompt: 'none' } : { nonce: randomToken(32) }),
  };
  const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const result = await WebBrowser.openAuthSessionAsync(`${AUTH}/authorize?${qs}`, redirect);
  if (result.type !== 'success') throw new SharpError(silent ? 'login_required' : 'cancelled');
  const error = param(result.url, 'error');
  if (error) throw new SharpError(error);
  const code = param(result.url, 'code');
  if (!code || param(result.url, 'state') !== state) throw new SharpError('bad_callback');
  return { code, verifier };
}

/** One-time browser sign-in, then binds a new terminalAppId to the account. */
export async function signIn() {
  // Same two-step sequence as the Android app: interactive login, then a silent
  // authorize whose code the HMS server redeems itself.
  await authorize('cocoroair://cm-login', 'openid email profile address', false);
  const { code, verifier } = await authorize(HMS_REDIRECT, 'offline_access openid email profile address', true);

  const { terminalAppId } = await call<{ terminalAppId: string }>('setting/terminalAppId/');
  await call('setting/login/', {
    method: 'POST',
    query: '&serviceName=iClub',
    body: { tempAccToken: `auth:${code}:${verifier}:${CLIENT_ID}`, terminalAppId, redirectUrl: HMS_REDIRECT },
  }, false);
  // Enables terminalAppId-only login on later launches. ponytail: best-effort; unclear
  // if required (open question 2 in the spec), so a failure here doesn't block sign-in.
  await call('setting/terminal', {
    method: 'POST',
    body: {
      name: 'Cocoro Air Pro',
      os: 'iOS',
      osVersion: String(Platform.Version),
      pushId: '',
      appName: 'spremote_i:1:2.2.18',
      permitTidLogin: 1,
      expireSecTidLogin: 0,
    },
  }).catch(() => {});
  await SecureStore.setItemAsync(TID_KEY, terminalAppId);
  await SecureStore.deleteItemAsync(CBOARD_KEY); // cboard ids belong to the old terminalAppId
}

export async function tidLogin() {
  const terminalAppId = await SecureStore.getItemAsync(TID_KEY);
  if (!terminalAppId) throw new SharpError('not_signed_in');
  await call('setting/login/', { method: 'POST', query: '&serviceName=iClub', body: { terminalAppId } }, false);
}

export const isSignedIn = async () => !!(await SecureStore.getItemAsync(TID_KEY));
export const signOut = () => Promise.all([TID_KEY, CBOARD_KEY].map((k) => SecureStore.deleteItemAsync(k)));

// --- Devices, status, control ---

export async function listDevices(): Promise<SharpDevice[]> {
  const { box = [] } = await call<{ box?: any[] }>('setting/boxInfo', { query: '&mode=other' });
  return box.flatMap((b) => {
    const e = b.echonetData?.[0];
    if (e?.labelData?.deviceType !== 'AIR_CON') return [];
    return [{
      boxId: b.boxId,
      deviceId: e.deviceId,
      echonetNode: e.echonetNode,
      echonetObject: e.echonetObject,
      model: e.model ?? '',
      name: e.labelData.name ?? 'Air conditioner',
      place: e.labelData.place ?? '',
    }];
  });
}

const devQuery = (d: SharpDevice) =>
  `&boxId=${d.boxId}&echonetNode=${d.echonetNode}&echonetObject=${d.echonetObject}`;

/** Capabilities (property list) plus current status. */
export async function getProperty(d: SharpDevice) {
  const { deviceProperty } = await call('control/deviceProperty', { query: `${devQuery(d)}&status=true` });
  return deviceProperty as { property: any[]; status: StatusEntry[]; propertyUpdatedAt: string };
}

export async function getStatus(d: SharpDevice) {
  const { deviceStatus } = await call('control/deviceStatus', { query: devQuery(d) });
  return deviceStatus as { status: StatusEntry[]; propertyUpdatedAt: string };
}

/** Send properties, then poll until the device confirms (2s, then 1s x20, as the app does). */
export async function control(d: SharpDevice, status: StatusEntry[]) {
  const body = {
    controlList: [{ deviceId: d.deviceId, echonetNode: d.echonetNode, echonetObject: d.echonetObject, status }],
  };
  let sent: { id: string; errorCode: string | null } | undefined;
  for (let attempt = 0; ; attempt++) {
    const res = await call('control/deviceControl', { method: 'POST', query: `&boxId=${d.boxId}`, body });
    sent = res.controlList?.[0];
    // Offline usually means the adapter is waking up; the app retries twice after 10s.
    if (sent?.errorCode !== 'E1001001' || attempt === 2) break;
    await sleep(10_000);
  }
  if (!sent?.id || sent.errorCode) throw new SharpError(sent?.errorCode ?? 'no_control_id');

  await sleep(2000);
  for (let i = 0; i <= 20; i++) {
    const { resultList } = await call('control/controlResult', {
      method: 'POST',
      query: `&boxId=${d.boxId}`,
      body: { resultList: [{ id: sent.id }] },
    });
    const r = resultList?.[0];
    if (r?.status === 'success' || r?.status === 'unmatch') return;
    if (r?.status === 'error') throw new SharpError(r.errorCode ?? 'control_failed');
    await sleep(1000);
  }
  // Timed out waiting: the app just re-reads state, so do the same (caller refreshes).
}

// --- Timers (cboard API, spec: docs/protocol-aircon.md §10) ---

async function cboard<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const tid = await SecureStore.getItemAsync(TID_KEY);
  if (!tid) throw new SharpError('not_signed_in');
  const res = await fetch(CBOARD + path, {
    method,
    headers: {
      'X-Client-Id': CBOARD_CLIENT,
      'X-Term-App-Id': tid,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 409) throw new SharpError('timer_overlap', 409);
  if (!res.ok) throw new SharpError(`HTTP ${res.status}`, res.status);
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : ({} as T);
  } catch {
    return {} as T;
  }
}

/** cboard needs its own appliance id per box, minted once and cached. */
async function applianceId(boxId: string, fresh = false): Promise<number> {
  const store = JSON.parse((await SecureStore.getItemAsync(CBOARD_KEY)) ?? '{}');
  store.appliances ??= {};
  if (!store.terminalId) {
    await cboard('users', 'POST').catch(() => {}); // may already exist
    const res = await cboard('terminals', 'POST', {
      notify_name: 'gcm',
      applications: [{
        name: 'spremote',
        version: '1.0',
        notification: [{ name: 'appliance', value: 1 }, { name: 'system', value: 1 }],
      }],
    });
    store.terminalId = res.terminal_id;
  }
  if (fresh || !store.appliances[boxId]) {
    const res = await cboard(`terminals/${store.terminalId}/appliances`, 'POST', { appliances: [{ box_id: boxId }] });
    store.appliances[boxId] = res.appliances?.[0]?.appliance_id;
  }
  await SecureStore.setItemAsync(CBOARD_KEY, JSON.stringify(store));
  if (!store.appliances[boxId]) throw new SharpError('no_appliance_id');
  return store.appliances[boxId];
}

export async function listTimers(d: SharpDevice): Promise<CloudTimer[]> {
  const get = async (fresh: boolean) =>
    (await cboard<{ timers?: CloudTimer[] }>(`appliances/${await applianceId(d.boxId, fresh)}/timers`)).timers ?? [];
  try {
    return await get(false);
  } catch {
    return get(true); // cached id may be stale; mint again once
  }
}

/** Replaces any one-shot timer of this kind; `body` null just cancels. */
export async function replaceTimer(
  d: SharpDevice,
  kind: TimerKind,
  body: object | null,
  kindOf: (t: CloudTimer) => TimerKind | null,
) {
  const aid = await applianceId(d.boxId);
  for (const t of await listTimers(d)) {
    if (kindOf(t) === kind) await cboard(`appliances/${aid}/timers/${t.timer_id}`, 'DELETE');
  }
  if (body) await cboard(`appliances/${aid}/timers`, 'POST', body);
}

// --- Model spec list (public static file, no account needed) ---

const SPEC_URL = 'https://cboard.cloudlabs.sharp.co.jp/cocoroapp/static/air/property/spec_0130.csv';

/** model -> 64-hex spec, from Sharp's published list (cached for offline launches). */
export async function specTable(): Promise<Map<string, string>> {
  let csv: string | null = null;
  try {
    const res = await fetch(SPEC_URL);
    if (res.ok) {
      csv = await res.text();
      AsyncStorage.setItem('specCsv', csv).catch(() => {});
    }
  } catch {}
  csv ??= await AsyncStorage.getItem('specCsv');
  const table = new Map<string, string>();
  for (const line of (csv ?? '').split(/\r?\n/)) {
    const [eoj, , model, spec] = line.split(',');
    if (eoj === '0130' && model && spec) table.set(model.trim(), spec.trim());
  }
  return table;
}

