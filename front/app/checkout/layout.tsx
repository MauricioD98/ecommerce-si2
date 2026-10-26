import LanguageBar from "@/components/modules/i18n/LanguageBar";

// El checkout no lleva el Header de la tienda: el selector de idioma va en su propia franja
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <LanguageBar />
            {children}
        </>
    );
}
