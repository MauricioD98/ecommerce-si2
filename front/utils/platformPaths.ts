// Páginas del SaaS (no de una tienda): landing de planes, vuelta de Stripe, contacto y el panel de
// plataforma.
//   - TenantGate no muestra el selector de tienda en ellas (el visitante todavía no tiene tienda)
//   - front/proxy.ts responde 404 en los dominios propios de las tiendas (el cliente final no ve el SaaS)
const PLATFORM_PATH_PREFIXES = ["/planes", "/contacto", "/plataforma"];

export function isPlatformPath(pathname: string): boolean {
    return PLATFORM_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
