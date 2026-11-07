// La configuración de la app sigue en app.json; este archivo solo valida EXPO_PUBLIC_API_URL
// antes de que Expo/EAS genere un build, para que un release nunca apunte a una IP de desarrollo.
const { parseApiBaseUrl } = require('./src/config/apiUrl');

// APP_ENV lo fija cada perfil de eas.json (development | preview | production), así EAS Build no
// depende del modo del comando. Sin él manda NODE_ENV: `expo export` evalúa este archivo con
// production; `expo start` y `expo config` (comprobado en SDK 58) con development.
const resolveAppEnv = () => {
  const appEnv = (process.env.APP_ENV || '').trim();
  if (appEnv) return appEnv;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
};

module.exports = ({ config }) => {
  const appEnv = resolveAppEnv();
  const production = appEnv !== 'development';
  const rawUrl = process.env.EXPO_PUBLIC_API_URL;

  if (rawUrl || production) {
    const parsed = rawUrl
      ? parseApiBaseUrl(rawUrl, { production })
      : { ok: false, error: 'la variable no está definida' };
    if (!parsed.ok) {
      throw new Error(
        `[app.config] EXPO_PUBLIC_API_URL no es válida para APP_ENV=${appEnv}: ${parsed.error}.\n` +
          'Defínela con la URL pública https de la API (terminada en /api/v1), por ejemplo en ' +
          '.env.production o en las variables del entorno de EAS. Ver .env.example.\n' +
          'Para trabajar contra la API local usa `npx expo start` (modo desarrollo) o APP_ENV=development.'
      );
    }
  }

  return config;
};
