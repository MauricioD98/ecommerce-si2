import { useEffect, useState } from "react";
import { LOCALE_CHANGED_EVENT } from "@/i18n/client";

// Contador que sube cada vez que el usuario cambia de idioma. Va en las dependencias de los efectos que
// cargan datos traducidos por la API (pedidos, detalle), así se vuelven a pedir en el idioma nuevo.
export function useLocaleVersion(): number {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const bump = () => setVersion((value) => value + 1);
        window.addEventListener(LOCALE_CHANGED_EVENT, bump);
        return () => window.removeEventListener(LOCALE_CHANGED_EVENT, bump);
    }, []);

    return version;
}
