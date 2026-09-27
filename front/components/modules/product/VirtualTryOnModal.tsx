'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, Loader2, PowerOff, ScanFace, Sparkles, X } from 'lucide-react';
import { createDecartClient, models } from '@decartai/sdk';
import type { DecartSDKError, RealTimeClient } from '@decartai/sdk';
import { store } from '@/store';
import { Product } from '@/types/product.types';
import styles from './virtual-try-on.module.scss';

// Probador Virtual sobre Decart (modelo realtime lucy-vton-latest): la cámara del usuario entra por
// WebRTC y vuelve el mismo video con la prenda puesta. El WebRTC lo maneja el SDK (no armamos el
// RTCPeerConnection a mano): nosotros le pasamos el MediaStream y él negocia con la plataforma.
//
// Decart factura por SEGUNDO GENERADO, así que el control de gasto es triple:
//  1. El token efímero que firma /api/decart/session trae maxSessionDuration (techo del servidor).
//  2. El setTimeout de TRYON_SECONDS de acá corta la sesión desde el cliente.
//  3. El botón rojo permite cortar antes.
// El contador arranca cuando el modelo empieza a generar ('generating'), que es cuando corre el
// reloj de la facturación; no cuando se abre el modal.

const TRYON_SECONDS = 15;
// Si la conexión nunca llega a generar (cola, red mala), se cierra todo igual para no dejar la
// cámara encendida ni una sesión colgada.
const CONNECT_TIMEOUT_MS = 30000;

type Phase = 'starting' | 'connecting' | 'live' | 'ended' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
    starting: 'Encendiendo la cámara…',
    connecting: 'Conectando con el probador…',
    live: 'Probador activo',
    ended: 'Sesión finalizada',
    error: 'No se pudo iniciar',
};

// El modelo espera instrucciones en inglés con el patrón "substitute ... with ...". Se arma con los
// datos del catálogo; `enhance: true` deja que Decart reescriba el prompt, lo que ayuda cuando el
// nombre del producto viene en español.
const buildTryOnPrompt = (product: Product): string => {
    const color = product.colors?.[0];
    const garment = [color, product.name].filter(Boolean).join(' ');
    return (
        `Substitute the current outfit with ${garment}. ` +
        `Keep the exact fabric texture, shape and color of the reference garment, ` +
        `and match the movements of the person in frame.`
    );
};

export default function VirtualTryOnModal({ product, onClose }: { product: Product; onClose: () => void }) {
    const [phase, setPhase] = useState<Phase>('starting');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(TRYON_SECONDS);
    const [billedSeconds, setBilledSeconds] = useState(0);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const clientRef = useRef<RealTimeClient | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const cutoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const connectGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Evita que el corte corra dos veces (el timeout, el botón y el unmount compiten por cerrar).
    const stoppedRef = useRef(false);

    // stop() no vive en el render: lo llaman timers y callbacks del SDK. Si no fuera estable, el
    // efecto de arranque se volvería a ejecutar y abriría una segunda sesión (= doble cobro).
    const stop = useCallback((reason?: string) => {
        if (stoppedRef.current) return;
        stoppedRef.current = true;

        if (cutoffRef.current) clearTimeout(cutoffRef.current);
        if (connectGuardRef.current) clearTimeout(connectGuardRef.current);
        if (tickRef.current) clearInterval(tickRef.current);
        cutoffRef.current = null;
        connectGuardRef.current = null;
        tickRef.current = null;

        clientRef.current?.disconnect();
        clientRef.current = null;

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        setSecondsLeft(0);
        if (reason) {
            setErrorMessage(reason);
            setPhase('error');
        } else {
            setPhase('ended');
        }
    }, []);

    // Arranca el descuento de 15s. Se llama en el primer 'generating'; las siguientes veces no hace
    // nada (el estado puede volver a 'generating' tras un reconnect y no queremos regalar tiempo).
    const startCountdown = useCallback(() => {
        if (cutoffRef.current) return;

        if (connectGuardRef.current) {
            clearTimeout(connectGuardRef.current);
            connectGuardRef.current = null;
        }

        setPhase('live');
        setSecondsLeft(TRYON_SECONDS);

        const startedAt = Date.now();
        tickRef.current = setInterval(() => {
            setSecondsLeft(Math.max(0, TRYON_SECONDS - Math.floor((Date.now() - startedAt) / 1000)));
        }, 250);

        cutoffRef.current = setTimeout(() => stop(), TRYON_SECONDS * 1000);
    }, [stop]);

    useEffect(() => {
        let cancelled = false;
        // El guard es por sesión: si el efecto se vuelve a correr (otro producto), el cleanup anterior
        // ya dejó stoppedRef en true y sin este reset la nueva sesión nunca podría cortarse — la cámara
        // quedaría encendida y facturando hasta el techo del servidor.
        stoppedRef.current = false;

        const start = async () => {
            try {
                // 1. Cámara del usuario. El modelo genera a 1280x720, así que se pide ese ideal y no
                //    se gasta ancho de banda en algo que Decart va a reescalar igual.
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                if (localVideoRef.current) localVideoRef.current.srcObject = stream;
                setPhase('connecting');

                // 2. Bytes de la prenda. Van por nuestro proxy para no depender del CORS del host de
                //    la imagen (el SDK necesita el Blob de referencia).
                const garmentResponse = await fetch(`/api/decart/garment?url=${encodeURIComponent(product.imageUrl)}`);
                if (!garmentResponse.ok) throw new Error('No se pudo cargar la imagen de la prenda.');
                const garmentBlob = await garmentResponse.blob();
                if (cancelled) return;

                // 3. Token efímero firmado por el servidor. La DECART_API_KEY nunca llega al browser.
                const accessToken = store.getState().auth.accessToken;
                const sessionResponse = await fetch('/api/decart/session', {
                    method: 'POST',
                    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
                });
                const session = await sessionResponse.json();
                if (!sessionResponse.ok) throw new Error(session?.message ?? 'No se pudo iniciar la sesión.');
                if (cancelled) return;

                // 4. Conexión realtime: el SDK abre el WebRTC y devuelve el stream transformado.
                const decart = createDecartClient({ apiKey: session.apiKey });
                const realtime = await decart.realtime.connect(stream, {
                    model: models.realtime(session.model),
                    resolution: '720p',
                    mirror: 'auto',
                    initialState: {
                        prompt: { text: buildTryOnPrompt(product), enhance: true },
                        image: garmentBlob,
                    },
                    onRemoteStream: (remoteStream) => {
                        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
                    },
                    onConnectionChange: (state) => {
                        if (state === 'generating') startCountdown();
                    },
                });

                if (cancelled) {
                    realtime.disconnect();
                    return;
                }
                clientRef.current = realtime;

                realtime.on('generationTick', ({ seconds }) => setBilledSeconds(seconds));
                realtime.on('sessionEnded', () => stop());
                realtime.on('error', (sdkError: DecartSDKError) => {
                    stop(
                        sdkError.code === 'INVALID_API_KEY'
                            ? 'La sesión con el probador expiró. Volvé a intentar.'
                            : sdkError.message,
                    );
                });

                // Red de seguridad: si nunca empieza a generar, no dejamos nada abierto.
                connectGuardRef.current = setTimeout(
                    () => stop('El probador no respondió a tiempo. Revisá tu conexión e intentá de nuevo.'),
                    CONNECT_TIMEOUT_MS,
                );
            } catch (error) {
                if (cancelled) return;
                const cameraDenied =
                    error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'NotFoundError');
                stop(
                    cameraDenied
                        ? 'Necesitamos permiso de cámara para probarte la prenda.'
                        : error instanceof Error
                          ? error.message
                          : 'No se pudo iniciar el probador virtual.',
                );
            }
        };

        start();

        return () => {
            cancelled = true;
            stop();
        };
    }, [product, startCountdown, stop]);

    // Cerrar la pestaña con la sesión abierta seguiría facturando: se corta en beforeunload.
    useEffect(() => {
        const handleUnload = () => stop();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, stop]);

    const isBusy = phase === 'starting' || phase === 'connecting';
    const progress = phase === 'live' ? (secondsLeft / TRYON_SECONDS) * 100 : 0;

    return (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Probador virtual">
            <div className={styles.modal}>
                <header className={styles.header}>
                    <div className={styles.headerTitle}>
                        <ScanFace size={20} />
                        <div>
                            <h2 className={styles.title}>Probador Virtual</h2>
                            <p className={styles.subtitle}>{product.name}</p>
                        </div>
                    </div>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Cerrar">
                        <X size={20} />
                    </button>
                </header>

                <div className={styles.stage}>
                    <video ref={remoteVideoRef} className={styles.remoteVideo} autoPlay playsInline muted />

                    {isBusy && (
                        <div className={styles.stageOverlay}>
                            <Loader2 size={32} className={styles.spinner} />
                            <p>{PHASE_LABEL[phase]}</p>
                        </div>
                    )}

                    {phase === 'error' && (
                        <div className={styles.stageOverlay}>
                            <AlertTriangle size={32} className={styles.errorIcon} />
                            <p className={styles.errorText}>{errorMessage}</p>
                        </div>
                    )}

                    {phase === 'ended' && (
                        <div className={styles.stageOverlay}>
                            <Sparkles size={32} />
                            <p>Terminó la prueba de {TRYON_SECONDS}s.</p>
                            <p className={styles.mutedText}>Cerrá y volvé a abrir el probador para otra pasada.</p>
                        </div>
                    )}

                    <video ref={localVideoRef} className={styles.localVideo} autoPlay playsInline muted />

                    <div className={styles.garmentChip}>
                        <Image
                            src={product.imageUrl}
                            alt={product.name}
                            width={44}
                            height={44}
                            className={styles.garmentThumb}
                        />
                        <span>Prenda de referencia</span>
                    </div>

                    {phase === 'live' && (
                        <div className={styles.countdown} aria-live="polite">
                            <span className={styles.countdownValue}>{secondsLeft}s</span>
                            <span className={styles.countdownLabel}>restantes</span>
                        </div>
                    )}
                </div>

                {phase === 'live' && (
                    <div className={styles.progressTrack}>
                        <div className={styles.progressBar} style={{ width: `${progress}%` }} />
                    </div>
                )}

                <footer className={styles.footer}>
                    <p className={styles.usage}>
                        {phase === 'live' || phase === 'ended'
                            ? `${billedSeconds}s de generación facturados`
                            : `La prueba dura ${TRYON_SECONDS}s y se corta sola.`}
                    </p>

                    {phase === 'live' ? (
                        <button type="button" className={styles.disconnectButton} onClick={() => stop()}>
                            <PowerOff size={20} />
                            Desconectar ahora
                        </button>
                    ) : (
                        // Nunca se deshabilita: si el handshake se cuelga, el usuario tiene que poder
                        // abandonar y cortar la sesión antes de que empiece a generar.
                        <button type="button" className={styles.closeButton} onClick={onClose}>
                            {isBusy ? 'Cancelar' : 'Cerrar'}
                        </button>
                    )}
                </footer>
            </div>
        </div>
    );
}
