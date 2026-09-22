'use client';

import React, { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import styles from './admin-table.module.scss';
import CollectionFormModal from './CollectionFormModal';
import { useAdminCollections } from '@/hooks/useAdminCollections';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Collection, CollectionPayload } from '@/types/admin.types';

export default function CollectionsClient() {
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
                `"${collection.name}" tiene ${collection.productCount} producto${collection.productCount === 1 ? '' : 's'} asociado${collection.productCount === 1 ? '' : 's'}. Quítalos de la colección antes de eliminarla.`,
            );
            return;
        }
        if (!window.confirm(`¿Eliminar la colección "${collection.name}"?`)) return;

        setBusyId(collection.id);
        setActionError(null);
        try {
            await deleteCollection(collection.id);
            if (collections.length === 1 && page > 1) setPage(page - 1);
        } catch (error) {
            setActionError(getApiErrorMessage(error, 'No se pudo eliminar la colección.'));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>Colecciones</h1>
                    <p>Agrupa productos por temporada o campaña (ej. Otoño-Invierno, Básicos). Un producto puede estar en varias.</p>
                </div>
                <div className={styles.toolbar}>
                    <input
                        className={styles.input}
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Buscar por nombre"
                        aria-label="Buscar colección"
                    />
                    <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                        <Plus size={16} />
                        Nueva colección
                    </button>
                </div>
            </div>

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading && collections.length === 0 ? (
                    <div className={styles.loadingState}>Cargando colecciones...</div>
                ) : collections.length === 0 ? (
                    <div className={styles.emptyState}>
                        {search ? `No se encontraron colecciones para "${search}".` : 'Aún no hay colecciones.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Nombre</th>
                                        <th>Slug</th>
                                        <th className={styles.numeric}>Productos</th>
                                        <th>Estado</th>
                                        <th className={styles.numeric}>Acciones</th>
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
                                                    {collection.isActive === false ? 'Inactiva' : 'Activa'}
                                                </span>
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button type="button" className={styles.buttonSecondary} onClick={() => setEditing(collection)}>
                                                        <Pencil size={14} />
                                                        Editar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.buttonDanger}
                                                        disabled={busyId === collection.id}
                                                        onClick={() => handleDelete(collection)}
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

                        {totalPages > 1 && (
                            <div className={styles.pagination}>
                                <button type="button" className={styles.buttonSecondary} onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
                                    Anterior
                                </button>
                                <span>Página {page} de {totalPages} ({total} en total)</span>
                                <button type="button" className={styles.buttonSecondary} onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                                    Siguiente
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
