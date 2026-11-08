// Avisos internos del modo sin conexión (sin datos: cada pantalla vuelve a leer lo que necesita)
type Topic = 'profile' | 'copy' | 'server-profile';

const listeners: Record<Topic, Set<(payload?: unknown) => void>> = { profile: new Set(), copy: new Set(), 'server-profile': new Set() };

export function emitOffline(topic: Topic, payload?: unknown): void {
  listeners[topic].forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // ignore
    }
  });
}

export function onOffline(topic: Topic, listener: (payload?: unknown) => void): () => void {
  listeners[topic].add(listener);
  return () => listeners[topic].delete(listener);
}
