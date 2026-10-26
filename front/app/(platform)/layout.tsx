import { PlatformFooter, PlatformNav } from "@/components/modules/platform/PlatformNav";

// Páginas del SaaS (/planes, /contacto): no llevan el Header de la tienda (carrito, sucursal…),
// pero sí su propia navegación con el selector de idioma (lo primero que ve un posible cliente de otro
// país) y un pie común.
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <PlatformNav />
            {children}
            <PlatformFooter />
        </>
    );
}
