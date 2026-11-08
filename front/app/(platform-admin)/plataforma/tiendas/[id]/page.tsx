import { Suspense } from "react";
import PlatformTenantDetail from "@/components/modules/platform-admin/PlatformTenantDetail";

// Detalle de una tienda: /plataforma/tiendas/<uuid>. Los datos los pide el cliente con el token de
// plataforma (GET /platform/tenants/:id); la API valida el UUID y el permiso.
export default async function PlataformaTiendaDetallePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return (
        <Suspense>
            <PlatformTenantDetail tenantId={id} />
        </Suspense>
    );
}
