import LanguageBar from "@/components/modules/i18n/LanguageBar";

// Login, registro y recuperación no llevan el Header de la tienda, pero sí el selector de idioma:
// quien llega directo por un enlace tiene que poder cambiarlo antes de iniciar sesión.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <LanguageBar />
            {children}
        </>
    );
}
