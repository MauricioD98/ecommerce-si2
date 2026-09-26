import Footer from '@/components/modules/landing/Footer';
import Header from '@/components/modules/landing/Header';
import ProductDetailClient from '@/components/modules/product/ProductDetailClient';
import { icons } from 'lucide-react';
import { title } from 'process';
import React from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    };
}