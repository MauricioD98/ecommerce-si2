"use server";

import { updateTag } from "next/cache";
import { appearanceCacheTag } from "@/types/appearance.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Después de guardar en el panel: expira la apariencia cacheada del layout para que la tienda muestre
// el cambio en la próxima carga (sin esto tardaría hasta 5 min). Solo borra caché, no autoriza nada:
// el guardado real ya lo hizo la API con el JWT y MANAGE_APPEARANCE.
export async function refreshStoreAppearance(tenantId: string): Promise<void> {
    const id = tenantId.trim().toLowerCase();
    if (!UUID_RE.test(id)) return;
    updateTag(appearanceCacheTag(id));
}
