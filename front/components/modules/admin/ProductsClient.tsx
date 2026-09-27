'use client';

import React, { useRef, useState } from 'react';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import ProductFormModal from './ProductFormModal';
import { useAdminProducts, useCategoryOptions, useCollectionOptions } from '@/hooks/useAdminProducts';
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

    // Los archivados no se muestran por defecto: eliminar los saca de la vista, pero siguen
    // recuperables activando este filtro y editándolos
    const [showArchived, setShowArchived] = useState(false);

    const { products, meta, error, isLoading, createProduct, updateProduct, deleteProduct } = useAdminProducts(
        page,
        search,
        isGlobal ? null : ownBranchId,
        showArchived,
    );
    const { categories } = useCategoryOptions();
    const { collections } = useCollectionOptions();
    // undefined = cerrado, null = crear, Product = editar
    const [editing, setEditing] = useState<Product | null | undefined>(undefined);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Producto esperando confirmación de archivado (null = no hay diálogo abierto)
    const [confirmingDelete, setConfirmingDelete] = useState<Product | null>(null);

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

    // Eliminar es un soft delete (archivar), así que ya no hay nada que bloquear: un producto con
    // ventas se archiva igual y su histórico queda intacto.
    const handleConfirmDelete = async () => {
        const product = confirmingDelete;
        if (!product) return;

        setBusyId(product.id);
        setActionError(null);
        try {
            await deleteProduct(product.id);
            setConfirmingDelete(null);
            // Si era el único de la última página, se vuelve a la anterior
            if (products.length === 1 && page > 1) setPage(page - 1);
        } catch (error) {
            setActionError(getApiErrorMessage(error, 'No se pudo archivar el producto.'));
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
                    <label className={styles.inlineCheckbox}>
                        <input
                            type="checkbox"
                            checked={showArchived}
                            onChange={(e) => {
                                setShowArchived(e.target.checked);
                                setPage(1);
                            }}
                        />
                        Ver archivados
                    </label>
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
                        {search
                            ? `No se encontraron productos para "${search}".`
                            : showArchived
                              ? 'No hay productos archivados.'
                              : 'Aún no hay productos en el catálogo.'}
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
                                            <td className={styles.numeric}>Bs {Number(product.price).toFixed(2)}</td>
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
                                                        disabled={busyId === product.id || product.isActive === false}
                                                        title={
                                                            product.isActive === false
                                                                ? 'Ya está archivado: reactivalo desde Editar'
                                                                : 'Archivar: deja de verse en la tienda y en la caja'
                                                        }
                                                        onClick={() => setConfirmingDelete(product)}
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
                    collections={collections}
                    isGlobal={isGlobal}
                    ownBranchName={activeBranchName}
                    branches={branches}
                    onClose={() => setEditing(undefined)}
                    onSubmit={handleSubmit}
                />
            )}

            {confirmingDelete && (
                <AdminModal title="Archivar producto" onClose={() => setConfirmingDelete(null)}>
                    <div className={styles.confirmBody}>
                        <p>
                            ¿Seguro que querés eliminar <strong>{confirmingDelete.name}</strong>?
                        </p>
                        <p className={styles.confirmNote}>
                            Se archiva, no se borra: deja de aparecer en la tienda y en la caja, pero sus
                            {confirmingDelete.orderCount > 0
                                ? ` ${confirmingDelete.orderCount} venta${confirmingDelete.orderCount === 1 ? '' : 's'} y devoluciones`
                                : ' ventas y devoluciones'}{' '}
                            siguen en el histórico. Podés recuperarlo con <em>Ver archivados</em>.
                        </p>
                    </div>
                    <div className={styles.modalFooter}>
                        <button
                            type="button"
                            className={styles.buttonSecondary}
                            onClick={() => setConfirmingDelete(null)}
                            disabled={busyId === confirmingDelete.id}
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            className={styles.buttonDanger}
                            onClick={handleConfirmDelete}
                            disabled={busyId === confirmingDelete.id}
                        >
                            <Trash2 size={14} />
                            {busyId === confirmingDelete.id ? 'Archivando...' : 'Sí, archivar'}
                        </button>
                    </div>
                </AdminModal>
            )}
        </div>
    );
}
