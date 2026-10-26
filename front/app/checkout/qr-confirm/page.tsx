import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import React, { Suspense } from 'react';
import QrConfirmClient from './QrConfirmClient';

export const revalidate = false;

export default async function QrConfirmPage() {
    const t = await getTranslations('Checkout.qrConfirm');
    return (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>{t('loading')}</div>}>
            <QrConfirmClient />
        </Suspense>
    );
}

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("qrConfirmTitle"),
        description: t("qrConfirmDescription"),
    };
}
