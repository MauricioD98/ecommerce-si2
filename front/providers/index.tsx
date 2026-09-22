import StateProvider from "./state-provider";
import OfflineSyncProvider from "./OfflineSyncProvider";


export default function Providers({children}:{children: React.ReactNode}){
    return (
        <StateProvider>
            <OfflineSyncProvider>{children}</OfflineSyncProvider>
        </StateProvider>
    );

}