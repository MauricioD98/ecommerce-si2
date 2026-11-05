'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/service/api/axios.config';
import { getCurrentTenantId } from '@/utils/tenant';
import { PLATFORM_BRAND, STORE_HINT_COOKIE, storeNameCacheKey } from '@/utils/storeName';

export interface PlanFeatures {
    planKey: 'starter' | 'growth' | 'pro' | 'legacy';
    planName: string;
    maxBranches: number | null;
    maxProducts: number | null;
    pos: boolean;
    returns: boolean;
    multiBranchInventory: boolean;
    customDomain: boolean;
    aiReports: boolean;
    virtualTryOn: boolean;
    campaigns: boolean;
    qrPayments: boolean;
    digitalWallet: boolean;
    mobileApp: boolean;
}

export const DEFAULT_PLAN_FEATURES: PlanFeatures = {
    planKey: 'pro',
    planName: 'Pro',
    maxBranches: null,
    maxProducts: null,
    pos: true,
    returns: true,
    multiBranchInventory: true,
    customDomain: true,
    aiReports: true,
    virtualTryOn: true,
    campaigns: true,
    qrPayments: true,
    digitalWallet: true,
    mobileApp: true,
};

interface StorePlanContextValue {
    plan: string;
    features: PlanFeatures;
    refreshStoreInfo: () => void;
}

const StoreNameContext = createContext<string>(PLATFORM_BRAND);
const StorePlanContext = createContext<StorePlanContextValue>({
    plan: 'pro',
    features: DEFAULT_PLAN_FEATURES,
    refreshStoreInfo: () => undefined,
});

const storePlanCacheKey = (tenantId: string) => `tenant_plan_features:${tenantId}`;

const readCachedName = (tenantId: string | null): string | null => {
    if (!tenantId) return null;
    try {
        return localStorage.getItem(storeNameCacheKey(tenantId));
    } catch {
        return null;
    }
};

const readCachedPlan = (tenantId: string | null): { plan: string; features: PlanFeatures } | null => {
    if (!tenantId) return null;
    try {
        const raw = localStorage.getItem(storePlanCacheKey(tenantId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { plan?: string; features?: PlanFeatures };
        if (parsed && parsed.features && typeof parsed.features.planName === 'string') {
            return { plan: parsed.plan ?? parsed.features.planKey, features: parsed.features };
        }
        return null;
    } catch {
        return null;
    }
};

// Nombre y plan de la tienda actual para toda la UI. Arranca con el último estado conocido
// (también sirve offline) y se actualiza con GET /store. Además deja la cookie STORE_HINT_COOKIE para
// que el servidor ponga ese nombre en los títulos de página y el manifest.
export default function StoreInfoProvider({ children }: { children: React.ReactNode }) {
    const [name, setName] = useState<string>(PLATFORM_BRAND);
    const [plan, setPlan] = useState<string>('pro');
    const [features, setFeatures] = useState<PlanFeatures>(DEFAULT_PLAN_FEATURES);
    const router = useRouter();

    const fetchStoreInfo = useCallback(() => {
        const tenantId = getCurrentTenantId();
        if (!tenantId) return;

        apiClient
            .get<{ data: { name: string; plan?: string; features?: PlanFeatures } }>('/store')
            .then(({ data }) => {
                const freshName = data.data.name?.trim();
                if (freshName) {
                    setName(freshName);
                    try {
                        localStorage.setItem(storeNameCacheKey(tenantId), freshName);
                    } catch {
                        // sin storage
                    }
                }
                if (data.data.features) {
                    const nextPlan = data.data.plan ?? data.data.features.planKey;
                    setPlan(nextPlan);
                    setFeatures(data.data.features);
                    try {
                        localStorage.setItem(
                            storePlanCacheKey(tenantId),
                            JSON.stringify({ plan: nextPlan, features: data.data.features }),
                        );
                    } catch {
                        // sin storage
                    }
                }
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        const tenantId = getCurrentTenantId();
        if (!tenantId) return;

        const cachedName = readCachedName(tenantId);
        if (cachedName) setName(cachedName);

        const cachedPlan = readCachedPlan(tenantId);
        if (cachedPlan) {
            setPlan(cachedPlan.plan);
            setFeatures(cachedPlan.features);
        }

        // Si el servidor renderizó sin conocer esta tienda (primera visita, o se cambió de tienda), el
        // título de la pestaña salió con otra marca: se guarda la pista y se vuelve a pedir una vez el
        // árbol del servidor, que ahora sí la lee
        const hinted = document.cookie.split('; ').find((part) => part.startsWith(`${STORE_HINT_COOKIE}=`))?.split('=')[1];
        document.cookie = `${STORE_HINT_COOKIE}=${tenantId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        if (hinted !== tenantId) router.refresh();

        fetchStoreInfo();
    }, [router, fetchStoreInfo]);

    const planValue = useMemo(
        () => ({ plan, features, refreshStoreInfo: fetchStoreInfo }),
        [plan, features, fetchStoreInfo],
    );

    return (
        <StoreNameContext.Provider value={name}>
            <StorePlanContext.Provider value={planValue}>{children}</StorePlanContext.Provider>
        </StoreNameContext.Provider>
    );
}

export const useStoreName = () => useContext(StoreNameContext);
export const useStorePlan = () => useContext(StorePlanContext);
