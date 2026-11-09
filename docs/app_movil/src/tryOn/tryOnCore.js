// Núcleo del Probador Virtual EN VIVO de la app móvil (Decart lucy-2.5 por WebRTC/LiveKit). JS plano
// (CommonJS) sin React Native, igual que src/offline/offlineCore.js: lo usa LiveTryOnScreen con la cámara,
// la API y el SDK reales, y lo prueban Node (tryOnCore.test.js) y la suite de aceptación de la API con
// componentes simulados.
//
// Qué controla: el orden permiso → red → cámara → sesión del backend → conexión con Decart, la cuenta
// regresiva, y que la cámara y la sesión se cierren SIEMPRE (Finalizar, salir, segundo plano, sin red,
// límite de tiempo, error). Privacidad: no guarda nada; el video va de la cámara a Decart y vuelve como
// stream, sin pasar por disco, SQLite, AsyncStorage ni logs.

const CONNECT_TIMEOUT_MS = 30 * 1000;
const TICK_MS = 250;

// Si la prenda no tiene foto ni siquiera se intenta (la API vuelve a validarla: formato y resolución)
function garmentIssue(product) {
  if (!product) return 'unavailable';
  if (product.isActive === false) return 'unavailable';
  if (typeof product.imageUrl !== 'string' || !product.imageUrl.trim()) return 'no_image';
  return null;
}

const DATA_IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * La sesión firmada por el backend tiene que ser de la tienda, la cuenta y la prenda de ESTA pantalla,
 * para lucy-2.5, con un token de cliente (nunca una clave permanente dct_) y la prenda como imagen.
 */
function isSessionFor(session, expected) {
  if (!session || typeof session !== 'object' || !expected) return false;
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  return (
    same(session.tenantId, expected.tenantId) &&
    same(session.userId, expected.userId) &&
    same(session.productId, expected.productId) &&
    session.model === 'lucy-2.5' &&
    typeof session.apiKey === 'string' &&
    session.apiKey.length > 0 &&
    !session.apiKey.startsWith('dct_') &&
    typeof session.sessionId === 'string' &&
    Number.isFinite(session.maxSessionSeconds) &&
    session.maxSessionSeconds >= 10 &&
    typeof session.garmentImage === 'string' &&
    DATA_IMAGE_RE.test(session.garmentImage)
  );
}

// Códigos de la API (api/src/modules/try-on/try-on.service.ts → TRY_ON_ERRORS)
const CODE_TO_KIND = {
  TRY_ON_PRODUCT_UNAVAILABLE: 'garment_unavailable',
  TRY_ON_NO_GARMENT_IMAGE: 'garment_no_image',
  TRY_ON_GARMENT_IMAGE_UNAVAILABLE: 'garment_image_unavailable',
  TRY_ON_GARMENT_IMAGE_TOO_SMALL: 'garment_image_too_small',
  TRY_ON_NOT_ENABLED: 'not_enabled',
  TRY_ON_IN_PROGRESS: 'busy',
  TRY_ON_STORE_BUSY: 'store_busy',
  TRY_ON_HOURLY_LIMIT: 'hourly_limit',
  TRY_ON_CLOCK_SKEW: 'clock_skew',
  TRY_ON_FAILED: 'provider',
  MOBILE_APP_NOT_IN_PLAN: 'session',
};

const RETRYABLE = new Set(['offline', 'network', 'timeout', 'provider', 'connection_lost', 'token', 'busy', 'store_busy', 'unknown']);

/** Fallo al pedir la sesión al backend: { status, code, networkError, timedOut, online, sessionExpired } */
function classifyApiFailure(failure) {
  const f = failure || {};
  let kind = 'unknown';
  if (f.sessionExpired || f.status === 401) kind = 'session';
  else if (f.code && CODE_TO_KIND[f.code]) kind = CODE_TO_KIND[f.code];
  else if (f.status === 403) kind = 'plan';
  else if (f.status === 429) kind = 'rate_limited';
  else if (f.timedOut || f.status === 504) kind = 'timeout';
  else if (f.networkError) kind = f.online === false ? 'offline' : 'network';
  else if (typeof f.status === 'number' && f.status >= 500) kind = 'provider';
  return { kind, retryable: RETRYABLE.has(kind) };
}

/** Error del SDK de Decart (DecartSDKError.code) durante la conexión o la sesión. */
function classifySdkError(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  let kind = 'provider';
  if (code === 'REACT_NATIVE_SETUP_REQUIRED' || code === 'LIVEKIT_INITIALIZATION_ERROR' || code === 'UNSUPPORTED_PLATFORM_FEATURE') kind = 'native_missing';
  else if (code === 'INVALID_API_KEY' || code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') kind = 'token';
  else if (code === 'WEBRTC_TIMEOUT_ERROR') kind = 'timeout';
  else if (typeof code === 'string' && code.startsWith('WEBRTC_')) kind = 'connection_lost';
  return { kind, retryable: RETRYABLE.has(kind) };
}

/**
 * Decart corta la sesión al llegar a maxSessionDuration. Comprobado con una sesión real de lucy-2.5
 * (SDK 0.2.14): llega como evento "error" { code: 'WEBRTC_SERVER_ERROR', message: 'Session duration
 * limit reached' }, no como sessionEnded. Es el fin normal de la prueba, no una falla.
 */
function isDurationLimitError(error) {
  const message = error && typeof error === 'object' ? String(error.message || '') : '';
  return /duration limit|session_limit|max(imum)? session duration/i.test(message);
}

/** Fin de sesión decidido por Decart (sessionEnded.reason). */
function classifySessionEnd(reason) {
  if (reason === 'session_limit') return { ended: true, reason: 'limit' };
  if (reason === 'insufficient_credits') return { ended: false, kind: 'provider_credits', retryable: false };
  if (reason === 'moderation_violation' || reason === 'policy_violation') return { ended: false, kind: 'policy', retryable: false };
  return { ended: true, reason: 'provider' };
}

const ACTIVE = new Set(['permission', 'camera', 'requesting', 'connecting', 'live']);

/**
 * Controlador de UNA pantalla del probador. Todas las dependencias se inyectan (cámara, API, SDK,
 * temporizadores) para poder probarlo con simulaciones.
 *
 * deps: {
 *   requestCameraPermission(): Promise<'granted' | 'denied' | 'blocked'>
 *   isOnline(): Promise<boolean>
 *   expected(): Promise<{ tenantId, userId, productId } | null>
 *   openCamera(): Promise<stream>               // solo video, cámara frontal
 *   closeCamera(stream): void                   // detiene las pistas y libera
 *   requestSession(): Promise<session>          // POST /try-on/live-session (lanza { apiFailure } o error)
 *   describeApiFailure(error): Promise<{ canceled?, status?, code?, message?, ... }>
 *   connect(stream, session, handlers): Promise<{ disconnect(): void }>
 *       handlers: { onRemoteStream, onConnectionChange, onGenerationTick, onError, onSessionEnded }
 *   endSession(sessionId): Promise<void>        // avisa al backend (sin esperar)
 *   onChange(state): void
 *   setTimeout, clearTimeout, setInterval, clearInterval, now
 * }
 */
function createLiveTryOnController(deps) {
  const timers = {
    setTimeout: deps.setTimeout || setTimeout,
    clearTimeout: deps.clearTimeout || clearTimeout,
    setInterval: deps.setInterval || setInterval,
    clearInterval: deps.clearInterval || clearInterval,
    now: deps.now || Date.now,
  };

  let state = {
    phase: 'idle', // idle | permission | camera | requesting | connecting | live | ended | error
    connection: null, // estado del SDK: connecting | connected | generating | reconnecting | disconnected
    localStream: null,
    remoteStream: null,
    maxSeconds: null,
    secondsLeft: null,
    billedSeconds: 0,
    endReason: null, // user | limit | background | offline | leave | provider
    error: null, // { kind, retryable, message? }
  };

  let attempt = 0;
  let stream = null;
  let client = null;
  let sessionId = null;
  let connectTimer = null;
  let cutoffTimer = null;
  let ticker = null;
  let startedAt = null;
  let disposed = false;

  const emit = (patch) => {
    state = { ...state, ...patch };
    if (!disposed && deps.onChange) {
      try {
        deps.onChange(state);
      } catch {
        // la pantalla no debe poder romper el cierre
      }
    }
  };

  const clearTimers = () => {
    if (connectTimer) timers.clearTimeout(connectTimer);
    if (cutoffTimer) timers.clearTimeout(cutoffTimer);
    if (ticker) timers.clearInterval(ticker);
    connectTimer = cutoffTimer = ticker = null;
  };

  // Cierra TODO lo abierto. Idempotente: lo pueden llamar a la vez el botón, un temporizador, el SDK
  // y el desmontaje de la pantalla.
  const release = () => {
    attempt += 1; // invalida cualquier paso async que todavía esté en vuelo
    clearTimers();
    startedAt = null;
    const c = client;
    client = null;
    if (c) {
      try {
        c.disconnect();
      } catch {
        // ya estaba cerrada
      }
    }
    const s = stream;
    stream = null;
    if (s) {
      try {
        deps.closeCamera(s);
      } catch {
        // ignore
      }
    }
    const id = sessionId;
    sessionId = null;
    if (id && deps.endSession) Promise.resolve(deps.endSession(id)).catch(() => undefined);
  };

  const fail = (error) => {
    release();
    emit({ phase: 'error', error, localStream: null, remoteStream: null, connection: null, secondsLeft: null });
  };

  const stop = (reason = 'user') => {
    if (!ACTIVE.has(state.phase)) {
      release();
      return;
    }
    const wasLive = state.phase === 'live';
    release();
    emit({
      phase: wasLive || reason !== 'user' ? 'ended' : 'idle',
      endReason: reason,
      localStream: null,
      remoteStream: null,
      connection: null,
      secondsLeft: wasLive ? 0 : null,
    });
  };

  // Primer "generating": empieza a correr el reloj que factura Decart. Corte local de respaldo al
  // máximo; el corte real lo hace Decart con maxSessionDuration.
  const startCountdown = (maxSeconds, my) => {
    if (cutoffTimer || my !== attempt) return;
    if (connectTimer) timers.clearTimeout(connectTimer);
    connectTimer = null;
    startedAt = timers.now();
    emit({ phase: 'live', secondsLeft: maxSeconds });
    ticker = timers.setInterval(() => {
      if (my !== attempt || startedAt === null) return;
      const left = Math.max(0, maxSeconds - Math.floor((timers.now() - startedAt) / 1000));
      if (left !== state.secondsLeft) emit({ secondsLeft: left });
    }, TICK_MS);
    cutoffTimer = timers.setTimeout(() => my === attempt && stop('limit'), maxSeconds * 1000);
  };

  const start = async () => {
    // Doble toque o sesión ya abierta: se ignora
    if (disposed || ACTIVE.has(state.phase)) return;
    release();
    const my = attempt;
    const stale = () => disposed || my !== attempt;
    emit({ phase: 'permission', error: null, endReason: null, billedSeconds: 0, secondsLeft: null, maxSeconds: null, connection: null });

    try {
      const permission = await deps.requestCameraPermission();
      if (stale()) return;
      if (permission !== 'granted') return fail({ kind: 'camera_denied', retryable: false, settings: permission === 'blocked' });

      if (!(await deps.isOnline())) {
        if (stale()) return;
        return fail({ kind: 'offline', retryable: true });
      }
      if (stale()) return;

      const expected = await deps.expected();
      if (stale()) return;
      if (!expected) return fail({ kind: 'session', retryable: false });

      emit({ phase: 'camera' });
      let opened;
      try {
        opened = await deps.openCamera();
      } catch (error) {
        if (stale()) return;
        // iOS pide el permiso al abrir la cámara: un rechazo llega como NotAllowedError
        const name = error && typeof error === 'object' ? String(error.name || '') : '';
        if (/NotAllowed|Permission|Security/i.test(name)) return fail({ kind: 'camera_denied', retryable: false, settings: true });
        return fail({ kind: 'camera_unavailable', retryable: true });
      }
      if (stale()) {
        try {
          deps.closeCamera(opened);
        } catch {
          // ignore
        }
        return;
      }
      stream = opened;
      emit({ phase: 'requesting', localStream: opened });

      // El token se firma recién ahora (con la cámara abierta): dura poco y no se puede revocar
      let session;
      try {
        session = await deps.requestSession();
      } catch (error) {
        if (stale()) return;
        const failure = await deps.describeApiFailure(error);
        if (stale()) return;
        if (failure.canceled) return stop('leave');
        const { kind, retryable } = classifyApiFailure(failure);
        return fail({ kind, retryable, message: failure.message, retryAfterSeconds: failure.retryAfterSeconds });
      }
      if (stale()) {
        if (session && session.sessionId && deps.endSession) Promise.resolve(deps.endSession(session.sessionId)).catch(() => undefined);
        return;
      }
      sessionId = session && session.sessionId ? session.sessionId : null;
      if (!isSessionFor(session, expected)) return fail({ kind: 'mismatch', retryable: true });

      emit({ phase: 'connecting', maxSeconds: session.maxSessionSeconds });
      connectTimer = timers.setTimeout(() => my === attempt && state.phase === 'connecting' && fail({ kind: 'timeout', retryable: true }), CONNECT_TIMEOUT_MS);

      const handlers = {
        onRemoteStream: (remote) => {
          if (my === attempt) emit({ remoteStream: remote });
        },
        onConnectionChange: (connection) => {
          if (my !== attempt) return;
          emit({ connection });
          if (connection === 'generating') startCountdown(session.maxSessionSeconds, my);
          // El SDK ya agotó sus reintentos: la conexión se perdió
          if (connection === 'disconnected' && client) fail({ kind: 'connection_lost', retryable: true });
        },
        onGenerationTick: (seconds) => {
          if (my === attempt && Number.isFinite(seconds)) emit({ billedSeconds: seconds });
        },
        onError: (error) => {
          if (my !== attempt) return;
          if (isDurationLimitError(error)) return stop('limit');
          const { kind, retryable } = classifySdkError(error);
          fail({ kind, retryable });
        },
        onSessionEnded: (reason) => {
          if (my !== attempt) return;
          const outcome = classifySessionEnd(reason);
          if (outcome.ended) stop(outcome.reason);
          else fail({ kind: outcome.kind, retryable: outcome.retryable });
        },
      };

      let connected;
      try {
        connected = await deps.connect(opened, session, handlers);
      } catch (error) {
        if (stale()) return;
        const { kind, retryable } = classifySdkError(error);
        return fail({ kind, retryable });
      }
      if (stale()) {
        try {
          connected.disconnect();
        } catch {
          // ignore
        }
        return;
      }
      client = connected;
    } catch {
      if (stale()) return;
      fail({ kind: 'unknown', retryable: true });
    }
  };

  return {
    start,
    stop,
    getState: () => state,
    /** Al desmontar la pantalla: cierra todo y no vuelve a notificar. */
    dispose() {
      if (ACTIVE.has(state.phase)) stop('leave');
      else release();
      disposed = true;
    },
  };
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  garmentIssue,
  isSessionFor,
  classifyApiFailure,
  classifySdkError,
  classifySessionEnd,
  isDurationLimitError,
  createLiveTryOnController,
};
