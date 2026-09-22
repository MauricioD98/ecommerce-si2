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

export function generateMetadata() {
    return {
        title: "Carrito de compras",
        description: "Revisa los productos de tu carrito",
        icons: {
            icon: '/path to asset file',
        }
    }
}