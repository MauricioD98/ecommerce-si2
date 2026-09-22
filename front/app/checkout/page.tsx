import React from 'react';
import CheckoutClient from '@/components/modules/checkout/CheckoutClient';

export const revalidate = false;

export default function Page() {
    return <CheckoutClient />;
}

export function generateMetadata() {
    return {
        title: 'Finalizar Compra',
        description: 'Completa tu pedido',
        icons: {
            icon: '/favicon.ico',
        },
    };
}

