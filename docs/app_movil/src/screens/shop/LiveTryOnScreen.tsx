import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Linking, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from '../../../node_modules/react-i18next';
import { RootStackParamList } from '../../navigation/types';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { Colors, Shadows } from '../../theme/colors';
import { useAuth } from '../../context/AuthContext';
import { getTenantId } from '../../config/tenant';
import { checkOnline, onNetworkChange } from '../../offline/network';
import { describeTryOnFailure, tryOnApi } from '../../api/tryOn.api';
import { isLiveTryOnAvailable } from '../../tryOn/livekitBootstrap';
import {
  createLiveTryOnController,
  garmentIssue,
  type LiveController,
  type LiveError,
  type LiveErrorKind,
  type LiveState,
} from '../../tryOn/tryOnCore';

type Props = NativeStackScreenProps<RootStackParamList, 'TryOn'>;

// Probador Virtual EN VIVO: la cámara frontal se transmite a Decart (lucy-2.5) por WebRTC/LiveKit y la
// pantalla muestra el video que devuelve Decart con la prenda puesta. La lógica (orden de pasos, límites,
// cierres) vive en tryOnCore.createLiveTryOnController; acá solo se conectan las piezas nativas.
// Nada del video se guarda: no hay grabación, ni archivos, ni SQLite/AsyncStorage, ni logs.

// Los módulos nativos se cargan solo si LiveKit quedó registrado (development build). En Expo Go no
// existen y requerirlos rompería la pantalla.
type WebRTC = typeof import('@livekit/react-native-webrtc');
type Stream = InstanceType<WebRTC['MediaStream']>;
const webrtc = (): WebRTC => require('@livekit/react-native-webrtc') as WebRTC;
const decartSdk = () => require('@decartai/sdk') as typeof import('@decartai/sdk');

const DEFAULT_MAX_SECONDS = 60;

// Tipo de fallo → clave de traducción (tryOn.errors.*)
const ERROR_KEYS: Record<LiveErrorKind, string> = {
  session: 'session',
  plan: 'plan',
  garment_unavailable: 'garmentUnavailable',
  garment_no_image: 'garmentNoImage',
  garment_image_unavailable: 'garmentImageUnavailable',
  garment_image_too_small: 'garmentImageTooSmall',
  not_enabled: 'notEnabled',
  busy: 'busy',
  store_busy: 'storeBusy',
  hourly_limit: 'hourlyLimit',
  clock_skew: 'clockSkew',
  rate_limited: 'rateLimited',
  timeout: 'timeout',
  offline: 'offline',
  network: 'network',
  provider: 'provider',
  provider_credits: 'providerCredits',
  policy: 'policy',
  token: 'token',
  connection_lost: 'connectionLost',
  native_missing: 'nativeMissing',
  camera_denied: 'cameraDenied',
  camera_unavailable: 'cameraUnavailable',
  mismatch: 'mismatch',
  unknown: 'unknown',
};
// Para estos el texto de la API (ya traducido) es más preciso: trae el plan o los segundos de espera
const SERVER_TEXT: ReadonlySet<LiveErrorKind> = new Set(['plan', 'busy', 'store_busy', 'hourly_limit', 'unknown']);

const ACTIVE_PHASES = new Set(['permission', 'camera', 'requesting', 'connecting', 'live']);

async function requestCameraPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  // iOS muestra su propio diálogo al abrir la cámara (NSCameraUsageDescription)
  if (Platform.OS !== 'android') return 'granted';
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}

export const LiveTryOnScreen: React.FC<Props> = ({ route, navigation }) => {
  const { productId, productName, productImageUrl } = route.params;
  const { t } = useTranslation();
  const { user } = useAuth();
  const available = isLiveTryOnAvailable();
  const issue = garmentIssue({ imageUrl: productImageUrl });

  const [state, setState] = useState<LiveState<Stream> | null>(null);
  const [configuredMax, setConfiguredMax] = useState<number>(DEFAULT_MAX_SECONDS);
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;
  const abortRef = useRef<AbortController | null>(null);
  const ctlRef = useRef<LiveController<Stream> | null>(null);

  if (!ctlRef.current) {
    ctlRef.current = createLiveTryOnController<Stream>({
      requestCameraPermission,
      isOnline: checkOnline,
      expected: async () => {
        const tenantId = await getTenantId();
        const userId = userIdRef.current;
        return tenantId && userId ? { tenantId, userId, productId } : null;
      },
      openCamera: async () => {
        const model = decartSdk().models.realtime('lucy-2.5');
        // Solo video (sin micrófono), cámara frontal, a la resolución y fps del modelo
        return (await webrtc().mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            frameRate: decartSdk().resolveFpsNumber(model.fps),
            width: model.width,
            height: model.height,
          },
        })) as Stream;
      },
      closeCamera: (stream) => {
        stream.getTracks().forEach((track) => track.stop());
        stream.release?.();
      },
      requestSession: async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          return await tryOnApi.createLiveSession(productId, controller.signal);
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      },
      describeApiFailure: describeTryOnFailure,
      connect: async (stream, session, handlers) => {
        const { createDecartClient, models } = decartSdk();
        // Token de cliente firmado por el backend (limitado a lucy-2.5 y a maxSessionSeconds)
        const decart = createDecartClient({ apiKey: session.apiKey, telemetry: false });
        const realtime = await decart.realtime.connect(stream, {
          model: models.realtime('lucy-2.5'),
          // En React Native el SDK pide VP8
          preferredVideoCodec: 'vp8',
          initialState: {
            prompt: { text: session.prompt, enhance: true },
            // Foto de la prenda del catálogo (data URL): el cliente no sube ninguna foto suya
            image: session.garmentImage,
          },
          onRemoteStream: handlers.onRemoteStream,
          onConnectionChange: handlers.onConnectionChange,
        });
        realtime.on('generationTick', ({ seconds }) => handlers.onGenerationTick(seconds));
        realtime.on('error', handlers.onError);
        realtime.on('sessionEnded', ({ reason }) => handlers.onSessionEnded(reason));
        return realtime;
      },
      endSession: (sessionId) => tryOnApi.endLiveSession(sessionId),
      onChange: (next) => {
        setState(next);
        if (next.maxSeconds) setConfiguredMax(next.maxSeconds);
      },
    });
  }
  const ctl = ctlRef.current;

  // Duración máxima configurada en el backend, para mostrarla antes de iniciar
  useEffect(() => {
    let alive = true;
    tryOnApi
      .getLiveConfig()
      .then((config) => alive && Number.isFinite(config?.maxSessionSeconds) && setConfiguredMax(config.maxSessionSeconds))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Cierres obligatorios: salir de la pantalla, segundo plano, sin red
  useEffect(() => {
    // Solo "background": el diálogo de permisos del sistema pasa la app a "inactive" (iOS) y no debe
    // cortar el arranque
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'background' && ctl.getState().phase !== 'permission') ctl.stop('background');
    });
    const offNetwork = onNetworkChange((online) => {
      if (!online && ACTIVE_PHASES.has(ctl.getState().phase)) ctl.stop('offline');
    });
    const offBlur = navigation.addListener('blur', () => {
      abortRef.current?.abort();
      ctl.stop('leave');
    });
    return () => {
      appState.remove();
      offNetwork();
      offBlur();
      abortRef.current?.abort();
      ctl.dispose();
    };
  }, [ctl, navigation]);

  const phase = state?.phase ?? 'idle';
  const active = ACTIVE_PHASES.has(phase);
  const maxSeconds = state?.maxSeconds ?? configuredMax;

  const errorText = useMemo(() => {
    const error: LiveError | null | undefined = state?.error;
    if (!error) return null;
    if (SERVER_TEXT.has(error.kind) && error.message) return error.message;
    return t(`tryOn.errors.${ERROR_KEYS[error.kind]}`);
  }, [state?.error, t]);

  const endText =
    phase === 'ended' && state?.endReason
      ? t(`tryOn.ended.${state.endReason === 'limit' ? 'limit' : state.endReason === 'background' ? 'background' : state.endReason === 'offline' ? 'offline' : 'user'}`, {
          seconds: maxSeconds,
        })
      : null;

  const stageLabel =
    phase === 'permission' || phase === 'camera'
      ? t('tryOn.stage.camera')
      : phase === 'requesting'
        ? t('tryOn.stage.requesting')
        : phase === 'connecting' || (phase === 'live' && !state?.remoteStream)
          ? t('tryOn.stage.connecting')
          : state?.connection === 'reconnecting'
            ? t('tryOn.stage.reconnecting')
            : null;

  const { RTCView } = available ? webrtc() : { RTCView: null };
  const remote = phase === 'live' ? state?.remoteStream : null;
  const local = active ? state?.localStream : null;

  const blocked = !!issue || !available;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Header title={t('tryOn.title')} showBack onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.garmentRow}>
          {productImageUrl ? (
            <Image source={{ uri: productImageUrl }} style={styles.garmentThumb} resizeMode="cover" />
          ) : (
            <View style={[styles.garmentThumb, styles.center]}>
              <Ionicons name="shirt-outline" size={24} color={Colors.textMuted} />
            </View>
          )}
          <View style={styles.flex}>
            <Text style={styles.garmentLabel}>{t('tryOn.garment')}</Text>
            <Text style={styles.garmentName} numberOfLines={2}>
              {productName}
            </Text>
            <Text style={styles.garmentHint}>{t('tryOn.garmentHint')}</Text>
          </View>
        </View>

        {issue && (
          <Notice tone="error" icon="alert-circle-outline" title={t('tryOn.unavailableTitle')}>
            {t(issue === 'no_image' ? 'tryOn.errors.garmentNoImage' : 'tryOn.errors.garmentUnavailable')}
          </Notice>
        )}
        {!issue && !available && (
          <Notice tone="error" icon="construct-outline" title={t('tryOn.unavailableTitle')}>
            {t('tryOn.errors.nativeMissing')}
          </Notice>
        )}

        {!blocked && (
          <>
            {/* Escenario: solo el video que devuelve Decart cuenta como resultado */}
            <View style={styles.stage}>
              {remote && RTCView ? (
                <RTCView streamURL={(remote as Stream).toURL()} style={styles.video} objectFit="cover" mirror zOrder={0} />
              ) : (
                <View style={[styles.center, styles.stageEmpty]}>
                  <Ionicons name={phase === 'ended' ? 'checkmark-circle-outline' : 'body-outline'} size={56} color={Colors.textMuted} />
                  <Text style={styles.stageEmptyText}>{endText ?? t('tryOn.stage.idle')}</Text>
                </View>
              )}

              {active && stageLabel && (
                <View style={styles.overlay}>
                  <ActivityIndicator size="large" color={Colors.textWhite} />
                  <Text style={styles.overlayText}>{stageLabel}</Text>
                </View>
              )}

              {local && RTCView && (
                <View style={styles.pip}>
                  <RTCView streamURL={(local as Stream).toURL()} style={styles.pipVideo} objectFit="cover" mirror zOrder={1} />
                  <Text style={styles.pipLabel}>{t('tryOn.yourCamera')}</Text>
                </View>
              )}

              {phase === 'live' && remote && (
                <>
                  <View style={styles.liveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>{t('tryOn.liveBadge')}</Text>
                  </View>
                  <View style={styles.countdown} accessibilityLiveRegion="polite">
                    <Text style={styles.countdownValue}>{state?.secondsLeft ?? maxSeconds} s</Text>
                    <Text style={styles.countdownLabel}>{t('tryOn.remaining')}</Text>
                  </View>
                </>
              )}
            </View>

            {phase === 'live' && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: `${Math.max(0, Math.min(100, ((state?.secondsLeft ?? maxSeconds) / maxSeconds) * 100))}%` }]} />
              </View>
            )}

            {errorText && (
              <Notice tone="error" icon={state?.error?.kind === 'offline' ? 'cloud-offline-outline' : 'alert-circle-outline'}>
                {errorText}
                {state?.error?.settings ? (
                  <Text style={styles.link} onPress={() => Linking.openSettings()}>
                    {'\n'}
                    {t('tryOn.openSettings')}
                  </Text>
                ) : null}
              </Notice>
            )}

            {!active && (
              <Notice tone="info" icon="videocam-outline" title={t('tryOn.beforeTitle')}>
                {t('tryOn.before', { seconds: maxSeconds })}
              </Notice>
            )}

            {active ? (
              <Button
                title={t('tryOn.finish')}
                onPress={() => {
                  abortRef.current?.abort();
                  ctl.stop('user');
                }}
                variant="danger"
                size="lg"
                testID="try-on-finish"
                icon={<Ionicons name="stop-circle-outline" size={20} color={Colors.textWhite} />}
              />
            ) : (
              <Button
                title={phase === 'error' && state?.error?.retryable ? t('tryOn.retry') : phase === 'ended' ? t('tryOn.again') : t('tryOn.start')}
                onPress={() => void ctl.start()}
                size="lg"
                testID="try-on-start"
                icon={<Ionicons name="videocam" size={20} color={Colors.textWhite} />}
              />
            )}

            {phase === 'live' && <Text style={styles.usage}>{t('tryOn.usage', { seconds: state?.billedSeconds ?? 0, max: maxSeconds })}</Text>}
          </>
        )}

        <Notice tone="warning" icon="information-circle-outline">
          {t('tryOn.disclaimer')}
        </Notice>
      </ScrollView>
    </SafeAreaView>
  );
};

const Notice: React.FC<{ tone: 'info' | 'warning' | 'error'; icon: keyof typeof Ionicons.glyphMap; title?: string; children: React.ReactNode }> = ({
  tone,
  icon,
  title,
  children,
}) => {
  const color = tone === 'info' ? Colors.info : tone === 'warning' ? Colors.warning : Colors.error;
  const bg = tone === 'info' ? Colors.infoLight : tone === 'warning' ? Colors.warningLight : Colors.errorLight;
  return (
    <View style={[styles.notice, { backgroundColor: bg, borderColor: color }]}>
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.flex}>
        {title ? <Text style={styles.noticeTitle}>{title}</Text> : null}
        <Text style={styles.noticeText}>{children}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  flex: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  garmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    ...Shadows.sm,
  },
  garmentThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: Colors.surfaceSubtle },
  garmentLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase', fontWeight: '700' },
  garmentName: { fontSize: 16, color: Colors.textPrimary, fontWeight: '700' },
  garmentHint: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  stage: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: 560,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  video: { width: '100%', height: '100%' },
  stageEmpty: { flex: 1, gap: 10, paddingHorizontal: 24, backgroundColor: Colors.surfaceSubtle },
  stageEmptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  overlayText: { color: Colors.textWhite, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  pip: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 96,
    height: 128,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: '#000',
  },
  pipVideo: { width: '100%', height: '100%' },
  pipLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textWhite,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 2,
  },
  liveBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  liveText: { color: Colors.textWhite, fontSize: 12, fontWeight: '700' },
  countdown: {
    position: 'absolute',
    top: 10,
    right: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countdownValue: { color: Colors.textWhite, fontSize: 20, fontWeight: '800' },
  countdownLabel: { color: Colors.textWhite, fontSize: 10, opacity: 0.85 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.border, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: Colors.primary },
  notice: { flexDirection: 'row', gap: 10, borderRadius: 14, padding: 12, borderWidth: 1 },
  noticeTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  noticeText: { fontSize: 13, lineHeight: 19, color: Colors.textPrimary },
  link: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  usage: { fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
});
