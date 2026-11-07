import { Platform } from 'react-native';
import axios from 'axios';
import * as AppIntegrity from '@expo/app-integrity';
import { appStorage } from '../utils/storage';
import { getApiBaseUrl } from '../config/env';
import { TENANT_HEADER, getTenantId } from '../config/tenant';
import { getCurrentLanguage } from '../i18n';
import i18n from 'i18next';

// Prueba de integridad de la app oficial para el canal móvil (POST /auth/mobile/login|register|refresh).
//
// Esto NO autoriza nada por sí solo: la API emite un desafío de un solo uso (solo si el plan de la
// tienda incluye la app), el SDK del sistema (Play Integrity / App Attest) lo firma, y la API lo
// verifica con Google o con la cadena de Apple. Si la app fuera modificada, la prueba no pasa en el
// servidor aunque este código se saltee.
//
// Requisitos de build (no funcionan en Expo Go ni en simuladores con una prueba válida):
//   Android: EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER + app distribuida por Google Play
//   iOS:     capacidad "App Attest" en el App ID (ver app.json → ios.entitlements)

export interface MobileAttestation {
  challengeId: string;
  platform: 'android' | 'ios' | 'development';
  integrityToken?: string;
  keyId?: string;
  attestation?: string;
  assertion?: string;
}

interface ChallengeResponse {
  challengeId: string;
  requestHash: string;
  clientData: string;
  platforms: { android: boolean; ios: boolean; development: boolean };
}

const APP_ATTEST_KEY_ID = '@app_attest_key_id';
const APP_ATTEST_KEY_ATTESTED = '@app_attest_key_attested';
export const APP_ATTEST_KEY_UNKNOWN = 'APP_ATTEST_KEY_UNKNOWN';

/** El dispositivo o el build no pueden producir una prueba: no tiene sentido reintentar. */
export class MobileAttestationUnavailableError extends Error {}

const unavailable = (key: string) => new MobileAttestationUnavailableError(i18n.t(`mobileAccess.${key}`));

// Atajo de desarrollo: solo en __DEV__ y solo si la API también lo permite (NODE_ENV no productivo +
// MOBILE_ATTESTATION_DEV_BYPASS=true). Un build de release nunca lo usa.
const devBypassRequested = () => __DEV__ && process.env.EXPO_PUBLIC_MOBILE_ATTESTATION_DEV_BYPASS === 'true';

// axios sin interceptores (como el refresh de client.ts): evita el ciclo client → attestation → client
async function fetchChallenge(): Promise<ChallengeResponse> {
  const [baseUrl, tenantId] = await Promise.all([getApiBaseUrl(), getTenantId()]);
  if (!tenantId) throw unavailable('noStore');
  const { data } = await axios.post<ChallengeResponse>(
    `${baseUrl}/auth/mobile/challenge`,
    {},
    { timeout: 15000, headers: { [TENANT_HEADER]: tenantId, 'Accept-Language': getCurrentLanguage() } }
  );
  return data;
}

let androidProvider: Promise<void> | null = null;

async function androidIntegrityToken(requestHash: string): Promise<string> {
  const cloudProjectNumber = process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER?.trim();
  if (!cloudProjectNumber) throw unavailable('notConfigured');
  const prepare = () => {
    androidProvider = AppIntegrity.prepareIntegrityTokenProviderAsync(cloudProjectNumber).catch((error) => {
      androidProvider = null;
      throw error;
    });
    return androidProvider;
  };
  try {
    await (androidProvider ?? prepare());
    return await AppIntegrity.requestIntegrityCheckAsync(requestHash);
  } catch (error) {
    // El proveedor vence si se guarda mucho tiempo: se prepara de nuevo una vez
    if ((error as { code?: string })?.code === 'ERR_APP_INTEGRITY_PROVIDER_INVALID') {
      await prepare();
      return AppIntegrity.requestIntegrityCheckAsync(requestHash);
    }
    throw unavailable('deviceUnsupported');
  }
}

async function iosProof(challenge: ChallengeResponse): Promise<MobileAttestation> {
  if (!AppIntegrity.isSupported) throw unavailable('deviceUnsupported');
  let keyId = await appStorage.getItem(APP_ATTEST_KEY_ID);
  if (!keyId) {
    keyId = await AppIntegrity.generateKeyAsync();
    await appStorage.setItem(APP_ATTEST_KEY_ID, keyId);
    await appStorage.removeItem(APP_ATTEST_KEY_ATTESTED);
  }

  if (await appStorage.getItem(APP_ATTEST_KEY_ATTESTED)) {
    const assertion = await AppIntegrity.generateAssertionAsync(keyId, challenge.clientData);
    return { challengeId: challenge.challengeId, platform: 'ios', keyId, assertion };
  }

  try {
    const attestation = await AppIntegrity.attestKeyAsync(keyId, challenge.clientData);
    // Se marca al enviarla: si el servidor la rechaza, la próxima aserción vuelve con
    // APP_ATTEST_KEY_UNKNOWN y withMobileAttestation regenera la clave.
    await appStorage.setItem(APP_ATTEST_KEY_ATTESTED, '1');
    return { challengeId: challenge.challengeId, platform: 'ios', keyId, attestation };
  } catch (error) {
    // Apple no disponible: se reintenta más tarde con la misma clave. Cualquier otro error invalida la clave.
    if ((error as { code?: string })?.code !== 'ERR_APP_INTEGRITY_SERVER_UNAVAILABLE') await resetAppAttestKey();
    throw unavailable('deviceUnsupported');
  }
}

export async function resetAppAttestKey(): Promise<void> {
  await Promise.all([appStorage.removeItem(APP_ATTEST_KEY_ID), appStorage.removeItem(APP_ATTEST_KEY_ATTESTED)]);
}

/** Pide un desafío a la API y lo hace firmar por el sistema. */
export async function requestMobileAttestation(): Promise<MobileAttestation> {
  const challenge = await fetchChallenge();
  if (devBypassRequested() && challenge.platforms.development) {
    return { challengeId: challenge.challengeId, platform: 'development' };
  }
  if (Platform.OS === 'android') {
    if (!challenge.platforms.android) throw unavailable('serverNotConfigured');
    return { challengeId: challenge.challengeId, platform: 'android', integrityToken: await androidIntegrityToken(challenge.requestHash) };
  }
  if (Platform.OS === 'ios') {
    if (!challenge.platforms.ios) throw unavailable('serverNotConfigured');
    return iosProof(challenge);
  }
  throw unavailable('deviceUnsupported');
}

const responseCode = (error: unknown) =>
  (error as { response?: { data?: { code?: string } } })?.response?.data?.code;

/**
 * Ejecuta `send` con una prueba recién generada. Si la clave de App Attest ya no existe en el
 * servidor (reinstalación, base limpia), genera y atestigua otra y reintenta una vez.
 */
export async function withMobileAttestation<T>(send: (attestation: MobileAttestation) => Promise<T>): Promise<T> {
  try {
    return await send(await requestMobileAttestation());
  } catch (error) {
    if (responseCode(error) !== APP_ATTEST_KEY_UNKNOWN) throw error;
    await resetAppAttestKey();
    return send(await requestMobileAttestation());
  }
}
