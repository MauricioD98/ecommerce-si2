'use client';

import React, { useState } from 'react';
import { Info, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import styles from './account.module.scss';
import { useAddresses } from '@/hooks/useAddresses';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { CreateAddressPayload, UserAddress } from '@/types/address.types';
import AddressModal from './AddressModal';

// Pestaña 2: CRUD de direcciones en tarjetas. Crear y editar abren el modal con el mapa
export default function AddressesTab() {
    const { addresses, isLoading, error, createAddress, updateAddress, setDefaultAddress, removeAddress } = useAddresses();
    // null = modal cerrado; { address: undefined } = nueva; { address } = editar
    const [modal, setModal] = useState<{ address?: UserAddress } | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const runAction = async (id: string, action: () => Promise<unknown>, fallback: string) => {
        setBusyId(id);
        setActionError(null);
        try {
            await action();
        } catch (err) {
            setActionError(getApiErrorMessage(err, fallback));
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = (address: UserAddress) => {
        if (!window.confirm(`¿Eliminar la dirección "${address.title}"?`)) return;
        runAction(address.id, () => removeAddress(address.id), 'No se pudo eliminar la dirección.');
    };

    const handleSave = async (payload: CreateAddressPayload) => {
        if (modal?.address) {
            await updateAddress(modal.address.id, payload);
        } else {
            await createAddress(payload);
        }
        // requestAnimationFrame en vez de desmontar ya mismo: si el usuario soltó el marcador justo
        // antes de tocar "Guardar", Leaflet todavía puede tener un reposicionamiento agendado para el
        // próximo frame. Cerrar en el frame siguiente le da tiempo a terminar antes de que React
        // saque el mapa del DOM (ver el cleanup de AddressMap para el fix de fondo).
        requestAnimationFrame(() => setModal(null));
    };

    return (
        <div className={styles.card}>
            <div className={styles.headingRow}>
                <div>
                    <h1 className={styles.heading}>Mis direcciones</h1>
                    <p className={styles.subheading}>Guarda tus direcciones con su ubicación en el mapa para pedir más rápido.</p>
                </div>
                <button type="button" className={styles.primaryButton} onClick={() => setModal({})}>
                    <Plus size={18} />
                    Nueva dirección
                </button>
            </div>

            {(error || actionError) && (
                <div className={styles.alertError} role="alert">
                    <Info size={18} />
                    <span>{actionError ?? error}</span>
                </div>
            )}

            {isLoading ? (
                <p className={styles.empty}>Cargando direcciones...</p>
            ) : addresses.length === 0 ? (
                <div className={styles.empty}>
                    <MapPin size={32} />
                    <p>Aún no tienes direcciones guardadas.</p>
                </div>
            ) : (
                <ul className={styles.addressGrid}>
                    {addresses.map((address) => (
                        <li key={address.id} className={`${styles.addressCard} ${address.isDefault ? styles.addressCardDefault : ''}`}>
                            <div className={styles.addressHeader}>
                                <h2 className={styles.addressTitle}>{address.title}</h2>
                                {address.isDefault && (
                                    <span className={styles.badge}>
                                        <Star size={12} /> Predeterminada
                                    </span>
                                )}
                            </div>
                            <p className={styles.addressText}>{address.address}</p>
                            {address.reference && <p className={styles.addressReference}>{address.reference}</p>}
                            <p className={styles.addressCoords}>
                                <MapPin size={14} />
                                {address.latitude.toFixed(5)}, {address.longitude.toFixed(5)}
                            </p>

                            <div className={styles.addressActions}>
                                {!address.isDefault && (
                                    <button
                                        type="button"
                                        className={styles.linkButton}
                                        disabled={busyId === address.id}
                                        onClick={() => runAction(address.id, () => setDefaultAddress(address.id), 'No se pudo marcar como predeterminada.')}
                                    >
                                        <Star size={14} /> Marcar como predeterminada
                                    </button>
                                )}
                                <button type="button" className={styles.linkButton} disabled={busyId === address.id} onClick={() => setModal({ address })}>
                                    <Pencil size={14} /> Editar
                                </button>
                                <button type="button" className={`${styles.linkButton} ${styles.linkDanger}`} disabled={busyId === address.id} onClick={() => handleDelete(address)}>
                                    <Trash2 size={14} /> Eliminar
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {modal && <AddressModal initial={modal.address} onSave={handleSave} onClose={() => setModal(null)} />}
        </div>
    );
}
