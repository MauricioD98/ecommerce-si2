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
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
  TENANT_BASE_DOMAIN: '',
  LEGACY_TENANT_ID: '',
  INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(64),
  FRONTEND_URL: 'http://localhost:3000',
  TRUST_PROXY_HOPS: '1',
  // Los crons no corren solos durante las pruebas: cada prueba invoca los barridos a mano
  DISABLE_BACKGROUND_JOBS: 'true',
};
for (const [key, value] of Object.entries(ACCEPTANCE_ENV)) process.env[key] = value;
