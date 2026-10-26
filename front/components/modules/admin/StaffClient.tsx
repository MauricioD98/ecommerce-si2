'use client';

import React, { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { useStaff } from '@/hooks/useStaff';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAssignableRoles } from '@/hooks/useRoles';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Branch } from '@/types/branch.types';
import { CreateStaffPayload, RoleItem, StaffUser, UpdateStaffPayload } from '@/types/admin.types';
import { BASE_ROLE_KEYS } from '@/utils/permissions';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

interface StaffFormModalProps {
    member?: StaffUser;
    branches: Branch[];
    roles: RoleItem[];
    isGlobal: boolean;
    onClose: () => void;
    onCreate: (payload: CreateStaffPayload) => Promise<void>;
    onUpdate: (id: string, payload: UpdateStaffPayload) => Promise<void>;
}

function StaffFormModal({ member, branches, roles, isGlobal, onClose, onCreate, onUpdate }: StaffFormModalProps) {
    const t = useTranslations('AdminStaff');
    const tc = useTranslations('AdminCommon');
    const tRoles = useTranslations('AdminRoles');
    const [email, setEmail] = useState(member?.email ?? '');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState(member?.firstName ?? '');
    const [lastName, setLastName] = useState(member?.lastName ?? '');
    // Por defecto "Empleado" si el usuario puede asignarlo
    const [roleId, setRoleId] = useState(member?.role.id ?? roles.find((r) => r.name === 'Empleado')?.id ?? roles[0]?.id ?? '');
    const [branchId, setBranchId] = useState(member?.branchId ?? '');
    const [employeeDiscount, setEmployeeDiscount] = useState(String(member?.employeeDiscount ?? 0));
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // El rol actual puede no estar entre los asignables (p. ej. un rol con más permisos): se muestra igualmente
    const roleOptions = member && !roles.some((r) => r.id === member.role.id)
        ? [{ id: member.role.id, name: member.role.name } as RoleItem, ...roles]
        : roles;

    const validate = (): string | null => {
        const discount = Number(employeeDiscount);
        if (!Number.isInteger(discount) || discount < 0 || discount > 100) {
            return t('errors.discount');
        }
        if (!roleId) return t('errors.role');
        // Con el permiso ALL_BRANCHES se elige la sucursal; sin él se asigna la propia automáticamente
        if (isGlobal && !branchId) return t('errors.branch');
        if (!member) {
            if (!email.trim()) return t('errors.email');
            if (!PASSWORD_REGEX.test(password)) {
                return t('errors.password');
            }
        }
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const discount = Number(employeeDiscount);
            if (member) {
                await onUpdate(member.id, {
                    roleId,
                    employeeDiscount: discount,
                    ...(isGlobal ? { branchId } : {}),
                });
            } else {
                await onCreate({
                    email: email.trim(),
                    password,
                    firstName: firstName.trim() || undefined,
                    lastName: lastName.trim() || undefined,
                    roleId,
                    employeeDiscount: discount,
                    ...(isGlobal ? { branchId } : {}),
                });
            }
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, t('saveFailed')));
            setIsSaving(false);
        }
    };

    return (
        <AdminModal title={member ? t('editTitle') : t('newTitle')} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                {!member && (
                    <>
                        <div className={styles.formRow}>
                            <div className={styles.field}>
                                <label htmlFor="staff-first">{t('firstName')}</label>
                                <input id="staff-first" className={styles.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="staff-last">{t('lastName')}</label>
                                <input id="staff-last" className={styles.input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                            </div>
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="staff-email">{t('email')}</label>
                            <input id="staff-email" type="email" className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="staff-password">{t('password')}</label>
                            <input id="staff-password" type="password" className={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                        </div>
                    </>
                )}

                {member && (
                    <p className={styles.cellSub}>
                        {member.firstName} {member.lastName} · {member.email}
                    </p>
                )}

                <div className={styles.formRow}>
                    <div className={styles.field}>
                        <label htmlFor="staff-role">{t('role')}</label>
                        <select id="staff-role" className={styles.input} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                            {roleOptions.map((role) => (
                                <option key={role.id} value={role.id}>{BASE_ROLE_KEYS[role.name] ? tRoles(`baseRoles.${BASE_ROLE_KEYS[role.name]}.name`) : role.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="staff-discount">{t('discountLabel')}</label>
                        <input
                            id="staff-discount"
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className={styles.input}
                            value={employeeDiscount}
                            onChange={(e) => setEmployeeDiscount(e.target.value)}
                        />
                    </div>
                </div>

                {isGlobal && (
                    <div className={styles.field}>
                        <label htmlFor="staff-branch">{tc('branch')}</label>
                        <select id="staff-branch" className={styles.input} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                            <option value="">{t('selectBranch')}</option>
                            {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>
                    </div>
                )}

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

export default function StaffClient() {
    const { isGlobal } = useAdminRole();
    const t = useTranslations('AdminStaff');
    const tc = useTranslations('AdminCommon');
    const tRoles = useTranslations('AdminRoles');
    const { staff, isLoading, error, createStaff, updateStaff } = useStaff();
    const { branches } = useAdminBranches();
    const { roles, isLoading: rolesLoading } = useAssignableRoles();
    // undefined = cerrado, null = crear, StaffUser = editar
    const [editing, setEditing] = useState<StaffUser | null | undefined>(undefined);

    const branchName = (id: string | null) => branches.find((branch) => branch.id === id)?.name ?? '—';

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{isGlobal ? t('title') : t('titleOwn')}</h1>
                    <p>
                        {isGlobal ? t('subtitleGlobal') : t('subtitleOwn')}
                    </p>
                </div>
                <button type="button" className={styles.button} onClick={() => setEditing(null)} disabled={rolesLoading}>
                    <Plus size={16} />
                    {t('new')}
                </button>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : staff.length === 0 ? (
                    <div className={styles.emptyState}>{t('empty')}</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{t('user')}</th>
                                    <th>{t('role')}</th>
                                    <th>{tc('branch')}</th>
                                    <th className={styles.numeric}>{t('discount')}</th>
                                    <th className={styles.numeric}>{tc('actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {staff.map((member) => (
                                    <tr key={member.id}>
                                        <td>
                                            <div className={styles.cellMain}>
                                                <span className={styles.cellTitle}>
                                                    {`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || tc('noName')}
                                                </span>
                                                <span className={styles.cellSub}>{member.email}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`${styles.badge} ${member.permissions.length > 0 ? styles.badgeInfo : ''}`}>
                                                {BASE_ROLE_KEYS[member.role.name] ? tRoles(`baseRoles.${BASE_ROLE_KEYS[member.role.name]}.name`) : member.role.name}
                                            </span>
                                        </td>
                                        <td>{branchName(member.branchId)}</td>
                                        <td className={styles.numeric}>{member.employeeDiscount}%</td>
                                        <td>
                                            <div className={styles.actions}>
                                                <button
                                                    type="button"
                                                    className={styles.buttonSecondary}
                                                    onClick={() => setEditing(member)}
                                                >
                                                    <Pencil size={14} />
                                                    {tc('edit')}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editing !== undefined && (
                <StaffFormModal
                    key={editing?.id ?? 'new'}
                    member={editing ?? undefined}
                    branches={branches}
                    roles={roles}
                    isGlobal={isGlobal}
                    onClose={() => setEditing(undefined)}
                    onCreate={createStaff}
                    onUpdate={updateStaff}
                />
            )}
        </div>
    );
}
