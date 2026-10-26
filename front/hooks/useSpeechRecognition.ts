import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

// La Web Speech API no viene en los tipos de TypeScript: se declara solo lo que se usa
interface SpeechRecognitionAlternativeLike {
    transcript: string;
}

interface SpeechRecognitionResultLike {
    0: SpeechRecognitionAlternativeLike;
    isFinal: boolean;
}

interface SpeechRecognitionEventLike {
    results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
    error: string;
}

interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const getRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// Códigos de error de la API con mensaje propio (Reports.speech.<código>); el resto usa "generic"
const KNOWN_ERRORS = ["not-allowed", "service-not-allowed", "audio-capture", "no-speech", "network"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];
const isKnownError = (code: string): code is KnownError => (KNOWN_ERRORS as readonly string[]).includes(code);

const subscribeNoop = () => () => {};

interface UseSpeechRecognitionOptions {
    // Etiqueta BCP 47 (es-BO, en-US…); si el navegador no reconoce la región usa el idioma general
    lang?: string;
    // Se llama con el texto completo (lo que ya había + lo dictado) cada vez que llega una transcripción
    onText: (text: string) => void;
}

// Dictado por voz con la Web Speech API del navegador (Chrome, Edge, Safari). Solo transcribe:
// no envía nada; al terminar de hablar el usuario revisa el texto y decide si consultar.
export function useSpeechRecognition({ lang = "es-BO", onText }: UseSpeechRecognitionOptions) {
    // false en el servidor y en el primer render, para no desajustar la hidratación
    const isSupported = useSyncExternalStore(
        subscribeNoop,
        () => getRecognitionConstructor() !== null,
        () => false
    );

    const [isListening, setIsListening] = useState(false);
    const t = useTranslations("Reports.speech");
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const onTextRef = useRef(onText);

    useEffect(() => {
        onTextRef.current = onText;
    }, [onText]);

    // Al salir de la pantalla se corta el micrófono
    useEffect(() => {
        return () => {
            recognitionRef.current?.abort();
        };
    }, []);

    const stop = useCallback(() => {
        recognitionRef.current?.stop();
    }, []);

    // baseText: el texto que ya estaba escrito; lo dictado se agrega a continuación
    const start = useCallback(
        (baseText: string) => {
            const Recognition = getRecognitionConstructor();
            if (!Recognition) {
                setError(t("unsupported"));
                return;
            }

            const recognition = new Recognition();
            recognition.lang = lang;
            // Una sola frase por vez; interimResults muestra el texto mientras se habla
            recognition.continuous = false;
            recognition.interimResults = true;

            const prefix = baseText.trim();

            recognition.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map((result) => result[0].transcript)
                    .join("")
                    .trim();
                onTextRef.current(prefix ? `${prefix} ${transcript}` : transcript);
            };

            recognition.onerror = (event) => {
                // "aborted" ocurre al cortar a propósito: no es un error para el usuario
                if (event.error !== "aborted") {
                    setError(isKnownError(event.error) ? t(event.error) : t("generic"));
                }
            };

            // Se dispara al terminar de hablar (o por error): se libera el micrófono
            recognition.onend = () => {
                setIsListening(false);
                recognitionRef.current = null;
            };

            setError(null);
            try {
                recognition.start();
                recognitionRef.current = recognition;
                setIsListening(true);
            } catch {
                // start() lanza si ya había una sesión activa
                setError(t("startFailed"));
            }
        },
        [lang, t]
    );

    const toggle = useCallback(
        (baseText: string) => {
            if (recognitionRef.current) {
                stop();
            } else {
                start(baseText);
            }
        },
        [start, stop]
    );

    return { isSupported, isListening, error, toggle, stop };
}
