import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'node:module';
import { beforeEach, describe, it } from 'node:test';
import ts from 'typescript';

// Lógica real de app_movil/src/security/mobileAttestation.ts, transpilada y ejecutada con el SDK de
// integridad, el almacenamiento y la red simulados. Demuestra el protocolo del cliente; NO prueba
// Play Integrity ni App Attest reales (eso exige un build firmado en un dispositivo).
const source = readFileSync(join(__dirname, '..', '..', '..', '..', 'app_movil', 'src', 'security', 'mobileAttestation.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

const httpError = (status: number, data: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

describe('App móvil: generación de la prueba de integridad', () => {
  let storage: Map<string, string>;
  let os: string;
  let platforms: { android: boolean; ios: boolean; development: boolean };
  let sdk: Record<string, any>;
  let calls: string[];
  let flow: any;

  const load = (dev = false) => {
    (globalThis as any).__DEV__ = dev;
    let n = 0;
    const stubs: Record<string, unknown> = {
      'react-native': { Platform: { OS: os } },
      axios: {
        post: async (url: string) => {
          calls.push(url);
          n += 1;
          return { data: { challengeId: `ch-${n}`, requestHash: `hash-${n}`, clientData: `cd-${n}`, platforms } };
        },
      },
      '@expo/app-integrity': sdk,
      '../utils/storage': {
        appStorage: {
          getItem: async (k: string) => storage.get(k) ?? null,
          setItem: async (k: string, v: string) => void storage.set(k, v),
          removeItem: async (k: string) => void storage.delete(k),
        },
      },
      '../config/env': { getApiBaseUrl: async () => 'http://api.test/api/v1' },
      '../config/tenant': { TENANT_HEADER: 'x-tenant-id', getTenantId: async () => 'tenant-a' },
      '../i18n': { getCurrentLanguage: () => 'es' },
      i18next: { t: (key: string) => key },
    };
    const mod = new Module('mobileAttestation');
    mod.require = ((id: string) => stubs[id]) as never;
    (mod as any)._compile(outputText, 'mobileAttestation.js');
    flow = mod.exports;
  };

  beforeEach(() => {
    storage = new Map();
    calls = [];
    os = 'android';
    platforms = { android: true, ios: true, development: false };
    process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER = '123456789';
    delete process.env.EXPO_PUBLIC_MOBILE_ATTESTATION_DEV_BYPASS;
    let keys = 0;
    sdk = {
      isSupported: true,
      prepareIntegrityTokenProviderAsync: async () => undefined,
      requestIntegrityCheckAsync: async (hash: string) => `token-for-${hash}`,
      generateKeyAsync: async () => `key-${++keys}`,
      attestKeyAsync: async (key: string, cd: string) => `att-${key}-${cd}`,
      generateAssertionAsync: async (key: string, cd: string) => `as-${key}-${cd}`,
    };
  });

  it('A01: Android firma el requestHash que entrega la API para ESE desafío', async () => {
    load();
    const proof = await flow.requestMobileAttestation();
    assert.deepEqual(proof, { challengeId: 'ch-1', platform: 'android', integrityToken: 'token-for-hash-1' });
    assert.deepEqual(calls, ['http://api.test/api/v1/auth/mobile/challenge']);
  });

  it('A02: Android sin número de proyecto o con un proveedor vencido', async () => {
    delete process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER;
    load();
    await assert.rejects(flow.requestMobileAttestation(), (e: Error) => e instanceof flow.MobileAttestationUnavailableError);

    process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER = '1';
    let prepared = 0;
    let first = true;
    sdk.prepareIntegrityTokenProviderAsync = async () => void (prepared += 1);
    sdk.requestIntegrityCheckAsync = async (h: string) => {
      if (first) {
        first = false;
        throw Object.assign(new Error('expired'), { code: 'ERR_APP_INTEGRITY_PROVIDER_INVALID' });
      }
      return `t-${h}`;
    };
    load();
    assert.equal((await flow.requestMobileAttestation()).integrityToken, 't-hash-1');
    assert.equal(prepared, 2, 'se volvió a preparar el proveedor');
  });

  it('A03: iOS atestigua la clave la primera vez y después solo firma aserciones', async () => {
    os = 'ios';
    load();
    const first = await flow.requestMobileAttestation();
    assert.deepEqual(first, { challengeId: 'ch-1', platform: 'ios', keyId: 'key-1', attestation: 'att-key-1-cd-1' });
    const second = await flow.requestMobileAttestation();
    assert.deepEqual(second, { challengeId: 'ch-2', platform: 'ios', keyId: 'key-1', assertion: 'as-key-1-cd-2' });
  });

  it('A04: si la API no conoce la clave, se genera otra y se reintenta una sola vez', async () => {
    os = 'ios';
    load();
    await flow.requestMobileAttestation(); // key-1 atestiguada localmente
    const sent: any[] = [];
    const result = await flow.withMobileAttestation(async (proof: any) => {
      sent.push(proof);
      if (sent.length === 1) throw httpError(401, { code: 'APP_ATTEST_KEY_UNKNOWN' });
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(sent[0].assertion !== undefined, true);
    assert.equal(sent[1].keyId, 'key-2');
    assert.equal(sent[1].attestation !== undefined, true);

    // Cualquier otro error no se reintenta
    await assert.rejects(flow.withMobileAttestation(async () => { throw httpError(403, { code: 'MOBILE_APP_NOT_IN_PLAN' }); }));
  });

  it('A05: iOS sin App Attest (simulador, equipos viejos) o servidor sin la plataforma configurada', async () => {
    os = 'ios';
    sdk.isSupported = false;
    load();
    await assert.rejects(flow.requestMobileAttestation(), (e: Error) => e.message === 'mobileAccess.deviceUnsupported');
    sdk.isSupported = true;
    platforms.ios = false;
    load();
    await assert.rejects(flow.requestMobileAttestation(), (e: Error) => e.message === 'mobileAccess.serverNotConfigured');
    os = 'web';
    platforms.ios = true;
    load();
    await assert.rejects(flow.requestMobileAttestation(), (e: Error) => e.message === 'mobileAccess.deviceUnsupported');
  });

  it('A06: el atajo de desarrollo exige __DEV__, la variable Y que la API lo ofrezca', async () => {
    process.env.EXPO_PUBLIC_MOBILE_ATTESTATION_DEV_BYPASS = 'true';
    platforms.development = true;
    load(false); // build de release
    assert.equal((await flow.requestMobileAttestation()).platform, 'android');
    load(true);
    assert.equal((await flow.requestMobileAttestation()).platform, 'development');
    platforms.development = false; // API productiva
    load(true);
    assert.equal((await flow.requestMobileAttestation()).platform, 'android');
  });
});
