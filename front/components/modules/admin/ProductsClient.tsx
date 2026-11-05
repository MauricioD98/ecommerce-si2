'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { Lock, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import ProductFormModal from './ProductFormModal';
import { useAdminProducts, useCategoryOptions, useCollectionOptions } from '@/hooks/useAdminProducts';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useStorePlan } from '@/providers/StoreInfoProvider';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { ProductPayload } from '@/types/admin.types';
import { Product } from '@/types/product.types';
import { formatMoney } from '@/i18n/config';

export default function ProductsClient() {
    const t = useTranslations('AdminProducts');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    const { features } = useStorePlan();
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sin alcance global (adminSuc), el stock de la tabla se muestra para su propia sucursal;
    // superAdmin ("todas las sucursales") sigue viendo la tabla sin columna de stock, como hasta ahora
    const { isGlobal, isSuperAdmin, branchId: ownBranchId } = useAdminRole();
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

    const canShowQuota = features.maxProducts !== null && !showArchived && !search;
    const limitReached = canShowQuota && meta.total >= features.maxProducts!;

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
            setActionError(getApiErrorMessage(error, t('archiveFailed')));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                    {!isGlobal && (
                        <p className={styles.branchNotice}>
                            <MapPin size={14} />
                            {t.rich('branchNotice', { branch: activeBranchName ?? t('yourBranch'), strong: (chunks) => <strong>{chunks}</strong> })}
                        </p>
                    )}
                    {canShowQuota && !isLoading && (
                        <p className={styles.branchNotice}>
                            Productos activos: <strong>{meta.total} / {features.maxProducts}</strong> (Plan {features.planName})
                        </p>
                    )}
                </div>
                <div className={styles.toolbar}>
                    <input
                        className={styles.input}
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        aria-label={t('searchLabel')}
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
                        {t('showArchived')}
                    </label>
                    <button
                        type="button"
                        className={styles.button}
                        onClick={() => setEditing(null)}
                        disabled={limitReached}
                        title={
                            limitReached
                                ? `El Plan ${features.planName} permite hasta ${features.maxProducts} productos activos`
                                : undefined
                        }
                    >
                        <Plus size={16} />
                        {t('new')}
                    </button>
                </div>
            </div>

            {limitReached && !isLoading && (
                <div
                    className={styles.tableCard}
                    style={{
                        padding: '0.875rem 1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        flexWrap: 'wrap',
                        marginBottom: '1rem',
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                        <Lock size={16} />
                        Alcanzaste el límite de <strong>{features.maxProducts} productos activos</strong> del Plan {features.planName}. Mejora a Growth o Pro para tener catálogo ilimitado.
                    </span>
                    {isSuperAdmin && (
                        <Link href="/admin/suscripcion" className={styles.buttonSecondary}>
                            Mejorar plan
                        </Link>
                    )}
                </div>
            )}

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading && products.length === 0 ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : products.length === 0 ? (
                    <div className={styles.emptyState}>
                        {search
                            ? t('noResults', { search })
                            : showArchived
                              ? t('noArchived')
                              : t('empty')}
                    </div>
                ) : (
                    <>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>{t('image')}</th>
                                        <th>{t('product')}</th>
                                        <th>{t('category')}</th>
                                        <th>{t('sizes')}</th>
                                        <th className={styles.numeric}>{t('price')}</th>
                                        {!isGlobal && <th className={styles.numeric}>{t('stockFor', { branch: activeBranchName ?? t('yourBranch') })}</th>}
                                        <th>{tc('status')}</th>
                                        <th className={styles.numeric}>{tc('actions')}</th>
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
                                                    <span className={styles.cellSub}>{t('sku', { sku: product.sku })}</span>
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
                                            <td className={styles.numeric}>{formatMoney(Number(product.price), locale)}</td>
                                            {!isGlobal && (
                                                <td className={styles.numeric}>
                                                    <span className={`${styles.badge} ${product.stock <= 0 ? styles.badgeDanger : styles.badgeSuccess}`}>
                                                        {product.stock <= 0 ? t('noStock') : product.stock}
                                                    </span>
                                                </td>
                                            )}
                                            <td>
                                                <span className={`${styles.badge} ${product.isActive === false ? styles.badgeMuted : styles.badgeSuccess}`}>
                                                    {product.isActive === false ? tc('inactive') : tc('active')}
                                                </span>
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button type="button" className={styles.buttonSecondary} onClick={() => setEditing(product)}>
                                                        <Pencil size={14} />
                                                        {tc('edit')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.buttonDanger}
                                                        disabled={busyId === product.id || product.isActive === false}
                                                        title={
                                                            product.isActive === false
                                                                ? t('alreadyArchived')
                                                                : t('archiveHint')
                                                        }
                                                        onClick={() => setConfirmingDelete(product)}
                                                    >
                                                        <Trash2 size={14} />
                                                        {tc('delete')}
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
                                    {tc('previous')}
                                </button>
                                <span>{tc('pageOf', { page, total: meta.totalPages })}</span>
                                <button type="button" className={styles.buttonSecondary} onClick={() => setPage((p) => p + 1)} disabled={page >= meta.totalPages}>
                                    {tc('next')}
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
                <AdminModal title={t('archiveTitle')} onClose={() => setConfirmingDelete(null)}>
                    <div className={styles.confirmBody}>
                        <p>
                            {t.rich('archiveQuestion', { name: confirmingDelete.name, strong: (chunks) => <strong>{chunks}</strong> })}
                        </p>
                        <p className={styles.confirmNote}>
                            {t.rich('archiveNote', { count: confirmingDelete.orderCount, em: (chunks) => <em>{chunks}</em> })}
                        </p>
                    </div>
                    <div className={styles.modalFooter}>
                        <button
                            type="button"
                            className={styles.buttonSecondary}
                            onClick={() => setConfirmingDelete(null)}
                            disabled={busyId === confirmingDelete.id}
                        >
                            {tc('cancel')}
                        </button>
                        <button
                            type="button"
                            className={styles.buttonDanger}
                            onClick={handleConfirmDelete}
                            disabled={busyId === confirmingDelete.id}
                        >
                            <Trash2 size={14} />
                            {busyId === confirmingDelete.id ? t('archiving') : t('confirmArchive')}
                        </button>
                    </div>
                </AdminModal>
            )}
        </div>
    );
}
