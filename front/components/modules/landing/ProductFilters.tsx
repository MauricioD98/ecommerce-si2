'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import styles from './product-filters.module.scss';
import { CategoryService } from '@/service/api/category.service';
import { CollectionService } from '@/service/api/collection.service';
import { CategoryOption } from '@/types/admin.types';
import { CollectionOption } from '@/types/collection.types';

// Mismas tallas que acepta el backend (enum WomenSize)
const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

// Barra horizontal de filtros: dropdowns nativos para Categoría/Colección, pastillas para Talla,
// precio como par de inputs compactos. En móvil la barra scrollea horizontal en vez de romper el
// layout (ver .filterBar en product-filters.module.scss). Sin filtro de color (retirado a pedido
// del cliente).
export default function ProductFilters() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [collections, setCollections] = useState<CollectionOption[]>([]);

    useEffect(() => {
        CategoryService.getCategories().then(setCategories).catch(() => setCategories([]));
        CollectionService.getCollections().then(setCollections).catch(() => setCollections([]));
    }, []);

    const category = searchParams.get('category') ?? '';
    const collectionSlug = searchParams.get('collection') ?? '';
    const selectedSizes = searchParams.getAll('size');
    const minPrice = searchParams.get('minPrice') ?? '';
    const maxPrice = searchParams.get('maxPrice') ?? '';

    // Los inputs de precio tienen su propio estado + debounce para no navegar en cada tecla
    const [minInput, setMinInput] = useState(minPrice);
    const [maxInput, setMaxInput] = useState(maxPrice);
    const minDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const maxDebounceRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => setMinInput(minPrice), [minPrice]);
    useEffect(() => setMaxInput(maxPrice), [maxPrice]);

    const activeCount =
        (category ? 1 : 0) +
        (collectionSlug ? 1 : 0) +
        selectedSizes.length +
        (minPrice ? 1 : 0) +
        (maxPrice ? 1 : 0);

    // Aplica un cambio a los query params y navega: así los filtros quedan en la URL y son
    // compartibles por enlace (?size=M&collection=otono-invierno), sin pasar callbacks/props a ProductList.
    const updateParams = (mutate: (params: URLSearchParams) => void) => {
        const params = new URLSearchParams(searchParams.toString());
        mutate(params);
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const setSingleParam = (key: string, value: string) => {
        updateParams((params) => {
            if (value) params.set(key, value);
            else params.delete(key);
        });
    };

    const toggleMultiParam = (key: string, value: string) => {
        updateParams((params) => {
            const current = params.getAll(key);
            params.delete(key);
            const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
            next.forEach((v) => params.append(key, v));
        });
    };

    const handleMinPriceChange = (value: string) => {
        setMinInput(value);
        if (minDebounceRef.current) clearTimeout(minDebounceRef.current);
        minDebounceRef.current = setTimeout(() => setSingleParam('minPrice', value), 500);
    };

    const handleMaxPriceChange = (value: string) => {
        setMaxInput(value);
        if (maxDebounceRef.current) clearTimeout(maxDebounceRef.current);
        maxDebounceRef.current = setTimeout(() => setSingleParam('maxPrice', value), 500);
    };

    const clearAll = () => router.push(pathname, { scroll: false });

    return (
        <div className={styles.filterBar}>
            <select
                className={styles.dropdown}
                value={category}
                onChange={(e) => setSingleParam('category', e.target.value)}
                aria-label="Filtrar por categoría"
            >
                <option value="">Categoría</option>
                {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                        {cat.name}
                    </option>
                ))}
            </select>

            <select
                className={styles.dropdown}
                value={collectionSlug}
                onChange={(e) => setSingleParam('collection', e.target.value)}
                aria-label="Filtrar por colección"
            >
                <option value="">Colección</option>
                {collections.map((col) => (
                    <option key={col.id} value={col.slug}>
                        {col.name}
                    </option>
                ))}
            </select>

            <div className={styles.pillGroup}>
                {SIZE_OPTIONS.map((size) => (
                    <button
                        key={size}
                        type="button"
                        className={`${styles.pill} ${selectedSizes.includes(size) ? styles.pillActive : ''}`}
                        onClick={() => toggleMultiParam('size', size)}
                        aria-pressed={selectedSizes.includes(size)}
                    >
                        {size}
                    </button>
                ))}
            </div>

            <div className={styles.priceGroup}>
                <input
                    type="number"
                    min={0}
                    placeholder="Precio mín."
                    value={minInput}
                    onChange={(e) => handleMinPriceChange(e.target.value)}
                    aria-label="Precio mínimo"
                />
                <span>—</span>
                <input
                    type="number"
                    min={0}
                    placeholder="Precio máx."
                    value={maxInput}
                    onChange={(e) => handleMaxPriceChange(e.target.value)}
                    aria-label="Precio máximo"
                />
            </div>

            {activeCount > 0 && (
                <button type="button" className={styles.clearPill} onClick={clearAll}>
                    <X size={13} />
                    Limpiar ({activeCount})
                </button>
            )}
        </div>
    );
}
