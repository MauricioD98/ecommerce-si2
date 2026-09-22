'use client';

import React, { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { useStaff } from '@/hooks/useStaff';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAssignableRoles } from '@/hooks/useRoles';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Branch } from '@/types/branch.types';
import { CreateStaffPayload, RoleItem, StaffUser, UpdateStaffPayload } from '@/types/admin.types';

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
            return 'El descuento debe ser un entero entre 0 y 100.';
        }
        if (!roleId) return 'Selecciona un rol.';
        // Con el permiso ALL_BRANCHES se elige la sucursal; sin él se asigna la propia automáticamente
        if (isGlobal && !branchId) return 'Selecciona una sucursal.';
        if (!member) {
            if (!email.trim()) return 'El correo es obligatorio.';
            if (!PASSWORD_REGEX.test(password)) {
                return 'La contraseña debe tener al menos 8 caracteres, con mayúscula, minúscula, número y un símbolo (@$!%*?&).';
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
            setError(getApiErrorMessage(error, 'No se pudo guardar el usuario.'));
            setIsSaving(false);
        }
    };

    return (
        <AdminModal title={member ? 'Editar usuario' : 'Nuevo empleado'} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                {!member && (
                    <>
                        <div className={styles.formRow}>
                            <div className={styles.field}>
                                <label htmlFor="staff-first">Nombre</label>
                                <input id="staff-first" className={styles.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="staff-last">Apellido</label>
                                <input id="staff-last" className={styles.input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                            </div>
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="staff-email">Correo electrónico</label>
                            <input id="staff-email" type="email" className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="staff-password">Contraseña inicial</label>
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
                        <label htmlFor="staff-role">Rol</label>
                        <select id="staff-role" className={styles.input} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                            {roleOptions.map((role) => (
                                <option key={role.id} value={role.id}>{role.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="staff-discount">Descuento de trabajador (%)</label>
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
                        <label htmlFor="staff-branch">Sucursal</label>
                        <select id="staff-branch" className={styles.input} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                            <option value="">Selecciona una sucursal</option>
                            {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>
                    </div>
                )}

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

export default function StaffClient() {
    const { isGlobal } = useAdminRole();
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
                    <h1>{isGlobal ? 'Usuarios / Empleados' : 'Mis Empleados'}</h1>
                    <p>
                        {isGlobal
                            ? 'Crea empleados, asígnales un rol y una sucursal, y define su descuento de trabajador.'
                            : 'Crea empleados de tu sucursal y configura su descuento de trabajador.'}
                    </p>
                </div>
                <button type="button" className={styles.button} onClick={() => setEditing(null)} disabled={rolesLoading}>
                    <Plus size={16} />
                    Nuevo empleado
                </button>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>Cargando personal...</div>
                ) : staff.length === 0 ? (
                    <div className={styles.emptyState}>Aún no hay empleados registrados.</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Usuario</th>
                                    <th>Rol</th>
                                    <th>Sucursal</th>
                                    <th className={styles.numeric}>Descuento</th>
                                    <th className={styles.numeric}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {staff.map((member) => (
                                    <tr key={member.id}>
                                        <td>
                                            <div className={styles.cellMain}>
                                                <span className={styles.cellTitle}>
                                                    {`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || 'Sin nombre'}
                                                </span>
                                                <span className={styles.cellSub}>{member.email}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`${styles.badge} ${member.permissions.length > 0 ? styles.badgeInfo : ''}`}>
                                                {member.role.name}
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
                                                    Editar
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
