'use client';

import React, { useRef, useState } from 'react';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import styles from './admin-table.module.scss';
import ProductFormModal from './ProductFormModal';
import { useAdminProducts, useCategoryOptions } from '@/hooks/useAdminProducts';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { ProductPayload } from '@/types/admin.types';
import { Product } from '@/types/product.types';

export default function ProductsClient() {
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sin alcance global (adminSuc), el stock de la tabla se muestra para su propia sucursal;
    // superAdmin ("todas las sucursales") sigue viendo la tabla sin columna de stock, como hasta ahora
    const { isGlobal, branchId: ownBranchId } = useAdminRole();
    const { branches } = useAdminBranches();
    const activeBranchName = branches.find((branch) => branch.id === ownBranchId)?.name;

    const { products, meta, error, isLoading, createProduct, updateProduct, deleteProduct } = useAdminProducts(
        page,
        search,
        isGlobal ? null : ownBranchId,
    );
    const { categories } = useCategoryOptions();
    // undefined = cerrado, null = crear, Product = editar
    const [editing, setEditing] = useState<Product | null | undefined>(undefined);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const handleSearchChange = (value: string) => {
        setSearchInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearch(value.trim());
            setPage(1);
        }, 400);
    };

    const handleSubmit = async (payload: ProductPayload) => {
        if (editing) {
            await updateProduct(editing.id, payload);
        } else {
            await createProduct(payload);
        }
    };

    const handleDelete = async (product: Product) => {
        if (!window.confirm(`¿Eliminar "${product.name}"? Si ya tiene pedidos, en su lugar puedes desactivarlo.`)) return;

        setBusyId(product.id);
        setActionError(null);
        try {
            await deleteProduct(product.id);
            // Si era el único de la última página, se vuelve a la anterior
            if (products.length === 1 && page > 1) setPage(page - 1);
        } catch (error) {
            setActionError(getApiErrorMessage(error, 'No se pudo eliminar el producto.'));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>Productos</h1>
                    <p>
                        Catálogo general de la tienda. Los cambios aplican a todas las sucursales; las ofertas se
                        gestionan en Inventario.
                    </p>
                    {!isGlobal && (
                        <p className={styles.branchNotice}>
                            <MapPin size={14} />
                            Mostrando stock y disponibilidad para: <strong>{activeBranchName ?? 'tu sucursal'}</strong>
                        </p>
                    )}
                </div>
                <div className={styles.toolbar}>
                    <input
                        className={styles.input}
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Buscar por nombre"
                        aria-label="Buscar producto"
                    />
                    <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                        <Plus size={16} />
                        Nuevo producto
                    </button>
                </div>
            </div>

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading && products.length === 0 ? (
                    <div className={styles.loadingState}>Cargando productos...</div>
                ) : products.length === 0 ? (
                    <div className={styles.emptyState}>
                        {search ? `No se encontraron productos para "${search}".` : 'Aún no hay productos en el catálogo.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Imagen</th>
                                        <th>Producto</th>
                                        <th>Categoría</th>
                                        <th>Tallas</th>
                                        <th className={styles.numeric}>Precio</th>
                                        {!isGlobal && <th className={styles.numeric}>Stock ({activeBranchName ?? 'tu sucursal'})</th>}
                                        <th>Estado</th>
                                        <th className={styles.numeric}>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {products.map((product) => (
                                        <tr key={product.id}>
                                            <td>
                                                {/* Las URLs son libres: <img> evita depender de hosts configurados en next/image */}
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={product.imageUrl} alt={product.name} className={styles.thumb} />
                                            </td>
                                            <td>
                                                <div className={styles.cellMain}>
                                                    <span className={styles.cellTitle}>{product.name}</span>
                                                    <span className={styles.cellSub}>SKU: {product.sku}</span>
                                                </div>
                                            </td>
                                            <td>{product.category}</td>
                                            <td>
                                                <div className={styles.badgeList}>
                                                    {product.sizes.map((size) => (
                                                        <span key={size} className={styles.badge}>{size}</span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className={styles.numeric}>${Number(product.price).toFixed(2)}</td>
                                            {!isGlobal && (
                                                <td className={styles.numeric}>
                                                    <span className={`${styles.badge} ${product.stock <= 0 ? styles.badgeDanger : styles.badgeSuccess}`}>
                                                        {product.stock <= 0 ? 'Sin stock' : product.stock}
                                                    </span>
                                                </td>
                                            )}
                                            <td>
                                                <span className={`${styles.badge} ${product.isActive === false ? styles.badgeMuted : styles.badgeSuccess}`}>
                                                    {product.isActive === false ? 'Inactivo' : 'Activo'}
                                                </span>
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button type="button" className={styles.buttonSecondary} onClick={() => setEditing(product)}>
                                                        <Pencil size={14} />
                                                        Editar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.buttonDanger}
                                                        disabled={busyId === product.id}
                                                        onClick={() => handleDelete(product)}
                                                    >
                                                        <Trash2 size={14} />
                                                        Eliminar
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {meta.totalPages > 1 && (
                            <div className={styles.pagination}>
                                <button type="button" className={styles.buttonSecondary} onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
                                    Anterior
                                </button>
                                <span>Página {page} de {meta.totalPages}</span>
                                <button type="button" className={styles.buttonSecondary} onClick={() => setPage((p) => p + 1)} disabled={page >= meta.totalPages}>
                                    Siguiente
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {editing !== undefined && (
                <ProductFormModal
                    key={editing?.id ?? 'new'}
                    product={editing ?? undefined}
                    categories={categories}
                    isGlobal={isGlobal}
                    ownBranchName={activeBranchName}
                    branches={branches}
                    onClose={() => setEditing(undefined)}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    );
}
