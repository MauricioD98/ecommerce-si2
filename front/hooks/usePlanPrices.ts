"use client";

import { useEffect, useState } from "react";
import { PLANS, type BillingInterval, type PlanKey } from "@/components/modules/platform/plans";
import { platformService, type PlanPrice } from "@/service/api/platform.service";

export interface PlanPriceView {
    amount: number;
    currency: string;
    // false = la API no tiene configurado ese Price en Stripe: el botón se deshabilita
    available: boolean;
}

// Precios reales de Stripe (GET /platform/subscriptions/plans). Mientras carga, o si falla la consulta,
// usa los montos de respaldo de plans.ts y deja contratar: el backend igual valida y responde 503 si falta.
export function usePlanPrices() {
    const [catalog, setCatalog] = useState<PlanPrice[] | null>(null);

    useEffect(() => {
        let active = true;
        platformService
            .getPlans()
            .then((data) => active && setCatalog(data))
            .catch(() => active && setCatalog(null));
        return () => {
            active = false;
        };
    }, []);

    const priceOf = (plan: PlanKey, interval: BillingInterval): PlanPriceView => {
        const real = catalog?.find((p) => p.plan === plan && p.interval === interval);
        const fallback = PLANS.find((p) => p.key === plan)!.amounts[interval];
        if (real?.available && real.amount != null) {
            return { amount: real.amount, currency: real.currency ?? "USD", available: true };
        }
        return { amount: fallback, currency: "USD", available: catalog === null };
    };

    return { priceOf, loaded: catalog !== null };
}
