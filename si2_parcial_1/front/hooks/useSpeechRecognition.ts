import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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

// Mensajes en español para los códigos de error de la API
const ERROR_MESSAGES: Record<string, string> = {
    "not-allowed": "Permiso de micrófono denegado. Actívalo en la configuración del navegador.",
    "service-not-allowed": "El navegador no permite el reconocimiento de voz en este sitio.",
    "audio-capture": "No se encontró ningún micrófono.",
    "no-speech": "No se escuchó nada. Inténtalo de nuevo.",
    network: "No se pudo conectar con el servicio de reconocimiento de voz.",
};

const subscribeNoop = () => () => {};

interface UseSpeechRecognitionOptions {
    // es-BO: español de Bolivia (si el navegador no lo reconoce usa el español general)
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
                setError("Tu navegador no permite el dictado por voz. Usa Chrome, Edge o Safari.");
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
                    setError(ERROR_MESSAGES[event.error] ?? "No se pudo usar el micrófono.");
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
                setError("No se pudo iniciar el micrófono. Inténtalo de nuevo.");
            }
        },
        [lang]
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
