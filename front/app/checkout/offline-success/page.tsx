import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import React from 'react';
import OfflineSuccessClient from '@/components/modules/checkout/OfflineSuccessClient';

export const revalidate = false;

export default function Page() {
    return <OfflineSuccessClient />;
}

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("offlineSuccessTitle"),
        description: t("offlineSuccessDescription"),
        icons: {
            icon: "/favicon.ico",
        },
    };
}
