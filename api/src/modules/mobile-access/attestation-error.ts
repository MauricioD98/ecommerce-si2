// Fallo de una prueba de integridad. `reason` es para los logs (nunca se devuelve al cliente: le
// diría qué chequeo falló). `code` sí viaja: APP_ATTEST_KEY_UNKNOWN le indica a la app que genere y
// atestigüe una clave nueva en vez de reintentar con la misma.
export class AttestationError extends Error {
  constructor(
    readonly reason: string,
    readonly code: 'MOBILE_ATTESTATION_INVALID' | 'APP_ATTEST_KEY_UNKNOWN' = 'MOBILE_ATTESTATION_INVALID',
  ) {
    super(reason);
  }
}

// El proveedor (Google) no respondió o falló: no es culpa del dispositivo, se puede reintentar.
export class AttestationProviderError extends Error {}
