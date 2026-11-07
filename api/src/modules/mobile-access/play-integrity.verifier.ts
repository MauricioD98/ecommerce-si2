import { createSign, timingSafeEqual } from 'crypto';
import { AttestationError, AttestationProviderError } from './attestation-error';
import { DEVICE_VERDICTS, PlayIntegrityConfig } from './mobile-access.config';

// Google Play Integrity, "standard request": la app pide un token con requestHash y el servidor lo
// descifra con la API de Google (playintegrity.googleapis.com) usando una cuenta de servicio del
// proyecto de Cloud vinculado en Play Console. El veredicto lo evalúa evaluatePlayIntegrityVerdict.

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

const SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const PROVIDER_TIMEOUT_MS = 8_000;

export interface PlayIntegrityPayload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string | number };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[] };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Google entrega el digest en base64url sin relleno; se compara normalizado por si se configuró con
// relleno o en base64 estándar.
const normalizeDigest = (d: string) => Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64url');

/** Reglas sobre el veredicto ya descifrado. Pura: la cubren las pruebas sin hablar con Google. */
export function evaluatePlayIntegrityVerdict(
  payload: PlayIntegrityPayload,
  expected: { requestHash: string; now?: number },
  config: Pick<PlayIntegrityConfig, 'packageName' | 'certSha256' | 'minDeviceVerdict' | 'requireLicensed' | 'maxTokenAgeMs'>,
): void {
  const now = expected.now ?? Date.now();
  const req = payload.requestDetails;
  if (!req) throw new AttestationError('veredicto sin requestDetails');
  if (req.requestPackageName !== config.packageName) throw new AttestationError('requestPackageName de otra app');
  if (!req.requestHash || !safeEqual(req.requestHash, expected.requestHash)) {
    throw new AttestationError('requestHash no coincide (desafío distinto o de otra tienda)');
  }
  const ts = Number(req.timestampMillis);
  if (!Number.isFinite(ts) || now - ts > config.maxTokenAgeMs || ts - now > 60_000) {
    throw new AttestationError('token de integridad vencido o con fecha futura');
  }

  const app = payload.appIntegrity;
  if (app?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
    throw new AttestationError(`app no reconocida por Play (${app?.appRecognitionVerdict ?? 'sin veredicto'})`);
  }
  if (app.packageName !== config.packageName) throw new AttestationError('packageName de otra app');
  if (config.certSha256.length > 0) {
    const allowed = new Set(config.certSha256.map(normalizeDigest));
    if (!(app.certificateSha256Digest ?? []).some((d) => allowed.has(normalizeDigest(d)))) {
      throw new AttestationError('certificado de firma no permitido');
    }
  }

  // Cada nivel incluye a los más débiles: MEETS_STRONG implica DEVICE y BASIC
  const verdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const minIndex = DEVICE_VERDICTS.indexOf(config.minDeviceVerdict);
  if (!verdicts.some((v) => DEVICE_VERDICTS.indexOf(v as never) >= minIndex)) {
    throw new AttestationError(`dispositivo no cumple ${config.minDeviceVerdict} (${verdicts.join(',') || 'sin veredicto'})`);
  }

  if (config.requireLicensed && payload.accountDetails?.appLicensingVerdict !== 'LICENSED') {
    throw new AttestationError('app no instalada desde Play (licencia)');
  }
}

export class PlayIntegrityClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: PlayIntegrityConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async decode(integrityToken: string): Promise<PlayIntegrityPayload> {
    const token = await this.getAccessToken();
    const url = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(this.config.packageName)}:decodeIntegrityToken`;
    const res = await this.call(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ integrity_token: integrityToken }),
    });
    // 400 = token malformado, de otra app o ya no descifrable: es un fallo del dispositivo, no de Google
    if (res.status === 400) throw new AttestationError('Google rechazó el token de integridad');
    if (!res.ok) throw new AttestationProviderError(`decodeIntegrityToken respondió ${res.status}`);
    const body = await res.json();
    if (!body?.tokenPayloadExternal) throw new AttestationProviderError('respuesta de Google sin tokenPayloadExternal');
    return body.tokenPayloadExternal as PlayIntegrityPayload;
  }

  // OAuth 2.0 con JWT de cuenta de servicio (RFC 7523), sin depender de googleapis
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > Date.now()) return this.accessToken.value;
    const { clientEmail, privateKey, tokenUri } = this.config.serviceAccount;
    const iat = Math.floor(Date.now() / 1000);
    const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: clientEmail, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 })}`;
    let signature: string;
    try {
      signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
    } catch {
      throw new AttestationProviderError('no se pudo firmar con la clave de la cuenta de servicio');
    }

    const res = await this.call(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    });
    if (!res.ok) throw new AttestationProviderError(`OAuth de Google respondió ${res.status}`);
    const body = await res.json();
    if (!body?.access_token) throw new AttestationProviderError('OAuth de Google sin access_token');
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private async call(url: string, init: Parameters<FetchLike>[1]) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new AttestationProviderError('Google no respondió a tiempo')), PROVIDER_TIMEOUT_MS).unref(),
    );
    try {
      return await Promise.race([this.fetchImpl(url, init), timeout]);
    } catch (error) {
      if (error instanceof AttestationProviderError) throw error;
      throw new AttestationProviderError(`error de red con Google: ${(error as Error).message}`);
    }
  }
}
