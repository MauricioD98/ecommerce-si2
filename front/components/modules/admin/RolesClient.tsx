'use client';

import React, { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { useRoles } from '@/hooks/useRoles';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { RoleItem, RolePayload } from '@/types/admin.types';
import { PERMISSION_LABELS, PERMISSION_OPTIONS, SUPER_ADMIN_ROLE } from '@/utils/permissions';

interface RoleFormModalProps {
    role?: RoleItem;
    onClose: () => void;
    onSubmit: (payload: RolePayload) => Promise<void>;
}

function RoleFormModal({ role, onClose, onSubmit }: RoleFormModalProps) {
    const [name, setName] = useState(role?.name ?? '');
    const [description, setDescription] = useState(role?.description ?? '');
    const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const togglePermission = (value: string) => {
        setPermissions((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setError('El nombre del rol es obligatorio.');
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            await onSubmit({ name: name.trim(), description: description.trim(), permissions });
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, 'No se pudo guardar el rol.'));
            setIsSaving(false);
        }
    };

    return (
        <AdminModal title={role ? 'Editar rol' : 'Nuevo rol'} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                <div className={styles.field}>
                    <label htmlFor="role-name">Nombre</label>
                    <input
                        id="role-name"
                        className={styles.input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={50}
                        placeholder="Supervisor de turno"
                        // Los roles base no se pueden renombrar
                        disabled={role?.isBase}
                    />
                    {role?.isBase && <small>Los roles base no se pueden renombrar.</small>}
                </div>

                <div className={styles.field}>
                    <label htmlFor="role-description">Descripción</label>
                    <input
                        id="role-description"
                        className={styles.input}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={255}
                        placeholder="Qué hace este rol"
                    />
                </div>

                <fieldset className={styles.permissionGroup}>
                    <legend>Permisos</legend>
                    {PERMISSION_OPTIONS.map((option) => (
                        <label key={option.value} className={styles.permissionOption}>
                            <input
                                type="checkbox"
                                checked={permissions.includes(option.value)}
                                onChange={() => togglePermission(option.value)}
                            />
                            <span className={styles.cellMain}>
                                <span className={styles.cellTitle}>{option.label}</span>
                                <span className={styles.cellSub}>{option.description}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>

                <div className={styles.modalFooter}>
                    <button type="button" className={styles.buttonSecondary} onClick={onClose}>
                        Cancelar
                    </button>
                    <button type="submit" className={styles.button} disabled={isSaving}>
                        {isSaving ? 'Guardando...' : 'Guardar'}
                    </button>
                </div>
            </form>
        </AdminModal>
    );
}

export default function RolesClient() {
    const { isSuperAdmin } = useAdminRole();
    const { roles, isLoading, error, createRole, updateRole, deleteRole } = useRoles();
    // undefined = cerrado, null = crear, RoleItem = editar
    const [editing, setEditing] = useState<RoleItem | null | undefined>(undefined);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const handleSubmit = async (payload: RolePayload) => {
        if (editing) {
            await updateRole(editing.id, payload);
        } else {
            await createRole(payload);
        }
    };

    const handleDelete = async (role: RoleItem) => {
        if (!window.confirm(`¿Eliminar el rol "${role.name}"?`)) return;

        setBusyId(role.id);
        setActionError(null);
        try {
            await deleteRole(role.id);
        } catch (error) {
            setActionError(getApiErrorMessage(error, 'No se pudo eliminar el rol.'));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>Roles</h1>
                    <p>Crea roles y elige qué puede hacer cada uno en el panel. Los cambios aplican a los usuarios en su próximo inicio de sesión.</p>
                </div>
                <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                    <Plus size={16} />
                    Nuevo rol
                </button>
            </div>

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>Cargando roles...</div>
                ) : roles.length === 0 ? (
                    <div className={styles.emptyState}>Aún no hay roles.</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Rol</th>
                                    <th>Permisos</th>
                                    <th className={styles.numeric}>Usuarios</th>
                                    <th className={styles.numeric}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roles.map((role) => {
                                    // Super Admin es inmutable en el backend
                                    const isProtected = role.name === SUPER_ADMIN_ROLE;
                                    return (
                                        <tr key={role.id}>
                                            <td>
                                                <div className={styles.cellMain}>
                                                    <span className={styles.cellTitle}>
                                                        {role.name}
                                                        {role.isBase && <span className={`${styles.badge} ${styles.badgeMuted} ${styles.inlineBadge}`}>Base</span>}
                                                    </span>
                                                    {role.description && <span className={styles.cellSub}>{role.description}</span>}
                                                </div>
                                            </td>
                                            <td>
                                                {role.permissions.length === 0 ? (
                                                    <span className={styles.cellSub}>Sin permisos</span>
                                                ) : (
                                                    <div className={styles.badgeList}>
                                                        {role.permissions.map((permission) => (
                                                            <span key={permission} className={`${styles.badge} ${styles.badgeInfo}`}>
                                                                {PERMISSION_LABELS[permission] ?? permission}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className={styles.numeric}>{role.usersCount}</td>
                                            <td>
                                                <div className={styles.actions}>
                                                    {isProtected ? (
                                                        <span className={`${styles.badge} ${styles.badgeMuted}`}>Protegido</span>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className={styles.buttonSecondary}
                                                                onClick={() => setEditing(role)}
                                                            >
                                                                <Pencil size={14} />
                                                                Editar
                                                            </button>
                                                            {/* Eliminar roles es una acción de alto riesgo: solo el Super Admin la ve */}
                                                            {isSuperAdmin && !role.isBase && (
                                                                <button
                                                                    type="button"
                                                                    className={styles.buttonDanger}
                                                                    disabled={busyId === role.id}
                                                                    onClick={() => handleDelete(role)}
                                                                >
                                                                    <Trash2 size={14} />
                                                                    Eliminar
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing !== undefined && (
                <RoleFormModal
                    key={editing?.id ?? 'new'}
                    role={editing ?? undefined}
                    onClose={() => setEditing(undefined)}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    );
}
