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

export function generateMetadata() {
    return {
        title: "Mi cuenta | Stella Femme",
        description: "Gestiona tus datos personales, tu sucursal favorita y tus direcciones de entrega",
    };
}
