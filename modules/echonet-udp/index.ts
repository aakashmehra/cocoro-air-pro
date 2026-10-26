// Local-network transport: ECHONET Lite over UDP, plus Wi-Fi-only HTTP for setup. Null in Expo Go.
import { requireOptionalNativeModule } from 'expo';

type EchonetUdp = {
  /** Sends `hex` to UDP 3610 on each host; resolves with "ip hex" replies (stops early after `stopAfter`, 0 = wait full timeout). */
  exchange(hosts: string[], hex: string, timeoutMs: number, stopAfter: number): Promise<string[]>;
  /** HTTP over Wi-Fi only (never mobile data), for first-time setup. headers = [name, value, ...]; resolves [status, body hex]. */
  http(method: string, url: string, headers: string[], bodyHex: string, timeoutMs: number): Promise<[string, string]>;
  /** Saves the actions the Shortcuts "Run air conditioner action" can run (JSON, see src/shortcuts.ts). */
  setShortcutData(json: string): void;
  /** JSON {actionId: ISO time} of the last run of each action from Shortcuts. */
  shortcutRuns(): string;
  /** The phone's Wi-Fi IPv4 address, or null when not on Wi-Fi. */
  localIp(): string | null;
};

export default requireOptionalNativeModule<EchonetUdp>('EchonetUdp');
