'use client';

import React, { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import styles from './admin-table.module.scss';
import CategoryFormModal from './CategoryFormModal';
import { useAdminCategories } from '@/hooks/useAdminCategories';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Category, CategoryPayload } from '@/types/admin.types';

export default function CategoriesClient() {
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
                `"${category.name}" tiene ${category.productCount} producto${category.productCount === 1 ? '' : 's'} asociado${category.productCount === 1 ? '' : 's'}. Reasígnalos a otra categoría antes de eliminarla.`,
            );
            return;
        }
        if (!window.confirm(`¿Eliminar la categoría "${category.name}"?`)) return;

        setBusyId(category.id);
        setActionError(null);
        try {
            await deleteCategory(category.id);
            if (categories.length === 1 && page > 1) setPage(page - 1);
        } catch (error) {
            setActionError(getApiErrorMessage(error, 'No se pudo eliminar la categoría.'));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>Categorías</h1>
                    <p>Organiza el catálogo. Una categoría con productos asociados no se puede eliminar.</p>
                </div>
                <div className={styles.toolbar}>
                    <input
                        className={styles.input}
                        value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Buscar por nombre"
                        aria-label="Buscar categoría"
                    />
                    <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                        <Plus size={16} />
                        Nueva categoría
                    </button>
                </div>
            </div>

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading && categories.length === 0 ? (
                    <div className={styles.loadingState}>Cargando categorías...</div>
                ) : categories.length === 0 ? (
                    <div className={styles.emptyState}>
                        {search ? `No se encontraron categorías para "${search}".` : 'Aún no hay categorías.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Nombre</th>
                                        <th>Slug</th>
                                        <th>Descripción</th>
                                        <th className={styles.numeric}>Productos</th>
                                        <th>Estado</th>
                                        <th className={styles.numeric}>Acciones</th>
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
                                                    {category.isActive === false ? 'Inactiva' : 'Activa'}
                                                </span>
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button type="button" className={styles.buttonSecondary} onClick={() => setEditing(category)}>
                                                        <Pencil size={14} />
                                                        Editar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.buttonDanger}
                                                        disabled={busyId === category.id}
                                                        onClick={() => handleDelete(category)}
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
