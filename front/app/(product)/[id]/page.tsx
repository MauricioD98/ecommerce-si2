import Footer from '@/components/modules/landing/Footer';
import Header from '@/components/modules/landing/Header';
import ProductDetailClient from '@/components/modules/product/ProductDetailClient';
import { icons } from 'lucide-react';
import { title } from 'process';
import React from 'react';

export const revalidate = false;

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
    const { id } = await params;

    return <>
        <Header />
        <ProductDetailClient productId={id} />
        <Footer />

    </>
};

export function generateMetadato() {
    return {

        title: 'Detalle del producto',
        description: 'Consulta los detalles del producto',
        icons: {
            icon: 'path to asset file'
        }

    }
}