"use client";

import { useEffect, useState } from "react";
import { authService, PublicTenant } from "@/service/api/auth.service";
import { getCurrentTenantId, isCustomDomainTenant } from "@/utils/tenant";

export function usePublicTenants() {
    const [tenants, setTenants] = useState<PublicTenant[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCustomDomain, setIsCustomDomain] = useState(false);
    const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);

    useEffect(() => {
        const custom = isCustomDomainTenant();
        setIsCustomDomain(custom);
        setCurrentTenantId(getCurrentTenantId());

        if (custom) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        authService
            .getPublicTenants()
            .then((list) => {
                if (!cancelled) setTenants(list);
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return {
        tenants,
        currentTenantId,
        isCustomDomain,
        isLoading,
    };
}

