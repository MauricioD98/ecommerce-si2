import { X509Certificate, timingSafeEqual } from 'crypto';
import { AttestationError, AttestationProviderError } from './attestation-error';
import type { FetchLike } from './play-integrity.verifier';

// Android Key Attestation (developer.android.com/privacy-and-security/security-key-attestation).
//
// Sirve para la APK distribuida FUERA de Google Play (EAS "preview", descarga directa), donde Play
// Integrity nunca devuelve PLAY_RECOGNIZED. La app genera una clave en el TEE/StrongBox con el
// desafío del servidor; el hardware firma un certificado que describe la app que pidió la clave
// (package + SHA-256 del certificado de firma del APK) y el estado del arranque verificado. La cadena
// termina en una raíz de Google configurada en el servidor. Una APK re-firmada por otro, un
// dispositivo con bootloader desbloqueado o un keystore por software no pasan.

// 1.3.6.1.4.1.11129.2.1.17: KeyDescription en el certificado hoja
const KEY_DESCRIPTION_OID = '1.3.6.1.4.1.11129.2.1.17';
const TAG_ROOT_OF_TRUST = 704;
const TAG_ATTESTATION_APPLICATION_ID = 709;
const SECURITY_LEVEL = ['Software', 'TrustedEnvironment', 'StrongBox'] as const;
const VERIFIED_BOOT_STATE = ['Verified', 'SelfSigned', 'Unverified', 'Failed'] as const;
const MAX_CHAIN = 10;

// ---- DER mínimo con tags de varios bytes (los de AuthorizationList son [704], [709], …) -----------
interface Node {
  cls: number; // 0 universal, 2 context
  constructed: boolean;
  tag: number;
  value: Buffer;
  next: number;
}

function readNode(der: Buffer, offset: number): Node {
  if (offset + 2 > der.length) throw new Error('DER truncado');
  const first = der[offset++];
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let b: number;
    let guard = 0;
    do {
      if (offset >= der.length || ++guard > 4) throw new Error('DER: tag inválido');
      b = der[offset++];
      tag = tag * 128 + (b & 0x7f);
    } while (b & 0x80);
  }
  if (offset >= der.length) throw new Error('DER truncado');
  let len = der[offset++];
  if (len & 0x80) {
    const bytes = len & 0x7f;
    if (bytes === 0 || bytes > 4 || offset + bytes > der.length) throw new Error('DER: longitud inválida');
    len = 0;
    for (let i = 0; i < bytes; i++) len = len * 256 + der[offset + i];
    offset += bytes;
  }
  const end = offset + len;
  if (end > der.length) throw new Error('DER truncado');
  return { cls: first >> 6, constructed: (first & 0x20) !== 0, tag, value: der.subarray(offset, end), next: end };
}

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let at = 0; at < node.value.length; ) {
    const child = readNode(node.value, at);
    out.push(child);
    at = child.next;
  }
  return out;
}

const parse = (der: Buffer) => readNode(der, 0);
const intOf = (n: Node) => {
  if (n.value.length > 6) throw new Error('INTEGER demasiado grande');
  return n.value.reduce((acc, b) => acc * 256 + b, 0);
};
const expect = (n: Node | undefined, tag: number, what: string): Node => {
  if (!n || n.cls !== 0 || n.tag !== tag) throw new AttestationError(`KeyDescription: ${what} malformado`);
  return n;
};

/** Valor de una extensión (OCTET STRING interior) buscándola por OID en el TBSCertificate. */
function extensionValue(cert: X509Certificate, oid: string): Buffer | null {
  const oidDer = encodeOid(oid);
  const certSeq = parse(cert.raw);
  const tbs = children(certSeq)[0];
  const explicitExt = children(tbs).find((n) => n.cls === 2 && n.tag === 3);
  if (!explicitExt) return null;
  for (const ext of children(children(explicitExt)[0])) {
    const parts = children(ext);
    if (parts[0]?.tag === 0x06 && parts[0].value.equals(oidDer)) {
      const octets = parts[parts.length - 1];
      return octets.tag === 0x04 ? octets.value : null;
    }
  }
  return null;
}

function encodeOid(oid: string): Buffer {
  const nums = oid.split('.').map(Number);
  const bytes = [nums[0] * 40 + nums[1]];
  for (const n of nums.slice(2)) {
    const stack = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) stack.unshift((v & 0x7f) | 0x80);
    bytes.push(...stack);
  }
  return Buffer.from(bytes);
}

export interface KeyDescription {
  attestationVersion: number;
  attestationSecurityLevel: (typeof SECURITY_LEVEL)[number];
  challenge: Buffer;
  packages: { name: string; versionCode: number }[];
  signatureDigests: Buffer[];
  rootOfTrust: { deviceLocked: boolean; verifiedBootState: (typeof VERIFIED_BOOT_STATE)[number] } | null;
}

function findTagged(list: Node, tag: number): Node | undefined {
  const found = children(list).find((n) => n.cls === 2 && n.tag === tag);
  return found ? children(found)[0] : undefined;
}

export function parseKeyDescription(extension: Buffer): KeyDescription {
  try {
    const fields = children(parse(extension));
    if (fields.length < 8) throw new AttestationError('KeyDescription incompleta');
    const level = intOf(expect(fields[1], 0x0a, 'attestationSecurityLevel'));
    const softwareEnforced = expect(fields[6], 0x10, 'softwareEnforced');
    const hardwareEnforced = expect(fields[7], 0x10, 'hardwareEnforced');

    // attestationApplicationId: OCTET STRING que contiene SEQUENCE { SET OF PackageInfo, SET OF digest }
    const appIdOctets = findTagged(softwareEnforced, TAG_ATTESTATION_APPLICATION_ID) ?? findTagged(hardwareEnforced, TAG_ATTESTATION_APPLICATION_ID);
    const packages: KeyDescription['packages'] = [];
    const signatureDigests: Buffer[] = [];
    if (appIdOctets) {
      const [infos, digests] = children(parse(expect(appIdOctets, 0x04, 'attestationApplicationId').value));
      for (const info of children(expect(infos, 0x11, 'package_infos'))) {
        const [name, version] = children(info);
        packages.push({ name: expect(name, 0x04, 'package_name').value.toString('utf8'), versionCode: intOf(expect(version, 0x02, 'version')) });
      }
      for (const d of children(expect(digests, 0x11, 'signature_digests'))) signatureDigests.push(Buffer.from(expect(d, 0x04, 'digest').value));
    }

    // rootOfTrust: solo cuenta si lo afirma el hardware
    const rot = findTagged(hardwareEnforced, TAG_ROOT_OF_TRUST);
    let rootOfTrust: KeyDescription['rootOfTrust'] = null;
    if (rot) {
      const [, locked, state] = children(expect(rot, 0x10, 'rootOfTrust'));
      rootOfTrust = {
        deviceLocked: expect(locked, 0x01, 'deviceLocked').value[0] !== 0,
        verifiedBootState: VERIFIED_BOOT_STATE[intOf(expect(state, 0x0a, 'verifiedBootState'))] ?? 'Failed',
      };
    }

    return {
      attestationVersion: intOf(expect(fields[0], 0x02, 'attestationVersion')),
      attestationSecurityLevel: SECURITY_LEVEL[level] ?? 'Software',
      challenge: Buffer.from(expect(fields[4], 0x04, 'attestationChallenge').value),
      packages,
      signatureDigests,
      rootOfTrust,
    };
  } catch (error) {
    if (error instanceof AttestationError) throw error;
    throw new AttestationError(`KeyDescription ilegible: ${(error as Error).message}`);
  }
}

// ---- Configuración y verificación ---------------------------------------------------------------
export interface AndroidKeyAttestationConfig {
  packageName: string;
  // SHA-256 del certificado con el que se firma el APK (keystore de EAS), en bytes
  certSha256: Buffer[];
  // SPKI DER de las raíces de Google aceptadas
  rootPublicKeys: Buffer[];
  minVersionCode: number;
  revocationUrl: string;
}

export interface KeyAttestationInput {
  certificateChain: string[]; // base64 DER, hoja primero (lo que devuelve getAttestationCertificateChainAsync)
  challenge: string; // el que la app pasó a generateHardwareAttestedKeyAsync (UTF-8)
  now?: Date;
}

const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const spki = (cert: X509Certificate) => cert.publicKey.export({ type: 'spki', format: 'der' });
const normalizeSerial = (s: string) => s.toLowerCase().replace(/^0+/, '');

export function verifyKeyAttestationChain(input: KeyAttestationInput, config: AndroidKeyAttestationConfig): { serials: string[]; versionCode: number } {
  const now = input.now ?? new Date();
  const raw = input.certificateChain;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_CHAIN) throw new AttestationError('cadena de certificados de largo inválido');

  let chain: X509Certificate[];
  try {
    chain = raw.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')));
  } catch {
    throw new AttestationError('certificados ilegibles');
  }

  // 1. Cada certificado firmado por el siguiente; el último es (o lo firma) una raíz de Google configurada.
  // Vigencia, igual que el verificador de Google (github.com/android/keyattestation): la de la hoja la
  // fija el dispositivo y no se evalúa; un intermedio vencido se tolera solo en cadenas de fábrica
  // (el emitido por la raíz lleva serialNumber en el subject), cuyas claves no se pueden rotar: para
  // esas claves el control es la lista de revocación. "Todavía no vigente" se rechaza siempre.
  const factoryProvisioned = chain.length >= 2 && /(^|\n)serialNumber=/.test(chain[chain.length - 2].subject);
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i].verify(chain[i + 1].publicKey)) throw new AttestationError(`certificado ${i} no está firmado por el ${i + 1}`);
    if (i === 0) continue;
    if (now < new Date(chain[i].validFrom)) throw new AttestationError(`certificado ${i} todavía no vigente`);
    if (now > new Date(chain[i].validTo) && !factoryProvisioned) throw new AttestationError(`certificado ${i} vencido`);
  }
  const top = chain[chain.length - 1];
  const topKey = spki(top);
  const anchored = config.rootPublicKeys.some((root) => sameBytes(root, topKey) && top.verify(top.publicKey));
  if (!anchored) throw new AttestationError('la cadena no termina en una raíz de Google configurada');

  // 2. La descripción de la clave solo se lee de la hoja
  const ext = extensionValue(chain[0], KEY_DESCRIPTION_OID);
  if (!ext) throw new AttestationError('la hoja no trae la extensión de Key Attestation');
  const desc = parseKeyDescription(ext);

  if (desc.attestationSecurityLevel === 'Software') throw new AttestationError('clave atestiguada por software (sin TEE/StrongBox)');
  if (!sameBytes(desc.challenge, Buffer.from(input.challenge, 'utf8'))) {
    throw new AttestationError('attestationChallenge no coincide (desafío distinto o de otra tienda)');
  }

  // 3. App: package exacto, firmada con un certificado permitido, versión mínima
  const pkg = desc.packages.find((p) => p.name === config.packageName);
  if (!pkg) throw new AttestationError(`package no permitido (${desc.packages.map((p) => p.name).join(',') || 'ninguno'})`);
  if (desc.signatureDigests.length === 0 || !desc.signatureDigests.every((d) => config.certSha256.some((c) => sameBytes(c, d)))) {
    throw new AttestationError('certificado de firma del APK no permitido');
  }
  if (pkg.versionCode < config.minVersionCode) throw new AttestationError(`versionCode ${pkg.versionCode} < mínimo ${config.minVersionCode}`);

  // 4. Dispositivo: bootloader bloqueado y arranque verificado con las claves del fabricante
  if (!desc.rootOfTrust) throw new AttestationError('sin rootOfTrust del hardware');
  if (!desc.rootOfTrust.deviceLocked || desc.rootOfTrust.verifiedBootState !== 'Verified') {
    throw new AttestationError(`arranque no verificado (locked=${desc.rootOfTrust.deviceLocked}, ${desc.rootOfTrust.verifiedBootState})`);
  }

  return { serials: chain.map((c) => normalizeSerial(c.serialNumber)), versionCode: pkg.versionCode };
}

/**
 * Lista de revocación de Google (claves de fábrica filtradas o comprometidas). Se cachea 1 h; si Google
 * no responde se usa la última copia hasta 24 h y, sin ninguna, se falla cerrado (503).
 */
export class KeyAttestationRevocationList {
  private cache: { url: string; revoked: Set<string>; fetchedAt: number } | null = null;

  constructor(private readonly fetchImpl: () => FetchLike) {}

  async assertNotRevoked(serials: string[], url: string): Promise<void> {
    const revoked = await this.load(url);
    const hit = serials.find((s) => revoked.has(s));
    if (hit) throw new AttestationError(`certificado revocado por Google (${hit})`);
  }

  private async load(url: string): Promise<Set<string>> {
    const fresh = this.cache && this.cache.url === url && Date.now() - this.cache.fetchedAt < 60 * 60_000;
    if (fresh) return this.cache!.revoked;
    try {
      const res = await Promise.race([
        this.fetchImpl()(url, { method: 'GET', headers: { 'cache-control': 'no-cache' }, body: undefined as never }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8_000).unref()),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body || typeof body.entries !== 'object') throw new Error('respuesta sin entries');
      const revoked = new Set(Object.keys(body.entries).map(normalizeSerial));
      this.cache = { url, revoked, fetchedAt: Date.now() };
      return revoked;
    } catch (error) {
      if (this.cache && this.cache.url === url && Date.now() - this.cache.fetchedAt < 24 * 60 * 60_000) return this.cache.revoked;
      throw new AttestationProviderError(`lista de revocación de Key Attestation no disponible: ${(error as Error).message}`);
    }
  }
}
