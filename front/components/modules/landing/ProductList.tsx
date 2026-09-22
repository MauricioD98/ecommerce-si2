'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import styles from "./product-list.module.scss";
import { useProducts } from '@/hooks/useProducts';
import { Product } from '@/types/product.types';
import ProductCard from './ProductCard';
import ProductFilters from './ProductFilters';
import { useBranches } from '@/hooks/useBranches';

export default function ProductList() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { isLoading, products, getProducts, error, meta } = useProducts();
  const { selectedBranch, selectedBranchId } = useBranches();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const searchParams = useSearchParams();

  // Filtros avanzados (categoría, colección, talla, precio): viven en la URL, ProductFilters
  // los escribe y acá solo se leen, así el catálogo y los filtros quedan desacoplados
  const category = searchParams.get('category') || undefined;
  const collectionSlug = searchParams.get('collection') || undefined;
  const sizes = searchParams.getAll('size');
  const minPriceParam = searchParams.get('minPrice');
  const maxPriceParam = searchParams.get('maxPrice');
  const filtersKey = searchParams.toString();

  // Cualquier cambio de filtro vuelve a la página 1 (una página 5 de un filtro nuevo casi seguro no existe)
  useEffect(() => {
    setPage(1);
  }, [filtersKey]);

  // Carga el catálogo al entrar y cada vez que cambia la búsqueda, la página, la sucursal o los filtros
  useEffect(() => {
    getProducts({
      search: debouncedSearch || undefined,
      page,
      limit: 12,
      branchId: selectedBranchId || undefined,
      category,
      collectionSlug,
      sizes: sizes.length > 0 ? sizes : undefined,
      minPrice: minPriceParam ? Number(minPriceParam) : undefined,
      maxPrice: maxPriceParam ? Number(maxPriceParam) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, page, selectedBranchId, filtersKey, getProducts]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearch(value);
      setPage(1);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        setDebouncedSearch(value);
      }, 500);
    },
    []
  );

  const handlePrevPage = () => {
    setPage(page - 1);
  }

  const handleNextPage = () => {
    if (meta && page < meta.totalPages) {
      setPage(page + 1);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2>Productos</h2>
          <p>
            {selectedBranch
              ? `Stock y ofertas de ${selectedBranch.name}`
              : 'Todos los productos disponibles. Elige una sucursal para ver su stock y sus ofertas'}
          </p>
        </div>

        <div className={styles.searchBar}>
          <input
            type="text"
            placeholder="Buscar productos"
            value={search}
            onChange={handleSearchChange}
          />
        </div>

        <ProductFilters />

        {isLoading ? (
          <div className={styles.loading}>Cargando productos...</div>
        ) : products.length === 0 ? (
          <div className={styles.empty}>
            {debouncedSearch
              ? `No se encontraron productos para "${debouncedSearch}"`
              : 'No se encontraron productos con estos filtros'}
          </div>
        ) : (
          <>
            <div className={styles.grid}>
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/*Pagination*/}
            {meta && meta.totalPages > 1 && (
              <div className={styles.pagination}>
                <button
                  onClick={handlePrevPage} disabled={page === 1}
                >
                  Anterior
                </button>
                <span className={styles.pageInfo}>
                  Página {page} de {meta.totalPages}
                </span>
                <button onClick={handleNextPage} disabled={page >= meta.totalPages}>
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}