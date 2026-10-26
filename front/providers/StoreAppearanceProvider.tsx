'use client';

import React, { createContext, useContext } from 'react';
import { DEFAULT_APPEARANCE, StoreAppearance } from '@/types/appearance.types';

const StoreAppearanceContext = createContext<StoreAppearance>(DEFAULT_APPEARANCE);

// Apariencia de la tienda para los componentes cliente (logo del Header). La lee el layout en el
// servidor y llega por props: cuando StoreInfoProvider hace router.refresh() al descubrir la tienda,
// el layout se vuelve a renderizar y este valor se actualiza solo.
export default function StoreAppearanceProvider({ value, children }: { value: StoreAppearance; children: React.ReactNode }) {
    return <StoreAppearanceContext.Provider value={value}>{children}</StoreAppearanceContext.Provider>;
}

export const useStoreAppearance = () => useContext(StoreAppearanceContext);
