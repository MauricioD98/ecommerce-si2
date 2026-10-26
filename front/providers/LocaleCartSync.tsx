'use client';

import { useEffect } from 'react';
import { useCart } from '@/hooks/useCart';
import { useSelectedBranchId } from '@/hooks/useBranches';
import { LOCALE_CHANGED_EVENT } from '@/i18n/client';

// El carrito guarda en Redux el producto completo (nombre incluido) tal como vino de la API: al cambiar
// de idioma se vuelve a pedir cada producto para que el nombre salga en el idioma nuevo.
export default function LocaleCartSync() {
    const { syncCartProducts } = useCart();
    const branchId = useSelectedBranchId();

    useEffect(() => {
        const sync = () => {
            syncCartProducts(branchId).catch(() => undefined);
        };
        window.addEventListener(LOCALE_CHANGED_EVENT, sync);
        return () => window.removeEventListener(LOCALE_CHANGED_EVENT, sync);
    }, [syncCartProducts, branchId]);

    return null;
}
