import axios from "axios";

// Convierte cualquier error de red/API en un mensaje legible en español para el usuario
export function getApiErrorMessage(
    error: unknown,
    fallback = "Ocurrió un error inesperado. Inténtalo de nuevo."
): string {
    if (axios.isAxiosError(error)) {
        if (!error.response) {
            // Sin respuesta del servidor: si el navegador ya sabe que no hay red, el mensaje lo dice
            // directamente en vez de sugerir "inténtalo más tarde" como si fuera un problema del servidor
            if (typeof navigator !== "undefined" && !navigator.onLine) {
                return "No podemos cargar esta información sin conexión a Internet.";
            }
            return error.code === "ECONNABORTED"
                ? "El servidor tardó demasiado en responder. Inténtalo de nuevo."
                : "No se pudo conectar con el servidor. Inténtalo más tarde.";
        }

        const status = error.response.status;
        const message = error.response.data?.message;

        // El mensaje específico del backend siempre tiene prioridad sobre el genérico de "status >= 500".
        // Antes era al revés: cualquier 5xx (incluido un 503 deliberado y bien armado, como el de la IA de
        // Reportes: "No se pudo generar la consulta con la IA. Inténtalo de nuevo") se pisaba con el
        // genérico "El servidor tuvo un problema", ocultando la razón real sin importar cuál fuera
        // (cuota agotada, IA no configurada, timeout de la consulta, etc.).
        if (Array.isArray(message)) {
            return message.join(". ");
        }
        if (typeof message === "string" && message.trim()) {
            return message;
        }
        if (status >= 500) {
            return "El servidor tuvo un problema. Inténtalo más tarde.";
        }
        if (status === 404) {
            return "Esta función aún no está disponible.";
        }
    }
    return fallback;
}
