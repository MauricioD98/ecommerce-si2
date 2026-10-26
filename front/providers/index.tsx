import StateProvider from "./state-provider";
import OfflineSyncProvider from "./OfflineSyncProvider";
import LocaleCartSync from "./LocaleCartSync";
import StoreInfoProvider from "./StoreInfoProvider";
import StoreAppearanceProvider from "./StoreAppearanceProvider";
import TenantGate from "@/components/modules/tenant/TenantGate";
import type { StoreAppearance } from "@/types/appearance.types";


export default function Providers({children, appearance}:{children: React.ReactNode; appearance: StoreAppearance}){
    return (
        <StateProvider>
            <TenantGate>
                <StoreInfoProvider>
                    <StoreAppearanceProvider value={appearance}>
                        <LocaleCartSync />
                        <OfflineSyncProvider>{children}</OfflineSyncProvider>
                    </StoreAppearanceProvider>
                </StoreInfoProvider>
            </TenantGate>
        </StateProvider>
    );

}
