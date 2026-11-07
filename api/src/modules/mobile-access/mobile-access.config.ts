import { createHash } from 'crypto';

// Configuración del canal móvil. Se lee del entorno en cada uso (no al arrancar) para que las pruebas
// puedan cambiarla y para que una variable mal cargada falle en la verificación, no tumbe la API.
//
// Regla de seguridad: sin configuración válida de un proveedor, las pruebas de esa plataforma se
// RECHAZAN (fail closed). El atajo de desarrollo solo existe con NODE_ENV=development|test.

export type MobilePlatform = 'android' | 'ios' | 'development';
export type AttestationMethod = 'play-integrity' | 'app-attest' | 'development-bypass';

// Orden de fuerza de los veredictos de dispositivo de Play Integrity
export const DEVICE_VERDICTS = ['MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY'] as const;
export type DeviceVerdict = (typeof DEVICE_VERDICTS)[number];

export interface PlayIntegrityConfig {
  packageName: string;
  serviceAccount: { clientEmail: string; privateKey: string; tokenUri: string };
  // SHA-256 del certificado de firma de la app (el de Play App Signing), base64url como lo da Google
  certSha256: string[];
  minDeviceVerdict: DeviceVerdict;
  requireLicensed: boolean;
  maxTokenAgeMs: number;
}

export interface AppAttestConfig {
  // "<TEAM_ID>.<bundle id>": de acá sale el rpIdHash que Apple pone en authData
  appId: string;
  rootCaPem: string;
  // Las claves de un build de desarrollo (aaguid "appattestdevelop") solo valen si se habilita
  allowDevelopmentEnvironment: boolean;
}

export interface MobileAccessConfig {
  developmentBypass: boolean;
  challengeTtlMs: number;
  // Cada cuánto el refresh de una sesión móvil exige una prueba de integridad nueva
  reattestAfterMs: number;
  android: PlayIntegrityConfig | null;
  androidError: string | null;
  ios: AppAttestConfig | null;
  iosError: string | null;
}

const DEV_ENVS = new Set(['development', 'test']);

/** true solo si se pidió explícitamente Y el entorno no es productivo. */
export function isDevelopmentBypassAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MOBILE_ATTESTATION_DEV_BYPASS?.trim().toLowerCase() === 'true' && DEV_ENVS.has(env.NODE_ENV?.trim() ?? '');
}

const positiveInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const list = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

// PEM en la variable (con \n escapados, como suele quedar en un secret) o en base64
const readPem = (raw: string | undefined): string | null => {
  const value = raw?.trim();
  if (!value) return null;
  if (value.includes('-----BEGIN')) return value.replace(/\\n/g, '\n');
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  return decoded.includes('-----BEGIN') ? decoded : null;
};

function loadAndroid(env: NodeJS.ProcessEnv): { config: PlayIntegrityConfig | null; error: string | null } {
  const packageName = env.PLAY_INTEGRITY_PACKAGE_NAME?.trim();
  const rawAccount = env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON?.trim();
  if (!packageName && !rawAccount) return { config: null, error: 'Play Integrity no configurado' };
  if (!packageName) return { config: null, error: 'Falta PLAY_INTEGRITY_PACKAGE_NAME' };
  if (!rawAccount) return { config: null, error: 'Falta PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON' };

  let account: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    const json = rawAccount.startsWith('{') ? rawAccount : Buffer.from(rawAccount, 'base64').toString('utf8');
    account = JSON.parse(json);
  } catch {
    return { config: null, error: 'PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON no es un JSON válido (ni en base64)' };
  }
  if (!account.client_email || !account.private_key?.includes('PRIVATE KEY')) {
    return { config: null, error: 'La cuenta de servicio de Play Integrity no tiene client_email/private_key' };
  }

  const certSha256 = list(env.PLAY_INTEGRITY_CERT_SHA256);
  // En producción se exige fijar el certificado: sin él, cualquier APK reconocido por Play con el
  // mismo package name (p. ej. un build de otra cuenta en un track de prueba) pasaría.
  if (certSha256.length === 0 && env.NODE_ENV === 'production') {
    return { config: null, error: 'Falta PLAY_INTEGRITY_CERT_SHA256 (obligatorio en producción)' };
  }

  const verdict = (env.PLAY_INTEGRITY_MIN_DEVICE_VERDICT?.trim().toUpperCase() || 'MEETS_DEVICE_INTEGRITY') as DeviceVerdict;
  if (!DEVICE_VERDICTS.includes(verdict)) {
    return { config: null, error: `PLAY_INTEGRITY_MIN_DEVICE_VERDICT inválido: ${verdict}` };
  }

  return {
    config: {
      packageName,
      serviceAccount: {
        clientEmail: account.client_email,
        privateKey: account.private_key.replace(/\\n/g, '\n'),
        tokenUri: account.token_uri || 'https://oauth2.googleapis.com/token',
      },
      certSha256,
      minDeviceVerdict: verdict,
      requireLicensed: env.PLAY_INTEGRITY_REQUIRE_LICENSED?.trim().toLowerCase() === 'true',
      maxTokenAgeMs: positiveInt(env.PLAY_INTEGRITY_MAX_TOKEN_AGE_MS, 5 * 60_000),
    },
    error: null,
  };
}

function loadIos(env: NodeJS.ProcessEnv): { config: AppAttestConfig | null; error: string | null } {
  const appId = env.APP_ATTEST_APP_ID?.trim();
  const rawRoot = env.APP_ATTEST_ROOT_CA_PEM;
  if (!appId && !rawRoot) return { config: null, error: 'App Attest no configurado' };
  if (!appId || !/^[A-Z0-9]{10}\.[\w.-]+$/.test(appId)) {
    return { config: null, error: 'APP_ATTEST_APP_ID debe ser "<TEAM_ID>.<bundle id>"' };
  }
  const rootCaPem = readPem(rawRoot);
  if (!rootCaPem) return { config: null, error: 'Falta APP_ATTEST_ROOT_CA_PEM (raíz "Apple App Attestation Root CA")' };
  return {
    config: {
      appId,
      rootCaPem,
      allowDevelopmentEnvironment:
        env.APP_ATTEST_ALLOW_DEVELOPMENT?.trim().toLowerCase() === 'true' && env.NODE_ENV !== 'production',
    },
    error: null,
  };
}

export function loadMobileAccessConfig(env: NodeJS.ProcessEnv = process.env): MobileAccessConfig {
  const android = loadAndroid(env);
  const ios = loadIos(env);
  return {
    developmentBypass: isDevelopmentBypassAllowed(env),
    challengeTtlMs: positiveInt(env.MOBILE_ATTESTATION_CHALLENGE_TTL_MS, 5 * 60_000),
    reattestAfterMs: positiveInt(env.MOBILE_REATTEST_AFTER_MS, 24 * 60 * 60_000),
    android: android.config,
    androidError: android.error,
    ios: ios.config,
    iosError: ios.error,
  };
}

// Lo que el dispositivo firma / manda a hashear. Incluye la tienda: un desafío emitido para la tienda
// A no produce una prueba válida para la B aunque alguien cambie el x-tenant-id.
export function boundClientData(tenantId: string, challenge: string): string {
  return `stella-mobile-attestation:v1:${tenantId}:${challenge}`;
}

/** requestHash de Play Integrity (standard request): base64url(SHA-256(clientData)). */
export function playIntegrityRequestHash(tenantId: string, challenge: string): string {
  return createHash('sha256').update(boundClientData(tenantId, challenge)).digest('base64url');
}
