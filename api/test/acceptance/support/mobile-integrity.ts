import { X509Certificate, createHash, createVerify, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dobles de prueba de los proveedores de integridad. NO son la verificación real: Google y Apple se
// reemplazan por un Google falso (misma API HTTP) y por una CA propia generada con openssl. Lo que
// sí es real es todo el código del servidor que valida esas respuestas.

const sha256 = (...parts: Buffer[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

// ---- CBOR (encoder mínimo, solo para armar objetos de App Attest) ---------------------------------
function head(major: number, len: number): Buffer {
  if (len < 24) return Buffer.from([(major << 5) | len]);
  if (len < 256) return Buffer.from([(major << 5) | 24, len]);
  if (len < 65536) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(len, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(len, 1);
  return b;
}
export function encodeCbor(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, b.length), b]);
  }
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [encodeCbor(k), encodeCbor(v)])]);
  }
  throw new Error('tipo CBOR no soportado en el test');
}

// ---- Apple App Attest con una CA de prueba ------------------------------------------------------
export function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export class FakeAppAttestCa {
  readonly dir = mkdtempSync(join(tmpdir(), 'appattest-'));
  readonly rootPem: string;
  private readonly interPem: string;

  constructor() {
    const run = (...args: string[]) => execFileSync('openssl', args, { cwd: this.dir, stdio: 'pipe' });
    const ec = (out: string) => run('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', out);
    writeFileSync(join(this.dir, 'ca.cnf'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
    ec('root.key');
    run('req', '-x509', '-new', '-key', 'root.key', '-subj', '/CN=Test App Attestation Root CA', '-days', '2', '-out', 'root.pem',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    ec('inter.key');
    run('req', '-new', '-key', 'inter.key', '-subj', '/CN=Test App Attestation CA 1', '-out', 'inter.csr');
    run('x509', '-req', '-in', 'inter.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '1', '-extfile', 'ca.cnf', '-out', 'inter.pem');
    this.rootPem = readFileSync(join(this.dir, 'root.pem'), 'utf8');
    this.interPem = readFileSync(join(this.dir, 'inter.pem'), 'utf8');
  }

  /** Certificado hoja para `publicKey` con el nonce de App Attest en la extensión 1.2.840.113635.100.8.2 */
  leafFor(privateKey: KeyObject, nonce: Buffer): Buffer {
    const run = (...args: string[]) => execFileSync('openssl', args, { cwd: this.dir, stdio: 'pipe' });
    writeFileSync(join(this.dir, 'leaf.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    writeFileSync(join(this.dir, 'leaf.cnf'), `1.2.840.113635.100.8.2=DER:3024a1220420${nonce.toString('hex')}\n`);
    run('req', '-new', '-key', 'leaf.key', '-subj', '/CN=leaf', '-out', 'leaf.csr');
    run('x509', '-req', '-in', 'leaf.csr', '-CA', 'inter.pem', '-CAkey', 'inter.key', '-CAcreateserial', '-days', '1', '-extfile', 'leaf.cnf', '-out', 'leaf.pem');
    return new X509Certificate(readFileSync(join(this.dir, 'leaf.pem'))).raw;
  }

  get interDer(): Buffer {
    return new X509Certificate(this.interPem).raw;
  }

  dispose() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export interface FakeDeviceKey {
  keyId: string;
  privateKey: KeyObject;
  counter: number;
}

export function newDeviceKey(): FakeDeviceKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { keyId: sha256(point).toString('base64'), privateKey, counter: 0 };
}

const AAGUID = {
  production: Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]),
  development: Buffer.from('appattestdevelop'),
};

export function attestKey(ca: FakeAppAttestCa, key: FakeDeviceKey, appId: string, clientData: string, env: 'production' | 'development' = 'production'): string {
  const keyIdBytes = Buffer.from(key.keyId, 'base64');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(keyIdBytes.length);
  const authData = Buffer.concat([
    sha256(Buffer.from(appId)),
    Buffer.from([0x40]),
    Buffer.alloc(4), // contador 0
    AAGUID[env],
    len,
    keyIdBytes,
    encodeCbor({ kty: 2 }), // COSE key (el servidor no la usa: toma la del certificado)
  ]);
  const nonce = sha256(authData, sha256(Buffer.from(clientData)));
  const leaf = ca.leafFor(key.privateKey, nonce);
  return encodeCbor({ fmt: 'apple-appattest', attStmt: { x5c: [leaf, ca.interDer], receipt: Buffer.from('receipt') }, authData }).toString('base64');
}

export function assertWith(key: FakeDeviceKey, appId: string, clientData: string, counter = key.counter + 1): string {
  key.counter = counter;
  const c = Buffer.alloc(4);
  c.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([sha256(Buffer.from(appId)), Buffer.from([0x00]), c]);
  const nonce = sha256(authenticatorData, sha256(Buffer.from(clientData)));
  const signature = sign('sha256', nonce, key.privateKey);
  return encodeCbor({ signature, authenticatorData }).toString('base64');
}

// ---- Google Play Integrity falso ----------------------------------------------------------------
export function fakeServiceAccount() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    json: JSON.stringify({
      client_email: 'integrity@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://oauth2.test.invalid/token',
    }),
    publicKey,
  };
}

/** El "token" del test es el veredicto en JSON/base64url: el Google falso solo lo devuelve. */
export const fakeIntegrityToken = (payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64url');

export function fakeGoogle(serviceAccountPublicKey: KeyObject) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push(url);
    if (url === 'https://oauth2.test.invalid/token') {
      const assertion = new URLSearchParams(init.body).get('assertion') ?? '';
      const [h, p, s] = assertion.split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(serviceAccountPublicKey, Buffer.from(s, 'base64url'));
      return { ok, status: ok ? 200 : 401, json: async () => ({ access_token: 'fake-access', expires_in: 3600 }) };
    }
    if (url.includes(':decodeIntegrityToken')) {
      if (init.headers.authorization !== 'Bearer fake-access') return { ok: false, status: 401, json: async () => ({}) };
      try {
        const payload = JSON.parse(Buffer.from(JSON.parse(init.body).integrity_token, 'base64url').toString('utf8'));
        return { ok: true, status: 200, json: async () => ({ tokenPayloadExternal: payload }) };
      } catch {
        return { ok: false, status: 400, json: async () => ({}) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

export const ANDROID_PACKAGE = 'com.novasoft.stellafemme';
export const ANDROID_CERT = Buffer.alloc(32, 7).toString('base64url');

export function goodVerdict(requestHash: string, overrides: Record<string, any> = {}) {
  return {
    requestDetails: { requestPackageName: ANDROID_PACKAGE, requestHash, timestampMillis: String(Date.now()), ...overrides.requestDetails },
    appIntegrity: {
      appRecognitionVerdict: 'PLAY_RECOGNIZED',
      packageName: ANDROID_PACKAGE,
      certificateSha256Digest: [ANDROID_CERT],
      versionCode: '1',
      ...overrides.appIntegrity,
    },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'], ...overrides.deviceIntegrity },
    accountDetails: { appLicensingVerdict: 'LICENSED', ...overrides.accountDetails },
  };
}
