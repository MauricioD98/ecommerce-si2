import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AccountClient from "@/components/modules/account/AccountClient";
import Footer from "@/components/modules/landing/Footer";
import Header from "@/components/modules/landing/Header";
import React from "react";

export const revalidate = false;

export default function page() {
    return (
        <>
            <Header />
            <AccountClient />
            <Footer />
        </>
    );
}

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("accountTitle"),
        description: t("accountDescription"),
    };
}
