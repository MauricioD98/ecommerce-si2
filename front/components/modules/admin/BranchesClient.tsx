'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Branch } from '@/types/branch.types';
import { BranchPayload } from '@/types/admin.types';
import { MapPosition, SANTA_CRUZ_CENTER } from '@/types/address.types';

// Leaflet usa `window`: solo se renderiza en el navegador (evita el "_leaflet_pos"/crash de SSR).
// Reutiliza el mismo mapa del checkout de clientes (components/modules/checkout/AddressMap.tsx).
const AddressMap = dynamic(() => import('../checkout/AddressMap'), {
    ssr: false,
    loading: () => <MapLoading />,
});

interface BranchFormModalProps {
    branch?: Branch;
    // Solo con el permiso ALL_BRANCHES se puede activar/desactivar una sucursal
    canToggleActive: boolean;
    onClose: () => void;
    onSubmit: (payload: BranchPayload) => Promise<void>;
}

// Componente aparte: el loading de dynamic() no puede usar hooks inline
function MapLoading() {
    const t = useTranslations('AdminBranches');
    return <div className={styles.mapPlaceholder}>{t('loadingMap')}</div>;
}

function BranchFormModal({ branch, canToggleActive, onClose, onSubmit }: BranchFormModalProps) {
    const t = useTranslations('AdminBranches');
    const tc = useTranslations('AdminCommon');
    const [name, setName] = useState(branch?.name ?? '');
    const [address, setAddress] = useState(branch?.address ?? '');
    // Solo se manda lat/lng si el usuario realmente tocó el mapa (edición) o eligió una ubicación
    // (creación): así no se pisa una coordenada ya guardada con el valor por defecto de Santa Cruz.
    const [position, setPosition] = useState<MapPosition | null>(
        branch?.latitude != null && branch?.longitude != null
            ? { lat: branch.latitude, lng: branch.longitude }
            : null,
    );
    const [showMap, setShowMap] = useState(false);
    const [focusKey, setFocusKey] = useState(0);
    const [phone, setPhone] = useState(branch?.phone ?? '');
    const [isActive, setIsActive] = useState(branch?.isActive ?? true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleToggleMap = () => {
        setShowMap((prev) => {
            const next = !prev;
            // Al abrir por primera vez sin coordenadas previas, arranca centrado en la ciudad
            if (next && !position) setPosition(SANTA_CRUZ_CENTER);
            return next;
        });
    };

    const handleLocate = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(({ coords }) => {
            setPosition({ lat: coords.latitude, lng: coords.longitude });
            setFocusKey((key) => key + 1);
        });
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
            await onSubmit({
                name: name.trim(),
                address: address.trim(),
                ...(position ? { latitude: position.lat, longitude: position.lng } : {}),
                phone: phone.trim(),
                ...(canToggleActive ? { isActive } : {}),
            });
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, t('saveFailed')));
            setIsSaving(false);
        }
    };

    return (
        <AdminModal title={branch ? t('editTitle') : t('newTitle')} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                <div className={styles.field}>
                    <label htmlFor="branch-name">{tc('name')}</label>
                    <input
                        id="branch-name"
                        className={styles.input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={100}
                        placeholder={t('namePlaceholder')}
                    />
                </div>

                <div className={styles.field}>
                    <label htmlFor="branch-address">{t('address')}</label>
                    <div className={styles.addressRow}>
                        <input
                            id="branch-address"
                            className={styles.input}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            maxLength={255}
                            placeholder={t('addressPlaceholder')}
                        />
                        <button
                            type="button"
                            className={styles.buttonSecondary}
                            onClick={handleToggleMap}
                            aria-expanded={showMap}
                        >
                            <MapPin size={16} />
                            {t('locateOnMap')}
                        </button>
                    </div>

                    {showMap && position && (
                        <>
                            <div className={styles.mapWrapper}>
                                <AddressMap position={position} onPositionChange={setPosition} focusKey={focusKey} />
                            </div>
                            <div className={styles.mapFooter}>
                                <button type="button" className={styles.linkButton} onClick={handleLocate}>
                                    <MapPin size={14} />
                                    {t('useMyLocation')}
                                </button>
                                <span className={styles.coords}>
                                    Lat {position.lat.toFixed(5)}, Lng {position.lng.toFixed(5)}
                                </span>
                            </div>
                        </>
                    )}
                </div>

                <div className={styles.field}>
                    <label htmlFor="branch-phone">{t('phone')}</label>
                    <input
                        id="branch-phone"
                        className={styles.input}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        maxLength={30}
                        placeholder="+591 3 3345678"
                    />
                </div>

                {canToggleActive && (
                    <label className={styles.checkbox}>
                        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                        {t('activeLabel')}
                    </label>
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

export default function BranchesClient() {
    const { isGlobal } = useAdminRole();
    const t = useTranslations('AdminBranches');
    const tc = useTranslations('AdminCommon');
    const { branches, isLoading, error, createBranch, updateBranch, deleteBranch } = useAdminBranches();
    // undefined = cerrado, null = crear, Branch = editar
    const [editing, setEditing] = useState<Branch | null | undefined>(undefined);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const handleSubmit = async (payload: BranchPayload) => {
        if (editing) {
            await updateBranch(editing.id, payload);
        } else {
            await createBranch(payload);
        }
    };

    const handleDelete = async (branch: Branch) => {
        if (!window.confirm(t('confirmDelete', { name: branch.name }))) return;

        setBusyId(branch.id);
        setActionError(null);
        try {
            await deleteBranch(branch.id);
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
                    <p>{isGlobal ? t('subtitleGlobal') : t('subtitleOwn')}</p>
                </div>
                {/* Crear sucursales requiere el permiso ALL_BRANCHES */}
                {isGlobal && (
                    <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                        <Plus size={16} />
                        {t('new')}
                    </button>
                )}
            </div>

            {(error || actionError) && <div className={styles.errorMessage}>{error ?? actionError}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : branches.length === 0 ? (
                    <div className={styles.emptyState}>{t('empty')}</div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{tc('name')}</th>
                                    <th>{t('address')}</th>
                                    <th>{t('phone')}</th>
                                    <th>{tc('status')}</th>
                                    <th className={styles.numeric}>{tc('actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {branches.map((branch) => (
                                    <tr key={branch.id}>
                                        <td><span className={styles.cellTitle}>{branch.name}</span></td>
                                        <td>{branch.address ?? '—'}</td>
                                        <td>{branch.phone ?? '—'}</td>
                                        <td>
                                            <span className={`${styles.badge} ${branch.isActive ? styles.badgeSuccess : styles.badgeMuted}`}>
                                                {branch.isActive ? t('active') : t('inactive')}
                                            </span>
                                        </td>
                                        <td>
                                            <div className={styles.actions}>
                                                <button
                                                    type="button"
                                                    className={styles.buttonSecondary}
                                                    onClick={() => setEditing(branch)}
                                                >
                                                    <Pencil size={14} />
                                                    {tc('edit')}
                                                </button>
                                                {/* Eliminar sucursales requiere el permiso ALL_BRANCHES */}
                                                {isGlobal && (
                                                    <button
                                                        type="button"
                                                        className={styles.buttonDanger}
                                                        disabled={busyId === branch.id}
                                                        onClick={() => handleDelete(branch)}
                                                    >
                                                        <Trash2 size={14} />
                                                        {tc('delete')}
                                                    </button>
                                                )}
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
                <BranchFormModal
                    key={editing?.id ?? 'new'}
                    branch={editing ?? undefined}
                    canToggleActive={isGlobal}
                    onClose={() => setEditing(undefined)}
                    onSubmit={handleSubmit}
                />
            )}
        </div>
    );
}
