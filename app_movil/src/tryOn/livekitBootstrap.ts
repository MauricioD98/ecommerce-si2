// LiveKit para React Native: el SDK de Decart transmite el video por LiveKit y necesita sus globales de
// WebRTC registradas ANTES de cualquier llamada realtime (README de @decartai/sdk, "React Native / Expo").
// index.ts importa este módulo antes que la app.
//
// En Expo Go no existe el módulo nativo de WebRTC: el require falla y la app sigue funcionando; el
// probador en vivo avisa que necesita un development build en vez de romperse.

let available = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerGlobals } = require('@livekit/react-native') as typeof import('@livekit/react-native');
  registerGlobals();
  available = true;
} catch {
  available = false;
}

export const isLiveTryOnAvailable = (): boolean => available;
