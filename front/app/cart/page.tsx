import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import CartClient from "@/components/modules/cart/CartClient";
import Footer from "@/components/modules/landing/Footer";
import Header from "@/components/modules/landing/Header";
import React from "react";

export const revalidate = false;

export default function pago() {
    return (
        <>
            <Header />
            <CartClient />
            <Footer />
        </>
    )
}

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("cartTitle"),
        description: t("cartDescription"),
    };
}