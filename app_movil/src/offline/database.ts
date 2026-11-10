import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { createOfflineStore, type OfflineStore, type SqlAdapter } from './offlineCore';

// Archivo SQLite del dispositivo (Android: /data/data/<paquete>/files/SQLite/stella-offline.db). Contiene solo
// lo descrito en offlineCore.js: perfil, cambios pendientes y copias de lectura; nunca tokens ni tarjetas.
export const OFFLINE_DB_NAME = 'stella-offline.db';

let storePromise: Promise<OfflineStore | null> | null = null;

const adapterFor = (db: SQLite.SQLiteDatabase): SqlAdapter => ({
  exec: (sql) => db.execAsync(sql),
  run: (sql, params = []) => db.runAsync(sql, params as SQLite.SQLiteBindParams),
  get: (sql, params = []) => db.getFirstAsync(sql, params as SQLite.SQLiteBindParams),
  all: (sql, params = []) => db.getAllAsync(sql, params as SQLite.SQLiteBindParams),
});

/**
 * La base local, o null si este entorno no la soporta (web): en ese caso la app funciona como antes,
 * solo con conexión. Nunca lanza.
 */
export function getOfflineStore(): Promise<OfflineStore | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  storePromise ??= (async () => {
    try {
      const db = await SQLite.openDatabaseAsync(OFFLINE_DB_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL;');
      const store = createOfflineStore({ db: adapterFor(db) });
      await store.init();
      return store;
    } catch (error) {
      console.warn('[offline] SQLite no disponible:', error);
      storePromise = null;
      return null;
    }
  })();
  return storePromise;
}
