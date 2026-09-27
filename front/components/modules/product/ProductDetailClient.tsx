'use client';

import React, { useEffect } from 'react';
import Breadcrumbs from './Breadcrumbs';
import ProductDetail from './ProductDetail'; // 1. Se agregó la importación faltante
import { useProducts } from '@/hooks/useProducts';
import styles from './product-detail-client.module.scss'; // 2. Se corrigió a .module.scss
import SimilarProducts from './SimilarProducts';
import { useSelectedBranchId } from '@/hooks/useBranches';

export default function ProductDetailClient({
    productId,
}: {
    productId: string;
}) {
    const { getProduct, product, isLoading, error } = useProducts();
    const selectedBranchId = useSelectedBranchId();

    // Recarga el detalle al cambiar de sucursal, al completar un pago o al retomar foco
    useEffect(() => {
        if (productId) {
            getProduct(productId, selectedBranchId);
        }
    }, [productId, selectedBranchId, getProduct]);

    useEffect(() => {
        const handleRefresh = () => {
            if (productId) {
                getProduct(productId, selectedBranchId);
            }
        };
        window.addEventListener('inventory-changed', handleRefresh);
        window.addEventListener('focus', handleRefresh);
        return () => {
            window.removeEventListener('inventory-changed', handleRefresh);
            window.removeEventListener('focus', handleRefresh);
        };
    }, [productId, selectedBranchId, getProduct]);

    if (isLoading) {
        return (
            <div className={styles.loading}>
                <div className={styles.container}>
                    {/* 3. Se corrigió el texto de carga (antes decía "Producto no encontrado") */}
                    <h2>Cargando producto...</h2>
                </div>
            </div>
        );
    }

    // Un producto archivado (soft delete, isActive: false) no se muestra aunque se llegue por enlace
    // directo: GET /products/:id lo devuelve igual porque el panel admin necesita poder editarlo para
    // reactivarlo, así que el corte para el público va acá.
    if (error || !product || product.isActive === false) {
        return (
            <div className={styles.error}>
                <div className={styles.container}>
                    <h2>Producto no encontrado</h2>
                    <p>El producto que buscas no existe</p>
                </div>
            </div>
        );
    }

    return (
        <>
            <Breadcrumbs productName={product.name} />
            <ProductDetail product={product} />
            <SimilarProducts category={product.categoryId} currentProducId={product.id} />
        </>
    );
}