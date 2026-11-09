// Se ejecuta antes de importar la app. api/.env apunta a una base remota: dotenv no pisa variables ya
// definidas, así que aquí se fija TODA variable capaz de alcanzar un servicio externo.
export function acceptanceDatabaseUrl(): string {
  const raw = process.env.ACCEPTANCE_DATABASE_URL;
  if (!raw) throw new Error('Falta ACCEPTANCE_DATABASE_URL: las pruebas de aceptación nunca usan api/.env');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`Base de pruebas rechazada: ${url.hostname} no es local`);
  }
  if (!/test/i.test(url.pathname)) throw new Error('Base de pruebas rechazada: el nombre debe contener "test"');
  return raw;
}

export const ACCEPTANCE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: acceptanceDatabaseUrl(),
  DIRECT_URL: acceptanceDatabaseUrl(),
  DB_POOL_MAX: '40',
  JWT_SECRET: 'acceptance-jwt-secret',
  JWT_REFRESH_SECRET: 'acceptance-refresh-secret',
  JWT_EXPIRES_IN: '3600',
  // Nunca la clave de api/.env: las pruebas deterministas hablan con el Stripe falso local
  STRIPE_SECRET_KEY: 'sk_test_acceptance_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_acceptance',
  STRIPE_CONNECT_WEBHOOK_SECRET: '',
  STRIPE_PRICE_STARTER: '',
  STRIPE_PRICE_GROWTH: '',
  STRIPE_PRICE_PRO: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  GROQ_API_KEY: '',
  // Probador virtual: nunca la clave real de Decart; try-on-photo levanta un Decart falso local
  DECART_API_KEY: '',
  DECART_BASE_URL: '',
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  TENANT_BASE_DOMAIN: '',
  LEGACY_TENANT_ID: '',
  INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(64),
  FRONTEND_URL: 'http://localhost:3000',
  TRUST_PROXY_HOPS: '1',
  // Los crons no corren solos durante las pruebas: cada prueba invoca los barridos a mano
  DISABLE_BACKGROUND_JOBS: 'true',
  // Atajos y proveedores que cambian el resultado de una prueba: apagados por defecto aunque el api/.env
  // local (p. ej. el de la demo) los active. Cada suite que los necesita los enciende y los restaura.
  ALLOW_SIMULATED_PAYMENTS: 'false',
  // Moneda fija para las suites de mecánica de cobro; stripe-connect-destination prueba el valor por defecto
  PAYMENT_CURRENCY: 'usd',
  MOBILE_ATTESTATION_DEV_BYPASS: 'false',
  PLAY_INTEGRITY_PACKAGE_NAME: '',
  PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: '',
  PLAY_INTEGRITY_CERT_SHA256: '',
  APP_ATTEST_APP_ID: '',
  APP_ATTEST_ROOT_CA_PEM: '',
  APP_ATTEST_ALLOW_DEVELOPMENT: 'false',
  // Respaldos: clave fija SOLO de pruebas y carpeta temporal propia de la corrida (nunca la de la demo)
  BACKUP_ENCRYPTION_KEYS: `1:${Buffer.alloc(32, 7).toString('base64')}`,
  BACKUP_ACTIVE_KEY_VERSION: '',
  BACKUP_DIR: require('node:path').join(require('node:os').tmpdir(), `stella-acceptance-backups-${process.pid}`),
  BACKUP_MAX_BYTES: '',
};
for (const [key, value] of Object.entries(ACCEPTANCE_ENV)) process.env[key] = value;
