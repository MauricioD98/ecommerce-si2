import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

// Errores de los reportes con IA con un `code` estable: el front los distingue por código y no por el
// status HTTP (un 403 del validador NO es "sin permiso", es una consulta rechazada). El filtro de i18n
// conserva los campos extra del cuerpo.
export const ReportErrorCode = {
  /** El SQL de la IA no pasó la validación (no se ejecutó) */
  REJECTED: 'REPORT_QUERY_REJECTED',
  /** El SQL era válido pero falló al ejecutarse (columna inexistente, tiempo agotado...) */
  FAILED: 'REPORT_QUERY_FAILED',
  /** No se pudo preparar el ámbito de la base (migración ausente, lock ocupado...) */
  UNAVAILABLE: 'REPORT_UNAVAILABLE',
  /** La IA no está configurada o no respondió */
  AI_UNAVAILABLE: 'REPORT_AI_UNAVAILABLE',
  /** Groq respondió 429: se agotó el límite de tokens/solicitudes de la cuenta (p. ej. 8 000 tokens por minuto) */
  AI_RATE_LIMITED: 'REPORT_AI_RATE_LIMITED',
  /** La sucursal asignada al usuario no existe: no puede consultar nada */
  BRANCH_UNKNOWN: 'REPORT_BRANCH_UNKNOWN',
} as const;

export const queryRejected = (message: string) => new ForbiddenException({ message, code: ReportErrorCode.REJECTED });
export const queryFailed = (message: string) => new BadRequestException({ message, code: ReportErrorCode.FAILED });
export const reportUnavailable = (message: string) => new ServiceUnavailableException({ message, code: ReportErrorCode.UNAVAILABLE });
export const aiUnavailable = (message: string) => new ServiceUnavailableException({ message, code: ReportErrorCode.AI_UNAVAILABLE });
export const aiRateLimited = (message: string) => new ServiceUnavailableException({ message, code: ReportErrorCode.AI_RATE_LIMITED });
export const branchUnknown = (message: string) => new ForbiddenException({ message, code: ReportErrorCode.BRANCH_UNKNOWN });
