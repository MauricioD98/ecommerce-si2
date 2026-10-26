'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/service/api/axios.config';
import { getCurrentTenantId } from '@/utils/tenant';
import { PLATFORM_BRAND, STORE_HINT_COOKIE, storeNameCacheKey } from '@/utils/storeName';

const StoreNameContext = createContext<string>(PLATFORM_BRAND);

const readCached = (tenantId: string | null): string | null => {
    if (!tenantId) return null;
    try {
        return localStorage.getItem(storeNameCacheKey(tenantId));
    } catch {
        return null;
    }
};

// Nombre de la tienda actual para toda la UI de la tienda. Arranca con el último nombre conocido
// (también sirve offline) y se actualiza con GET /store. Además deja la cookie STORE_HINT_COOKIE para
// que el servidor ponga ese nombre en los títulos de página y el manifest.
export default function StoreInfoProvider({ children }: { children: React.ReactNode }) {
    const [name, setName] = useState<string>(PLATFORM_BRAND);
    const router = useRouter();

    useEffect(() => {
        const tenantId = getCurrentTenantId();
        if (!tenantId) return;

        const cached = readCached(tenantId);
        if (cached) setName(cached);

        // Si el servidor renderizó sin conocer esta tienda (primera visita, o se cambió de tienda), el
        // título de la pestaña salió con otra marca: se guarda la pista y se vuelve a pedir una vez el
        // árbol del servidor, que ahora sí la lee
        const hinted = document.cookie.split('; ').find((part) => part.startsWith(`${STORE_HINT_COOKIE}=`))?.split('=')[1];
        document.cookie = `${STORE_HINT_COOKIE}=${tenantId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        if (hinted !== tenantId) router.refresh();

        apiClient
            .get<{ data: { name: string } }>('/store')
            .then(({ data }) => {
                const fresh = data.data.name?.trim();
                if (!fresh) return;
                setName(fresh);
                try {
                    localStorage.setItem(storeNameCacheKey(tenantId), fresh);
                } catch {
                    // sin storage: el nombre se vuelve a pedir en la próxima carga
                }
            })
            .catch(() => undefined);
    }, [router]);

    return <StoreNameContext.Provider value={name}>{children}</StoreNameContext.Provider>;
}

export const useStoreName = () => useContext(StoreNameContext);
