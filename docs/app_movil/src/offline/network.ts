import { useEffect, useState } from 'react';
import * as Network from 'expo-network';

// Estado de la red del teléfono. Se usa `isConnected` (hay Wi-Fi/datos) y NO `isInternetReachable`: en
// desarrollo la API vive en la red local y un Wi-Fi sin salida a Internet igual llega a ella.
// Es solo una pista para la interfaz; lo que decide si algo se envió es la respuesta del servidor.

let online = true;
const listeners = new Set<(online: boolean) => void>();

const set = (next: boolean) => {
  if (next === online) return;
  online = next;
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch {
      // ignore
    }
  });
};

const fromState = (state: Network.NetworkState) => state.isConnected !== false;

let started = false;
function start() {
  if (started) return;
  started = true;
  Network.getNetworkStateAsync()
    .then((state) => set(fromState(state)))
    .catch(() => undefined);
  Network.addNetworkStateListener((state) => set(fromState(state)));
}

export const isOnlineNow = (): boolean => {
  start();
  return online;
};

/** Consulta fresca (para decisiones como no iniciar una compra sin red) */
export async function checkOnline(): Promise<boolean> {
  start();
  try {
    set(fromState(await Network.getNetworkStateAsync()));
  } catch {
    // se usa el último estado conocido
  }
  return online;
}

export function onNetworkChange(listener: (online: boolean) => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsOnline(): boolean {
  const [value, setValue] = useState(isOnlineNow);
  useEffect(() => {
    setValue(isOnlineNow());
    return onNetworkChange(setValue);
  }, []);
  return value;
}
