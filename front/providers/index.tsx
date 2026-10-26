import StateProvider from "./state-provider";
import OfflineSyncProvider from "./OfflineSyncProvider";
import LocaleCartSync from "./LocaleCartSync";
import StoreInfoProvider from "./StoreInfoProvider";
import TenantGate from "@/components/modules/tenant/TenantGate";


export default function Providers({children}:{children: React.ReactNode}){
    return (
        <StateProvider>
            <TenantGate>
                <StoreInfoProvider>
                    <LocaleCartSync />
                    <OfflineSyncProvider>{children}</OfflineSyncProvider>
                </StoreInfoProvider>
            </TenantGate>
        </StateProvider>
    );

}
