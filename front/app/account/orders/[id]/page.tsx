import Footer from "@/components/modules/landing/Footer";
import Header from "@/components/modules/landing/Header";
import OrderDetailClient from "@/components/modules/account/OrderDetailClient";
import React from "react";

export const revalidate = false;

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
    const { id } = await params;

    return (
        <>
            <Header />
            <OrderDetailClient orderId={id} />
            <Footer />
        </>
    );
}

export function generateMetadata() {
    return {
        title: "Detalle del pedido | Stella Femme",
        description: "Consulta el estado y los artículos de tu pedido",
    };
}
