export interface LiveSession {
  sessionId: string;
  apiKey: string;
  expiresAt: string;
  model: 'lucy-2.5';
  maxSessionSeconds: number;
  prompt: string;
  garmentImage: string;
  productId: string;
  tenantId: string;
  userId: string;
}

export interface Expected {
  tenantId: string;
  userId: string;
  productId: string;
}

export type GarmentIssue = 'unavailable' | 'no_image';

export type LiveErrorKind =
  | 'session'
  | 'plan'
  | 'garment_unavailable'
  | 'garment_no_image'
  | 'garment_image_unavailable'
  | 'garment_image_too_small'
  | 'not_enabled'
  | 'busy'
  | 'store_busy'
  | 'hourly_limit'
  | 'clock_skew'
  | 'rate_limited'
  | 'timeout'
  | 'offline'
  | 'network'
  | 'provider'
  | 'provider_credits'
  | 'policy'
  | 'token'
  | 'connection_lost'
  | 'native_missing'
  | 'camera_denied'
  | 'camera_unavailable'
  | 'mismatch'
  | 'unknown';

export type Phase = 'idle' | 'permission' | 'camera' | 'requesting' | 'connecting' | 'live' | 'ended' | 'error';
export type EndReason = 'user' | 'limit' | 'background' | 'offline' | 'leave' | 'provider';
export type ConnectionState = 'connecting' | 'connected' | 'generating' | 'reconnecting' | 'disconnected';

export interface LiveError {
  kind: LiveErrorKind;
  retryable: boolean;
  settings?: boolean;
  message?: string;
  retryAfterSeconds?: number;
}

export interface LiveState<TStream = unknown> {
  phase: Phase;
  connection: ConnectionState | null;
  localStream: TStream | null;
  remoteStream: TStream | null;
  maxSeconds: number | null;
  secondsLeft: number | null;
  billedSeconds: number;
  endReason: EndReason | null;
  error: LiveError | null;
}

export interface ApiFailure {
  canceled?: boolean;
  status?: number;
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
  timedOut?: boolean;
  networkError?: boolean;
  sessionExpired?: boolean;
  online?: boolean;
}

export interface LiveHandlers<TStream> {
  onRemoteStream(stream: TStream): void;
  onConnectionChange(state: ConnectionState): void;
  onGenerationTick(seconds: number): void;
  onError(error: unknown): void;
  onSessionEnded(reason: string): void;
}

export interface LiveDeps<TStream> {
  requestCameraPermission(): Promise<'granted' | 'denied' | 'blocked'>;
  isOnline(): Promise<boolean>;
  expected(): Promise<Expected | null>;
  openCamera(): Promise<TStream>;
  closeCamera(stream: TStream): void;
  requestSession(): Promise<LiveSession>;
  describeApiFailure(error: unknown): Promise<ApiFailure>;
  connect(stream: TStream, session: LiveSession, handlers: LiveHandlers<TStream>): Promise<{ disconnect(): void }>;
  endSession?(sessionId: string): Promise<void>;
  onChange?(state: LiveState<TStream>): void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  now?: () => number;
}

export interface LiveController<TStream> {
  start(): Promise<void>;
  stop(reason?: EndReason): void;
  getState(): LiveState<TStream>;
  dispose(): void;
}

export const CONNECT_TIMEOUT_MS: number;
export function garmentIssue(product: { imageUrl?: string | null; isActive?: boolean } | null | undefined): GarmentIssue | null;
export function isSessionFor(session: unknown, expected: Expected): session is LiveSession;
export function classifyApiFailure(failure: ApiFailure | null | undefined): { kind: LiveErrorKind; retryable: boolean };
export function classifySdkError(error: unknown): { kind: LiveErrorKind; retryable: boolean };
export function classifySessionEnd(reason: string): { ended: true; reason: EndReason } | { ended: false; kind: LiveErrorKind; retryable: boolean };
export function isDurationLimitError(error: unknown): boolean;
export function createLiveTryOnController<TStream = unknown>(deps: LiveDeps<TStream>): LiveController<TStream>;
