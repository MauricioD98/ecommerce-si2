'use client';

import React, { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import CategoryFormModal from './CategoryFormModal';
import { useAdminCategories } from '@/hooks/useAdminCategories';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Category, CategoryPayload } from '@/types/admin.types';

export default function CategoriesClient() {
    const t = useTranslations('AdminCategories');
    const tc = useTranslations('AdminCommon');
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { categories, total, totalPages, error, isLoading, createCategory, updateCategory, deleteCategory } = useAdminCategories(page, search);
    // undefined = cerrado, null = crear, Category = editar
    const [editing, setEditing] = useState<Category | null | undefined>(undefined);
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

    const handleSubmit = async (payload: CategoryPayload) => {
        if (editing) {
            await updateCategory(editing.id, payload);
        } else {
            await createCategory(payload);
        }
    };

    const handleDelete = async (category: Category) => {
        if (category.productCount > 0) {
            window.alert(
                t('hasProducts', { name: category.name, count: category.productCount }),
            );
            return;
        }
        if (!window.confirm(t('confirmDelete', { name: category.name }))) return;

        setBusyId(category.id);
        setActionError(null);
        try {
            await deleteCategory(category.id);
            if (categories.length === 1 && page > 1) setPage(page - 1);
        } catch (error) {
            setActionError(getApiErrorMessage(error, t('deleteFailed')));
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
                </div>
                <div className={styles.toolbar}>
                    <input
                        className={styles.input}
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder={tc('search')}
                        aria-label={t('searchLabel')}
                    />
                    <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                        <Plus size={16} />
                        {t('new')}
                    </button>
                </div>
            </div>

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading && categories.length === 0 ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : categories.length === 0 ? (
                    <div className={styles.emptyState}>
                        {search ? t('noResults', { search }) : t('empty')}
                    </div>
                ) : (
                    <>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>{tc('name')}</th>
                                        <th>{t('slug')}</th>
                                        <th>{tc('description')}</th>
                                        <th className={styles.numeric}>{t('products')}</th>
                                        <th>{tc('status')}</th>
                                        <th className={styles.numeric}>{tc('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {categories.map((category) => (
                                        <tr key={category.id}>
                                            <td>
                                                <span className={styles.cellTitle}>{category.name}</span>
                                            </td>
                                            <td>
                                                <span className={styles.cellSub}>{category.slug}</span>
                                            </td>
                                            <td>
                                                <span className={styles.cellSub}>{category.description || '—'}</span>
                                            </td>
                                            <td className={styles.numeric}>{category.productCount}</td>
                                            <td>
                                                <span className={`${styles.badge} ${category.isActive === false ? styles.badgeMuted : styles.badgeSuccess}`}>
                                                    {category.isActive === false ? t('inactive') : t('active')}
                                                </span>
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button type="button" className={styles.buttonSecondary} onClick={() => setEditing(category)}>
                                                        <Pencil size={14} />
                                                        {tc('edit')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.buttonDanger}
                                                        disabled={busyId === category.id}
                                                        onClick={() => handleDelete(category)}
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

                        {totalPages > 1 && (
                            <div className={styles.pagination}>
                                <button type="button" className={styles.buttonSecondary} onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
                                    {tc('previous')}
                                </button>
                                <span>{t('pageInfo', { page, totalPages, total })}</span>
                                <button type="button" className={styles.buttonSecondary} onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                                    {tc('next')}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {editing !== undefined && (
                <CategoryFormModal
                    key={editing?.id ?? 'new'}
                    category={editing ?? undefined}
                    onClose={() => setEditing(undefined)}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    );
}
