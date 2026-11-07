import { X509Certificate, createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from 'crypto';
import { AttestationError } from './attestation-error';
import { CborValue, decodeCbor, findExtensionValue, readTlv } from './cbor';

// Verificación de Apple App Attest del lado del servidor, según "Validating apps that connect to your
// server" (developer.apple.com/documentation/devicecheck). Sin dependencias: CBOR y DER mínimos
// propios + node:crypto para la cadena X.509 y ECDSA P-256.

// 1.2.840.113635.100.8.2: extensión del certificado hoja con el nonce de la atestación
const NONCE_OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
const AAGUID_PRODUCTION = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from('appattestdevelop');

const sha256 = (...parts: Buffer[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

const field = (map: CborValue, key: string): CborValue =>
  map instanceof Map ? map.get(key) : undefined;

interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  aaguid?: Buffer;
  credentialId?: Buffer;
}

function parseAuthData(authData: Buffer, withCredential: boolean): AuthData {
  if (authData.length < 37) throw new AttestationError('authData demasiado corto');
  const parsed: AuthData = {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32],
    signCount: authData.readUInt32BE(33),
  };
  if (withCredential) {
    if (authData.length < 55) throw new AttestationError('authData sin datos de credencial');
    parsed.aaguid = authData.subarray(37, 53);
    const idLength = authData.readUInt16BE(53);
    if (authData.length < 55 + idLength) throw new AttestationError('credentialId truncado');
    parsed.credentialId = authData.subarray(55, 55 + idLength);
  }
  return parsed;
}

function decodeBase64(value: string, what: string): Buffer {
  const buf = Buffer.from(value, 'base64');
  if (buf.length === 0) throw new AttestationError(`${what} vacío o no es base64`);
  return buf;
}

// Punto público sin comprimir (0x04 ‖ X ‖ Y): su SHA-256 es el keyId que entrega el SO
function uncompressedPoint(cert: X509Certificate): Buffer {
  const jwk = cert.publicKey.export({ format: 'jwk' }) as { crv?: string; x?: string; y?: string };
  if (jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new AttestationError('la clave del certificado no es P-256');
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}

function extractNonce(leaf: X509Certificate): Buffer {
  const value = findExtensionValue(leaf.raw, NONCE_OID);
  if (!value) throw new AttestationError('el certificado no trae la extensión de nonce');
  // SEQUENCE { [1] EXPLICIT OCTET STRING nonce }
  const seq = readTlv(value, 0);
  if (seq.tag !== 0x30) throw new AttestationError('extensión de nonce malformada');
  const tagged = readTlv(value, seq.start);
  if (tagged.tag !== 0xa1) throw new AttestationError('extensión de nonce malformada');
  const octets = readTlv(value, tagged.start);
  if (octets.tag !== 0x04) throw new AttestationError('extensión de nonce malformada');
  return value.subarray(octets.start, octets.end);
}

function assertValidAt(cert: X509Certificate, now: Date, what: string) {
  if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
    throw new AttestationError(`certificado ${what} fuera de vigencia`);
  }
}

export interface AttestationInput {
  attestation: string; // base64 del objeto CBOR que devuelve attestKeyAsync
  keyId: string; // base64, el que devolvió generateKeyAsync
  clientData: string; // boundClientData(...): lo que la app pasó como challenge
  appId: string;
  rootCaPem: string;
  allowDevelopmentEnvironment: boolean;
  now?: Date;
}

export interface AttestedKey {
  keyId: string;
  publicKeyPem: string;
  signCount: number;
  environment: 'production' | 'development';
}

export function verifyAppAttestAttestation(input: AttestationInput): AttestedKey {
  const now = input.now ?? new Date();
  let decoded: CborValue;
  try {
    decoded = decodeCbor(decodeBase64(input.attestation, 'attestation'));
  } catch (error) {
    if (error instanceof AttestationError) throw error;
    throw new AttestationError(`attestation no es CBOR válido: ${(error as Error).message}`);
  }

  if (field(decoded, 'fmt') !== 'apple-appattest') throw new AttestationError('fmt distinto de apple-appattest');
  const attStmt = field(decoded, 'attStmt');
  const x5c = field(attStmt, 'x5c');
  const authDataRaw = field(decoded, 'authData');
  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every(Buffer.isBuffer) || !Buffer.isBuffer(authDataRaw)) {
    throw new AttestationError('attestation sin x5c o authData');
  }

  // 1. Cadena: hoja ← intermedio ← raíz de Apple configurada
  let leaf: X509Certificate, intermediate: X509Certificate, root: X509Certificate;
  try {
    leaf = new X509Certificate(x5c[0] as Buffer);
    intermediate = new X509Certificate(x5c[1] as Buffer);
    root = new X509Certificate(input.rootCaPem);
  } catch {
    throw new AttestationError('certificados ilegibles');
  }
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) {
    throw new AttestationError('la hoja no está firmada por el intermedio');
  }
  if (!intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) {
    throw new AttestationError('el intermedio no está firmado por la raíz de Apple');
  }
  assertValidAt(leaf, now, 'hoja');
  assertValidAt(intermediate, now, 'intermedio');

  // 2-4. nonce = SHA256(authData ‖ SHA256(clientData)) debe coincidir con la extensión de la hoja
  const clientDataHash = sha256(Buffer.from(input.clientData, 'utf8'));
  const expectedNonce = sha256(authDataRaw, clientDataHash);
  if (!sameBytes(extractNonce(leaf), expectedNonce)) throw new AttestationError('nonce no coincide (desafío distinto)');

  // 5. keyId = SHA256(clave pública de la hoja)
  const keyIdBytes = decodeBase64(input.keyId, 'keyId');
  if (!sameBytes(sha256(uncompressedPoint(leaf)), keyIdBytes)) throw new AttestationError('keyId no corresponde al certificado');

  // 6-9. authData: app correcta, contador en 0, entorno y credencial = keyId
  const auth = parseAuthData(authDataRaw, true);
  if (!sameBytes(auth.rpIdHash, sha256(Buffer.from(input.appId, 'utf8')))) throw new AttestationError('rpIdHash de otra app');
  if (auth.signCount !== 0) throw new AttestationError('contador inicial distinto de 0');
  let environment: AttestedKey['environment'];
  if (sameBytes(auth.aaguid!, AAGUID_PRODUCTION)) environment = 'production';
  else if (sameBytes(auth.aaguid!, AAGUID_DEVELOPMENT) && input.allowDevelopmentEnvironment) environment = 'development';
  else throw new AttestationError('aaguid no permitido (entorno de desarrollo o desconocido)');
  if (!sameBytes(auth.credentialId!, keyIdBytes)) throw new AttestationError('credentialId distinto de keyId');

  return {
    keyId: keyIdBytes.toString('base64'),
    publicKeyPem: leaf.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    signCount: 0,
    environment,
  };
}

export interface AssertionInput {
  assertion: string; // base64 del CBOR que devuelve generateAssertionAsync
  clientData: string;
  publicKeyPem: string;
  storedSignCount: number;
  appId: string;
}

/** Devuelve el contador nuevo; el llamador lo persiste solo si sigue siendo mayor (UPDATE condicionado). */
export function verifyAppAttestAssertion(input: AssertionInput): { signCount: number } {
  let decoded: CborValue;
  try {
    decoded = decodeCbor(decodeBase64(input.assertion, 'assertion'));
  } catch (error) {
    if (error instanceof AttestationError) throw error;
    throw new AttestationError(`assertion no es CBOR válido: ${(error as Error).message}`);
  }
  const signature = field(decoded, 'signature');
  const authenticatorData = field(decoded, 'authenticatorData');
  if (!Buffer.isBuffer(signature) || !Buffer.isBuffer(authenticatorData)) throw new AttestationError('assertion incompleta');

  const nonce = sha256(authenticatorData, sha256(Buffer.from(input.clientData, 'utf8')));
  let valid = false;
  try {
    valid = verifySignature('sha256', nonce, createPublicKey(input.publicKeyPem), signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new AttestationError('firma de la aserción inválida');

  const auth = parseAuthData(authenticatorData, false);
  if (!sameBytes(auth.rpIdHash, sha256(Buffer.from(input.appId, 'utf8')))) throw new AttestationError('rpIdHash de otra app');
  if (auth.signCount <= input.storedSignCount) throw new AttestationError('contador no creció (aserción repetida)');
  return { signCount: auth.signCount };
}
