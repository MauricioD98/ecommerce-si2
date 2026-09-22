'use client';

import { useEffect } from 'react';
import ProductCard from '../landing/ProductCard';
import styles from './similar-product.module.scss';
import { useProducts } from '@/hooks/useProducts';
import { Product } from '@/types/product.types';
import { useSelectedBranchId } from '@/hooks/useBranches';

export default function SimilarProducts({ category, currentProducId }: { category: string, currentProducId: string }) {
    const { products, getProducts } = useProducts();
    const selectedBranchId = useSelectedBranchId();
    useEffect(() => {
        if (category) {
            getProducts({ category, limit: 8, branchId: selectedBranchId || undefined });
        }
    }, [category, selectedBranchId, getProducts]);
    const similarProdcut = products.filter((product) => product.id !== currentProducId).slice(0, 4);
    return <section className={styles.section}>
        <div className={styles.container}>
            <div className={styles.header}>
                <h2>Productos similares</h2>
                <p>también podrían gustarte estos productos</p>
            </div>

            <div className={styles.grid}>
                {
                    similarProdcut.map((product: Product) => (
                        <ProductCard key={product.id} product={product} />
                    ))
                }
            </div>

        </div>
    </section>;
}