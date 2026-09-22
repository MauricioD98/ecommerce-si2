import React, { Suspense } from 'react';
import CheckoutSuccessClient from '@/components/modules/checkout/CheckoutSuccessClient';

export const revalidate = false;

export default function Page() {
    return (
        <Suspense fallback={null}>
            <CheckoutSuccessClient />
        </Suspense>
    );
}

export function generateMetadata() {
    return {
        title: 'Pago confirmado',
        description: 'Confirmación de tu pago',
        icons: {
            icon: '/favicon.ico',
        },
    };
}
