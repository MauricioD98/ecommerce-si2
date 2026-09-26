import React, { Suspense } from 'react';
import QrConfirmClient from './QrConfirmClient';

export const revalidate = false;

export default function QrConfirmPage() {
    return (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Cargando confirmación...</div>}>
            <QrConfirmClient />
        </Suspense>
    );
}

export function generateMetadata() {
    return {
        title: 'Confirmación de Pago QR - Stella Femme',
        description: 'Página de confirmación de pago QR simulado para proyecto universitario',
    };
}
