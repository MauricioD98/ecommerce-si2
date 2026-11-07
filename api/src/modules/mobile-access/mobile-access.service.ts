import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { i18nMessage } from '../../i18n/i18n-message';
import { getPlanFeatures } from '../platform/plans';
import { verifyAppAttestAssertion, verifyAppAttestAttestation } from './app-attest.verifier';
import { AttestationError, AttestationProviderError } from './attestation-error';
import { MobileAttestationDto } from './dto/mobile-attestation.dto';
import {
  MOBILE_ATTESTATION_INVALID,
  mobilePlanForbidden,
  MOBILE_ATTESTATION_UNAVAILABLE,
  MobileSessionClaims,
} from './mobile-access.errors';
import {
  boundClientData,
  loadMobileAccessConfig,
  playIntegrityRequestHash,
} from './mobile-access.config';
import { FetchLike, PlayIntegrityClient, evaluatePlayIntegrityVerdict } from './play-integrity.verifier';

export * from './mobile-access.errors';

/**
 * Canal móvil: decide en el servidor si una tienda puede usar la app oficial (plan vigente leído del
 * plano de control, no del cache ni de lo que diga el cliente) y verifica la prueba de integridad del
 * dispositivo contra un desafío de un solo uso ligado a esa tienda.
 */
@Injectable()
export class MobileAccessService {
  private readonly logger = new Logger(MobileAccessService.name);
  private playClient: { key: string; client: PlayIntegrityClient } | null = null;
  // Inyectable para las pruebas (Google falso). En producción es el fetch global.
  fetchImpl: FetchLike = fetch as unknown as FetchLike;

  constructor(private readonly control: ControlPrismaService) {}

  /** Plan VIGENTE (lectura directa, sin el cache de 60 s del middleware). */
  async assertMobilePlan(tenantId: string): Promise<void> {
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { status: true, plan: true } });
    if (!tenant || tenant.status !== 'ACTIVE' || !getPlanFeatures(tenant.plan).mobileApp) throw mobilePlanForbidden();
  }

  async issueChallenge(tenantId: string) {
    await this.assertMobilePlan(tenantId);
    const config = loadMobileAccessConfig();
    const challenge = randomBytes(32).toString('base64url');
    const row = await this.control.mobileAttestationChallenge.create({
      data: { tenantId, challenge, expiresAt: new Date(Date.now() + config.challengeTtlMs) },
      select: { id: true, expiresAt: true },
    });
    // Limpieza oportunista de desafíos viejos (no bloquea la respuesta)
    void this.control.mobileAttestationChallenge
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } } })
      .catch(() => undefined);

    return {
      challengeId: row.id,
      challenge,
      expiresAt: row.expiresAt.toISOString(),
      // Lo que la app debe pasar tal cual al SDK: requestHash (Android) o challenge de App Attest (iOS)
      requestHash: playIntegrityRequestHash(tenantId, challenge),
      clientData: boundClientData(tenantId, challenge),
      // Qué pruebas acepta este servidor; la app lo usa para mostrar un error claro si no hay ninguna
      platforms: {
        android: !!config.android,
        ios: !!config.ios,
        development: config.developmentBypass,
      },
    };
  }

  /** Consume el desafío y verifica la prueba. Cualquier fallo → 401/503, nunca acceso. */
  async verify(tenantId: string, proof: MobileAttestationDto): Promise<MobileSessionClaims> {
    const config = loadMobileAccessConfig();
    const challenge = await this.consumeChallenge(tenantId, proof.challengeId);
    const clientData = boundClientData(tenantId, challenge);

    try {
      switch (proof.platform) {
        case 'development':
          if (!config.developmentBypass) throw new AttestationError('atajo de desarrollo deshabilitado');
          return { platform: 'development', method: 'development-bypass', attestedAt: Date.now() };

        case 'android': {
          if (!config.android) throw this.unavailable(`android: ${config.androidError}`);
          if (!proof.integrityToken) throw new AttestationError('falta integrityToken');
          const payload = await this.playIntegrity(config.android).decode(proof.integrityToken);
          evaluatePlayIntegrityVerdict(payload, { requestHash: playIntegrityRequestHash(tenantId, challenge) }, config.android);
          return { platform: 'android', method: 'play-integrity', attestedAt: Date.now() };
        }

        case 'ios': {
          if (!config.ios) throw this.unavailable(`ios: ${config.iosError}`);
          if (!proof.keyId) throw new AttestationError('falta keyId');
          if (proof.attestation) await this.registerAppAttestKey(proof.keyId, proof.attestation, clientData, config.ios);
          else if (proof.assertion) await this.checkAppAttestAssertion(proof.keyId, proof.assertion, clientData, config.ios.appId);
          else throw new AttestationError('falta attestation o assertion');
          return { platform: 'ios', method: 'app-attest', attestedAt: Date.now() };
        }
      }
    } catch (error) {
      if (error instanceof AttestationError) {
        this.logger.warn(`Prueba de integridad rechazada (tienda ${tenantId}, ${proof.platform}): ${error.reason}`);
        throw new UnauthorizedException({ code: error.code, message: i18nMessage('errors.MOBILE_ATTESTATION_INVALID') });
      }
      if (error instanceof AttestationProviderError) {
        this.logger.error(`Proveedor de integridad no disponible: ${error.message}`);
        throw new ServiceUnavailableException({
          code: MOBILE_ATTESTATION_UNAVAILABLE,
          message: i18nMessage('errors.MOBILE_ATTESTATION_UNAVAILABLE'),
        });
      }
      throw error;
    }
    throw new UnauthorizedException({ code: MOBILE_ATTESTATION_INVALID, message: i18nMessage('errors.MOBILE_ATTESTATION_INVALID') });
  }

  // UPDATE condicionado: dos requests con la misma prueba no pueden consumir el mismo desafío
  private async consumeChallenge(tenantId: string, challengeId: string): Promise<string> {
    const now = new Date();
    const { count } = await this.control.mobileAttestationChallenge.updateMany({
      where: { id: challengeId, tenantId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (count !== 1) {
      throw new UnauthorizedException({ code: MOBILE_ATTESTATION_INVALID, message: i18nMessage('errors.MOBILE_ATTESTATION_INVALID') });
    }
    const row = await this.control.mobileAttestationChallenge.findUnique({ where: { id: challengeId }, select: { challenge: true } });
    return row!.challenge;
  }

  private playIntegrity(config: NonNullable<ReturnType<typeof loadMobileAccessConfig>['android']>) {
    // Se recrea si cambió la cuenta de servicio (rotación sin reiniciar)
    const key = `${config.packageName}:${config.serviceAccount.clientEmail}`;
    if (!this.playClient || this.playClient.key !== key) {
      this.playClient = { key, client: new PlayIntegrityClient(config, this.fetchImpl) };
    }
    return this.playClient.client;
  }

  private async registerAppAttestKey(
    keyId: string,
    attestation: string,
    clientData: string,
    config: NonNullable<ReturnType<typeof loadMobileAccessConfig>['ios']>,
  ) {
    const attested = verifyAppAttestAttestation({
      attestation,
      keyId,
      clientData,
      appId: config.appId,
      rootCaPem: config.rootCaPem,
      allowDevelopmentEnvironment: config.allowDevelopmentEnvironment,
    });
    // Una clave se atestigua una sola vez: volver a mandar la atestación de una clave conocida se
    // rechaza (si no, una atestación capturada serviría de comodín con contador 0)
    const existing = await this.control.mobileAppAttestKey.findUnique({ where: { keyId: attested.keyId }, select: { keyId: true } });
    if (existing) throw new AttestationError('la clave ya estaba atestiguada');
    await this.control.mobileAppAttestKey.create({
      data: {
        keyId: attested.keyId,
        publicKey: attested.publicKeyPem,
        signCount: attested.signCount,
        environment: attested.environment,
        lastUsedAt: new Date(),
      },
    });
  }

  private async checkAppAttestAssertion(keyId: string, assertion: string, clientData: string, appId: string) {
    const normalizedKeyId = Buffer.from(keyId, 'base64').toString('base64');
    const key = await this.control.mobileAppAttestKey.findUnique({ where: { keyId: normalizedKeyId } });
    if (!key || key.revokedAt) throw new AttestationError('clave de App Attest desconocida o revocada', 'APP_ATTEST_KEY_UNKNOWN');
    const { signCount } = verifyAppAttestAssertion({
      assertion,
      clientData,
      publicKeyPem: key.publicKey,
      storedSignCount: key.signCount,
      appId,
    });
    const { count } = await this.control.mobileAppAttestKey.updateMany({
      where: { keyId: normalizedKeyId, revokedAt: null, signCount: { lt: signCount } },
      data: { signCount, lastUsedAt: new Date() },
    });
    if (count !== 1) throw new AttestationError('contador ya usado (carrera o repetición)');
  }

  private unavailable(detail: string) {
    this.logger.error(`Verificación de integridad no configurada: ${detail}`);
    return new ServiceUnavailableException({
      code: MOBILE_ATTESTATION_UNAVAILABLE,
      message: i18nMessage('errors.MOBILE_ATTESTATION_UNAVAILABLE'),
    });
  }
}
