// La configuración de la app sigue en app.json; este archivo valida
// EXPO_PUBLIC_API_URL antes de generar un build con Expo/EAS.
const { parseApiBaseUrl } = require('./src/config/apiUrl');

const resolveAppEnv = () => {
  const appEnv = (process.env.APP_ENV || '').trim();

  if (appEnv) return appEnv;

  return process.env.NODE_ENV === 'production'
    ? 'production'
    : 'development';
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
          'Defínela con la URL pública https de la API terminada en /api/v1. ' +
          'Puedes configurarla en .env.production o en las variables de EAS.\n' +
          'Para trabajar contra la API local usa APP_ENV=development.'
      );
    }
  }

  const existingPlugins = Array.isArray(config.plugins)
    ? config.plugins
    : [];

  const sqliteAlreadyConfigured = existingPlugins.some((plugin) =>
    typeof plugin === 'string'
      ? plugin === 'expo-sqlite'
      : Array.isArray(plugin) && plugin[0] === 'expo-sqlite'
  );

  return {
    ...config,
    plugins: sqliteAlreadyConfigured
      ? existingPlugins
      : [...existingPlugins, 'expo-sqlite'],
  };
};