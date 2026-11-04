import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import React from "react";
import OrderDraftsClient from "@/components/modules/checkout/OrderDraftsClient";

export const revalidate = false;

export default function Page() {
    return <OrderDraftsClient />;
}

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return { title: t("offlineSuccessTitle"), description: t("offlineSuccessDescription") };
}
