import React from 'react';
import OfflineSuccessClient from '@/components/modules/checkout/OfflineSuccessClient';

export const revalidate = false;

export default function Page() {
    return <OfflineSuccessClient />;
}

export function generateMetadata() {
    return {
        title: 'Pedido guardado',
        description: 'Tu pedido se guardó en tu dispositivo y se enviará al recuperar la conexión',
        icons: {
            icon: '/favicon.ico',
        },
    };
}
