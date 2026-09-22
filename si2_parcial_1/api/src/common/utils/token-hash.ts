import { createHash } from 'crypto';

// Hash con el que se guarda el refresh token en la BD (nunca el token en claro).
// SHA-256 y no bcrypt: bcrypt solo mira los primeros 72 bytes, que en un JWT son casi idénticos entre tokens.
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
