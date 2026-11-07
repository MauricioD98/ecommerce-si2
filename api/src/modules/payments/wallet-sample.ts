// Datos de ejemplo de billetera que sembraban las versiones anteriores al fix (TenantProvisioningService
// .seedPaymentSettings y PaymentSettingsService.read(), que los escribía al LEER si faltaba la cuenta).
// Solo sirven para detectarlos en tiendas existentes (scripts/audit-wallet-samples.ts): nunca se escriben.
//
// Una coincidencia NO prueba que la cuenta sea falsa: una tienda pudo crear de verdad @<slug> en su
// billetera. Por eso la herramienta solo reporta; la decisión la toma una persona con la tienda.

export const LEGACY_SAMPLE_PROVIDER = 'Airtm / Takenos / Wallbit';
export const LEGACY_SAMPLE_INSTRUCTIONS =
  'Transfiere el monto desde tu cuenta Airtm, Takenos o Wallbit a nuestro usuario/correo. Luego ingresa el ID de transacción o referencia de la transferencia.';
// read() usaba este slug cuando no podía resolver la tienda
export const LEGACY_FALLBACK_SLUG = 'mitienda';

export const legacySampleAccount = (slug: string) => `@${slug} / pagos@${slug}.com`;

export type WalletSampleSignal =
  | 'ACCOUNT_EXACT' // cuenta idéntica a la de ejemplo
  | 'ACCOUNT_SIMILAR' // la cuenta contiene @<slug> o pagos@<slug>.com (ejemplo editado a medias o cuenta real parecida)
  | 'PROVIDER_DEFAULT' // proveedor con el texto sembrado (también era el valor inicial del formulario)
  | 'INSTRUCTIONS_DEFAULT'; // instrucciones con el texto sembrado

// ALTA: cuenta de ejemplo tal cual. MEDIA: cuenta parecida. BAJA: solo quedan textos sembrados.
export type WalletSampleRisk = 'ALTA' | 'MEDIA' | 'BAJA';

export interface WalletSampleRow {
  walletProvider: string | null;
  walletAccount: string | null;
  walletInstructions: string | null;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function detectWalletSample(row: WalletSampleRow, slug: string): { signals: WalletSampleSignal[]; risk: WalletSampleRisk | null } {
  const signals: WalletSampleSignal[] = [];
  const account = norm(row.walletAccount);
  const slugs = [...new Set([norm(slug), LEGACY_FALLBACK_SLUG])].filter(Boolean);

  if (account && slugs.some((s) => account === norm(legacySampleAccount(s)))) {
    signals.push('ACCOUNT_EXACT');
  } else if (
    account &&
    slugs.some((s) => account.includes(`pagos@${s}.com`) || account.split(/[\s/,;]+/).includes(`@${s}`))
  ) {
    signals.push('ACCOUNT_SIMILAR');
  }
  if (row.walletProvider && norm(row.walletProvider) === norm(LEGACY_SAMPLE_PROVIDER)) signals.push('PROVIDER_DEFAULT');
  if (row.walletInstructions && norm(row.walletInstructions) === norm(LEGACY_SAMPLE_INSTRUCTIONS)) {
    signals.push('INSTRUCTIONS_DEFAULT');
  }

  const risk: WalletSampleRisk | null = signals.includes('ACCOUNT_EXACT')
    ? 'ALTA'
    : signals.includes('ACCOUNT_SIMILAR')
    ? 'MEDIA'
    : signals.length > 0
    ? 'BAJA'
    : null;
  return { signals, risk };
}
