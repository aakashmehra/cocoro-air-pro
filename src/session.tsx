import { createContext, useContext } from 'react';
import type { Device } from './api/types';

type Session = {
  signedIn: boolean;
  setSignedIn: (v: boolean) => void;
  devices: Device[];
  setDevices: (d: Device[]) => void;
  /** The air conditioner the tabs act on (null = let the user pick when there are several). */
  deviceId: string | null;
  setDeviceId: (id: string | null) => void;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside provider');
  return s;
}
