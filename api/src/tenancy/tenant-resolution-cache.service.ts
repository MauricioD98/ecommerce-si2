import { Injectable } from '@nestjs/common';
import { TenantContext } from './tenant-context';

const CACHE_TTL_MS = 60_000;
// Tope de entradas: la clave sale del request (cualquier UUID que mande un cliente), así que sin
// límite un script con UUIDs aleatorios haría crecer el Map hasta agotar la memoria del proceso.
const CACHE_MAX_ENTRIES = 5_000;

/**
 * Cache de "id/slug → tienda" que usa TenantMiddleware para no consultar public en cada request.
 * Es un servicio aparte para que el plano de control pueda invalidarla: al suspender o reactivar
 * una tienda el cambio rige en el acto en esta instancia. Con varias réplicas de la API, las demás
 * lo ven al vencer su entrada (≤ 60 s): el cache es por proceso.
 */
@Injectable()
export class TenantResolutionCache {
    private readonly entries = new Map<string, { ctx: TenantContext | null; at: number }>();

    /** undefined = no hay entrada vigente; null = la tienda no existe o no está ACTIVE */
    get(key: string): TenantContext | null | undefined {
        const hit = this.entries.get(key);
        if (!hit || Date.now() - hit.at >= CACHE_TTL_MS) return undefined;
        return hit.ctx;
    }

    set(key: string, ctx: TenantContext | null): void {
        if (this.entries.size >= CACHE_MAX_ENTRIES) {
            // Map conserva el orden de inserción: se descarta la entrada más vieja (FIFO acotado)
            this.entries.delete(this.entries.keys().next().value as string);
        }
        this.entries.set(key, { ctx, at: Date.now() });
    }

    /** Olvida todo lo resuelto para esa tienda (por id y por slug). */
    invalidate(tenantId: string, slug?: string): void {
        this.entries.delete(`id:${tenantId}`);
        if (slug) this.entries.delete(`slug:${slug}`);
        for (const [key, entry] of this.entries) {
            if (entry.ctx?.tenantId === tenantId) this.entries.delete(key);
        }
    }
}
