import type { IntegrationProvider } from '../generated/control/client';

// Contexto autenticado (AAD) con el que se cifra cada fila de public.tenant_integrations. Lo usan
// TenantSecretsService y scripts/import-legacy-integrations: si alguien cifra con otro AAD, el
// backend no puede descifrar lo guardado (GCM rechaza el auth tag).
// Módulo sin dependencias a propósito: el script lo importa sin levantar Nest.
export const integrationAad = (tenantId: string, provider: IntegrationProvider): string => `${tenantId}:${provider}`;
