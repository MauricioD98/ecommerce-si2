import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("checkoutSuccessTitle"),
        description: t("checkoutSuccessDescription"),
        icons: {
            icon: "/favicon.ico",
        },
    };
}
