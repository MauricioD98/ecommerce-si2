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

    // Recarga el detalle al cambiar de sucursal para mostrar su stock
    useEffect(() => {
        if (productId) {
            getProduct(productId, selectedBranchId);
        }
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

    if (error || !product) {
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