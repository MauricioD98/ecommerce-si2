import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import React from 'react';
import CheckoutClient from '@/components/modules/checkout/CheckoutClient';

export const revalidate = false;

export default function Page() {
    return <CheckoutClient />;
}

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("checkoutTitle"),
        description: t("checkoutDescription"),
        icons: {
            icon: "/favicon.ico",
        },
    };
}

