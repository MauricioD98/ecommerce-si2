'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Info, LocateFixed, X } from 'lucide-react';
import styles from './account.module.scss';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { CreateAddressPayload, MapPosition, SANTA_CRUZ_CENTER, UserAddress } from '@/types/address.types';

// Reutiliza el mapa del checkout. Leaflet usa `window`: solo se renderiza en el navegador
const AddressMap = dynamic(() => import('../checkout/AddressMap'), {
    ssr: false,
    loading: () => <div className={styles.mapPlaceholder}>Cargando mapa...</div>,
});

const MIN_ADDRESS_LENGTH = 5;

interface AddressModalProps {
    // Con `initial` se edita esa dirección; sin ella se crea una nueva
    initial?: UserAddress;
    onSave: (payload: CreateAddressPayload) => Promise<void>;
    onClose: () => void;
}

export default function AddressModal({ initial, onSave, onClose }: AddressModalProps) {
    const [position, setPosition] = useState<MapPosition>(
        initial ? { lat: initial.latitude, lng: initial.longitude } : SANTA_CRUZ_CENTER,
    );
    // Al crear, el marcador arranca en el centro de la ciudad: hay que moverlo para confirmar una ubicación real
    const [hasPickedLocation, setHasPickedLocation] = useState(Boolean(initial));
    const [focusKey, setFocusKey] = useState(0);
    const [title, setTitle] = useState(initial?.title ?? 'Casa');
    const [address, setAddress] = useState(initial?.address ?? '');
    const [reference, setReference] = useState(initial?.reference ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Cierra con Escape y evita que la página de fondo se desplace
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.body.style.overflow = previousOverflow;
        };
    }, [onClose]);

    const handlePositionChange = (next: MapPosition) => {
        setPosition(next);
        setHasPickedLocation(true);
    };

    const handleLocate = () => {
        if (!navigator.geolocation) {
            setError('Tu navegador no permite obtener la ubicación.');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                handlePositionChange({ lat: coords.latitude, lng: coords.longitude });
                setFocusKey((key) => key + 1);
                setError(null);
            },
            () => setError('No se pudo obtener tu ubicación. Mueve el marcador manualmente.'),
        );
    };

    const isAddressValid = address.trim().length >= MIN_ADDRESS_LENGTH;
    const canSubmit = hasPickedLocation && isAddressValid && title.trim().length > 0 && !isSaving;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setIsSaving(true);
        setError(null);
        try {
            await onSave({
                title: title.trim(),
                address: address.trim(),
                reference: reference.trim() || undefined,
                latitude: position.lat,
                longitude: position.lng,
            });
        } catch (err) {
            setError(getApiErrorMessage(err, 'No se pudo guardar la dirección.'));
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.overlay} onMouseDown={onClose}>
            <div
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-label={initial ? 'Editar dirección' : 'Nueva dirección'}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className={styles.modalHeader}>
                    <h2>{initial ? 'Editar dirección' : 'Nueva dirección'}</h2>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Cerrar">
                        <X size={20} />
                    </button>
                </div>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <p className={styles.hint}>Arrastra el marcador o toca el mapa para señalar la ubicación exacta.</p>

                    <div className={styles.mapWrapper}>
                        <AddressMap position={position} onPositionChange={handlePositionChange} focusKey={focusKey} />
                    </div>

                    <div className={styles.mapFooter}>
                        <button type="button" className={styles.linkButton} onClick={handleLocate}>
                            <LocateFixed size={16} /> Usar mi ubicación
                        </button>
                        <span className={styles.hint}>
                            {hasPickedLocation
                                ? `Lat ${position.lat.toFixed(5)}, Lng ${position.lng.toFixed(5)}`
                                : 'Aún no elegiste una ubicación'}
                        </span>
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="address-title">Nombre de la dirección</label>
                        <input id="address-title" type="text" value={title} maxLength={50} placeholder="Casa, Trabajo..." onChange={(e) => setTitle(e.target.value)} />
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="address-street">Calle y número</label>
                        <input id="address-street" type="text" value={address} maxLength={255} placeholder="Av. San Martín #1050, Equipetrol" autoComplete="street-address" onChange={(e) => setAddress(e.target.value)} />
                        {address.length > 0 && !isAddressValid && <span className={styles.fieldError}>Ingresa la calle y el número.</span>}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="address-reference">Referencias (opcional)</label>
                        <input id="address-reference" type="text" value={reference} maxLength={255} placeholder="Casa blanca con portón negro" onChange={(e) => setReference(e.target.value)} />
                    </div>

                    {error && (
                        <div className={styles.alertError} role="alert">
                            <Info size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className={styles.modalActions}>
                        <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={isSaving}>
                            Cancelar
                        </button>
                        <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
                            {isSaving ? 'Guardando...' : initial ? 'Guardar cambios' : 'Guardar dirección'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
