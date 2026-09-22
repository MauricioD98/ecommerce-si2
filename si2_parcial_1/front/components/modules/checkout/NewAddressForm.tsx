'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { LocateFixed } from 'lucide-react';
import styles from './delivery-step.module.scss';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { CreateAddressPayload, DeliveryAddress, MapPosition, SANTA_CRUZ_CENTER, UserAddress } from '@/types/address.types';

// Leaflet usa `window`: el mapa solo se renderiza en el navegador
const AddressMap = dynamic(() => import('./AddressMap'), {
    ssr: false,
    loading: () => <div className={styles.mapPlaceholder}>Cargando mapa...</div>,
});

export const MIN_ADDRESS_LENGTH = 5;

interface NewAddressFormProps {
    onSave: (payload: CreateAddressPayload) => Promise<UserAddress>;
    onConfirm: (address: DeliveryAddress) => void;
}

export default function NewAddressForm({ onSave, onConfirm }: NewAddressFormProps) {
    const [position, setPosition] = useState<MapPosition>(SANTA_CRUZ_CENTER);
    // El marcador empieza en el centro de la ciudad: hay que moverlo para confirmar una ubicación real
    const [hasPickedLocation, setHasPickedLocation] = useState(false);
    const [focusKey, setFocusKey] = useState(0);
    const [title, setTitle] = useState('Casa');
    const [address, setAddress] = useState('');
    const [reference, setReference] = useState('');
    const [saveAddress, setSaveAddress] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            () => setError('No se pudo obtener tu ubicación. Mueve el marcador manualmente.')
        );
    };

    const isAddressValid = address.trim().length >= MIN_ADDRESS_LENGTH;
    const canConfirm = hasPickedLocation && isAddressValid && title.trim().length > 0;

    const handleConfirm = async () => {
        setError(null);

        const payload: CreateAddressPayload = {
            title: title.trim(),
            address: address.trim(),
            reference: reference.trim() || undefined,
            latitude: position.lat,
            longitude: position.lng,
        };

        // Sin guardar, la dirección se usa solo en este pedido
        if (!saveAddress) {
            onConfirm({ ...payload });
            return;
        }

        setIsSaving(true);
        try {
            const saved = await onSave(payload);
            onConfirm({
                id: saved.id,
                title: saved.title,
                address: saved.address,
                reference: saved.reference,
                latitude: saved.latitude,
                longitude: saved.longitude,
            });
        } catch (error) {
            setError(getApiErrorMessage(error, 'No se pudo guardar la dirección.'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.newAddress}>
            <p className={styles.hint}>
                Arrastra el marcador o toca el mapa para señalar tu ubicación exacta.
            </p>

            <div className={styles.mapWrapper}>
                <AddressMap position={position} onPositionChange={handlePositionChange} focusKey={focusKey} />
            </div>

            <div className={styles.mapFooter}>
                <button type="button" className={styles.linkButton} onClick={handleLocate}>
                    <LocateFixed size={16} />
                    Usar mi ubicación
                </button>
                <span className={styles.coords}>
                    {hasPickedLocation
                        ? `Lat ${position.lat.toFixed(5)}, Lng ${position.lng.toFixed(5)}`
                        : 'Aún no elegiste una ubicación'}
                </span>
            </div>

            <div className={styles.field}>
                <label htmlFor="address-title">Nombre de la dirección</label>
                <input
                    id="address-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={50}
                    placeholder="Casa, Trabajo..."
                />
            </div>

            <div className={styles.field}>
                <label htmlFor="address-street">Calle y número</label>
                <input
                    id="address-street"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    maxLength={255}
                    placeholder="Av. San Martín #1050, Equipetrol"
                    autoComplete="street-address"
                />
                {address.length > 0 && !isAddressValid && (
                    <span className={styles.error}>Ingresa la calle y el número.</span>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor="address-reference">Referencias (opcional)</label>
                <input
                    id="address-reference"
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={255}
                    placeholder="Portón negro, frente al parque"
                />
            </div>

            <label className={styles.checkbox}>
                <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                Guardar en mis direcciones
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button
                type="button"
                className={styles.continueButton}
                onClick={handleConfirm}
                disabled={!canConfirm || isSaving}
            >
                {isSaving ? 'Guardando...' : 'Confirmar dirección'}
            </button>
        </div>
    );
}
