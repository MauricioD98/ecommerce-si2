'use client';

import React, { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import CollectionFormModal from './CollectionFormModal';
import { useAdminCollections } from '@/hooks/useAdminCollections';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Collection, CollectionPayload } from '@/types/admin.types';

export default function CollectionsClient() {
    const t = useTranslations('AdminCollections');
    const tc = useTranslations('AdminCommon');
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { collections, total, totalPages, error, isLoading, createCollection, updateCollection, deleteCollection } =
        useAdminCollections(page, search);
    // undefined = cerrado, null = crear, Collection = editar
    const [editing, setEditing] = useState<Collection | null | undefined>(undefined);
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

    const handleSubmit = async (payload: CollectionPayload) => {
        if (editing) {
            await updateCollection(editing.id, payload);
        } else {
            await createCollection(payload);
        }
    };

    const handleDelete = async (collection: Collection) => {
        if (collection.productCount > 0) {
            window.alert(
                t('hasProducts', { name: collection.name, count: collection.productCount }),
            );
            return;
        }
        if (!window.confirm(t('confirmDelete', { name: collection.name }))) return;

        setBusyId(collection.id);
        setActionError(null);
        try {
            await deleteCollection(collection.id);
            if (collections.length === 1 && page > 1) setPage(page - 1);
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
                {isLoading && collections.length === 0 ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : collections.length === 0 ? (
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
                                        <th className={styles.numeric}>{t('products')}</th>
                                        <th>{tc('status')}</th>
                                        <th className={styles.numeric}>{tc('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {collections.map((collection) => (
                                        <tr key={collection.id}>
                                            <td>
                                                <span className={styles.cellTitle}>{collection.name}</span>
                                            </td>
                                            <td>
                                                <span className={styles.cellSub}>{collection.slug}</span>
                                            </td>
                                            <td className={styles.numeric}>{collection.productCount}</td>
                                            <td>
                                                <span
                                                    className={`${styles.badge} ${collection.isActive === false ? styles.badgeMuted : styles.badgeSuccess}`}
                                                >
                                                    {collection.isActive === false ? t('inactive') : t('active')}
                                                </span>
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button type="button" className={styles.buttonSecondary} onClick={() => setEditing(collection)}>
                                                        <Pencil size={14} />
                                                        {tc('edit')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.buttonDanger}
                                                        disabled={busyId === collection.id}
                                                        onClick={() => handleDelete(collection)}
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
                <CollectionFormModal
                    key={editing?.id ?? 'new'}
                    collection={editing ?? undefined}
                    onClose={() => setEditing(undefined)}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    );
}
