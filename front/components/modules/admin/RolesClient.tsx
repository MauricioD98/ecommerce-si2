'use client';

import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { useRoles } from '@/hooks/useRoles';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { RoleItem, RolePayload } from '@/types/admin.types';
import { BASE_ROLE_KEYS, SUPER_ADMIN_ROLE, isPermission } from '@/utils/permissions';
import { PermissionCatalogItem, RolesService } from '@/service/api/roles.service';

interface RoleFormModalProps {
    role?: RoleItem;
    onClose: () => void;
    onSubmit: (payload: RolePayload) => Promise<void>;
}

function RoleFormModal({ role, onClose, onSubmit }: RoleFormModalProps) {
    const t = useTranslations('AdminRoles');
    const tc = useTranslations('AdminCommon');
    const [name, setName] = useState(role?.name ?? '');
    const [description, setDescription] = useState(role?.description ?? '');
    const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
    // Los checkboxes salen del catálogo del backend, no de una lista copiada en el front
    const [catalog, setCatalog] = useState<PermissionCatalogItem[] | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);

    useEffect(() => {
        RolesService.getPermissionCatalog()
            .then(setCatalog)
            .catch((err) => setCatalogError(getApiErrorMessage(err, t('permissionsFailed'))));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const togglePermission = (value: string) => {
        setPermissions((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setError(t('nameRequired'));
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            await onSubmit({ name: name.trim(), description: description.trim(), permissions });
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, t('saveFailed')));
            setIsSaving(false);
        }
    };

    return (
        <AdminModal title={role ? t('editTitle') : t('newTitle')} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                <div className={styles.field}>
                    <label htmlFor="role-name">{tc('name')}</label>
                    <input
                        id="role-name"
                        className={styles.input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={50}
                        placeholder={t('namePlaceholder')}
                        // Los roles base no se pueden renombrar
                        disabled={role?.isBase}
                    />
                    {role?.isBase && <small>{t('baseNoRename')}</small>}
                </div>

                <div className={styles.field}>
                    <label htmlFor="role-description">{tc('description')}</label>
                    <input
                        id="role-description"
                        className={styles.input}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={255}
                        placeholder={t('descriptionPlaceholder')}
                    />
                </div>

                <fieldset className={styles.permissionGroup}>
                    <legend>{t('permissions')}</legend>
                    {catalogError && <div className={styles.errorMessage}>{catalogError}</div>}
                    {!catalog && !catalogError && <span className={styles.cellSub}>{t('loadingPermissions')}</span>}
                    {catalog?.map(({ permission, grantable }) => (
                        <label key={permission} className={styles.permissionOption} title={grantable ? undefined : t('notGrantable')}>
                            <input
                                type="checkbox"
                                checked={permissions.includes(permission)}
                                // Un permiso que el usuario no tiene no se puede otorgar (el backend lo rechaza igual)
                                disabled={!grantable}
                                onChange={() => togglePermission(permission)}
                            />
                            <span className={styles.cellMain}>
                                <span className={styles.cellTitle}>{isPermission(permission) ? t(`perms.${permission}.label`) : permission}</span>
                                <span className={styles.cellSub}>
                                    {isPermission(permission) ? t(`perms.${permission}.description`) : ''}
                                    {!grantable && ` · ${t('notGrantable')}`}
                                </span>
                            </span>
                        </label>
                    ))}
                </fieldset>

                <div className={styles.modalFooter}>
                    <button type="button" className={styles.buttonSecondary} onClick={onClose}>
                        {tc('cancel')}
                    </button>
                    <button type="submit" className={styles.button} disabled={isSaving}>
                        {isSaving ? tc('saving') : tc('save')}
                    </button>
                </div>
            </form>
        </AdminModal>
    );
}

export default function RolesClient() {
    const { isSuperAdmin } = useAdminRole();
    const t = useTranslations('AdminRoles');
    const tc = useTranslations('AdminCommon');
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
        if (!window.confirm(t('confirmDelete', { name: role.name }))) return;

        setBusyId(role.id);
        setActionError(null);
        try {
            await deleteRole(role.id);
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
                <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                    <Plus size={16} />
                    {t('new')}
                </button>
            </div>

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : roles.length === 0 ? (
                    <div className={styles.emptyState}>{t('empty')}</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{t('role')}</th>
                                    <th>{t('permissions')}</th>
                                    <th className={styles.numeric}>{t('users')}</th>
                                    <th className={styles.numeric}>{tc('actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roles.map((role) => {
                                    // Super Admin es inmutable en el backend
                                    const isProtected = role.name === SUPER_ADMIN_ROLE;
                                    // Nombre y descripción de los roles base, en el idioma elegido
                                    const baseKey = role.isBase ? BASE_ROLE_KEYS[role.name] : undefined;
                                    return (
                                        <tr key={role.id}>
                                            <td>
                                                <div className={styles.cellMain}>
                                                    <span className={styles.cellTitle}>
                                                        {baseKey ? t(`baseRoles.${baseKey}.name`) : role.name}
                                                        {role.isBase && <span className={`${styles.badge} ${styles.badgeMuted} ${styles.inlineBadge}`}>{t('base')}</span>}
                                                    </span>
                                                    {baseKey ? (
                                                        <span className={styles.cellSub}>{t(`baseRoles.${baseKey}.description`)}</span>
                                                    ) : (
                                                        role.description && <span className={styles.cellSub}>{role.description}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                {role.permissions.length === 0 ? (
                                                    <span className={styles.cellSub}>{t('noPermissions')}</span>
                                                ) : (
                                                    <div className={styles.badgeList}>
                                                        {role.permissions.map((permission) => (
                                                            <span key={permission} className={`${styles.badge} ${styles.badgeInfo}`}>
                                                                {isPermission(permission) ? t(`perms.${permission}.label`) : permission}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className={styles.numeric}>{role.usersCount}</td>
                                            <td>
                                                <div className={styles.actions}>
                                                    {isProtected ? (
                                                        <span className={`${styles.badge} ${styles.badgeMuted}`}>{t('protected')}</span>
                                                    ) : (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className={styles.buttonSecondary}
                                                                onClick={() => setEditing(role)}
                                                            >
                                                                <Pencil size={14} />
                                                                {tc('edit')}
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
                                                                    {tc('delete')}
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
