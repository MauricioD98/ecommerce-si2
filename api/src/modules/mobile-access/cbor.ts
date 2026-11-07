// Decodificador CBOR mínimo (RFC 8949) para los objetos de App Attest: mapas, arrays, byte/text
// strings, enteros y simples. No soporta longitudes indefinidas ni floats: Apple no los usa y un
// objeto que los traiga se rechaza en vez de interpretarse a medias.

export type CborValue = number | bigint | string | Buffer | boolean | null | undefined | CborValue[] | Map<CborValue, CborValue>;

const MAX_DEPTH = 16;

export function decodeCbor(input: Buffer): CborValue {
  let offset = 0;

  const need = (n: number) => {
    if (offset + n > input.length) throw new Error('CBOR truncado');
  };

  const readLength = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) {
      need(1);
      return input.readUInt8(offset++);
    }
    if (info === 25) {
      need(2);
      const v = input.readUInt16BE(offset);
      offset += 2;
      return v;
    }
    if (info === 26) {
      need(4);
      const v = input.readUInt32BE(offset);
      offset += 4;
      return v;
    }
    if (info === 27) {
      need(8);
      const v = input.readBigUInt64BE(offset);
      offset += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR: entero demasiado grande');
      return Number(v);
    }
    throw new Error('CBOR: longitud indefinida o reservada no soportada');
  };

  const read = (depth: number): CborValue => {
    if (depth > MAX_DEPTH) throw new Error('CBOR: anidamiento excesivo');
    need(1);
    const initial = input.readUInt8(offset++);
    const major = initial >> 5;
    const info = initial & 0x1f;

    switch (major) {
      case 0:
        return readLength(info);
      case 1:
        return -1 - readLength(info);
      case 2: {
        const len = readLength(info);
        need(len);
        const value = Buffer.from(input.subarray(offset, offset + len));
        offset += len;
        return value;
      }
      case 3: {
        const len = readLength(info);
        need(len);
        const value = input.toString('utf8', offset, offset + len);
        offset += len;
        return value;
      }
      case 4: {
        const len = readLength(info);
        const items: CborValue[] = [];
        for (let i = 0; i < len; i++) items.push(read(depth + 1));
        return items;
      }
      case 5: {
        const len = readLength(info);
        const map = new Map<CborValue, CborValue>();
        for (let i = 0; i < len; i++) {
          const k = read(depth + 1);
          map.set(k, read(depth + 1));
        }
        return map;
      }
      case 6:
        readLength(info); // tag: se ignora y se devuelve el valor etiquetado
        return read(depth + 1);
      default:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error('CBOR: tipo simple o float no soportado');
    }
  };

  const value = read(0);
  if (offset !== input.length) throw new Error('CBOR: bytes sobrantes');
  return value;
}

// ---- DER (X.509) ----------------------------------------------------------------------------

interface Tlv {
  tag: number;
  start: number; // inicio del contenido
  end: number; // fin del contenido
  next: number; // inicio del siguiente TLV
}

export function readTlv(der: Buffer, offset: number): Tlv {
  if (offset + 2 > der.length) throw new Error('DER truncado');
  const tag = der[offset];
  let len = der[offset + 1];
  let start = offset + 2;
  if (len & 0x80) {
    const bytes = len & 0x7f;
    if (bytes === 0 || bytes > 4 || start + bytes > der.length) throw new Error('DER: longitud inválida');
    len = 0;
    for (let i = 0; i < bytes; i++) len = len * 256 + der[start + i];
    start += bytes;
  }
  const end = start + len;
  if (end > der.length) throw new Error('DER truncado');
  return { tag, start, end, next: end };
}

/**
 * Contenido (extnValue, sin el OCTET STRING que lo envuelve) de la extensión `oidDer` de un
 * certificado, buscando el OID codificado dentro del DER. null si no está.
 */
export function findExtensionValue(certDer: Buffer, oidDer: Buffer): Buffer | null {
  const needle = Buffer.concat([Buffer.from([0x06, oidDer.length]), oidDer]);
  const at = certDer.indexOf(needle);
  if (at === -1) return null;
  let tlv = readTlv(certDer, at + needle.length);
  if (tlv.tag === 0x01) tlv = readTlv(certDer, tlv.next); // critical BOOLEAN opcional
  if (tlv.tag !== 0x04) return null;
  return certDer.subarray(tlv.start, tlv.end);
}
