'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { LocateFixed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './delivery-step.module.scss';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { CreateAddressPayload, DeliveryAddress, MapPosition, SANTA_CRUZ_CENTER, UserAddress } from '@/types/address.types';

// Leaflet usa `window`: el mapa solo se renderiza en el navegador
const AddressMap = dynamic(() => import('./AddressMap'), {
    ssr: false,
    loading: () => <MapLoading />,
});

// Componente aparte: el loading de dynamic() no puede usar hooks inline
function MapLoading() {
    const t = useTranslations('Checkout.addresses');
    return <div className={styles.mapPlaceholder}>{t('loadingMap')}</div>;
}

export const MIN_ADDRESS_LENGTH = 5;

interface NewAddressFormProps {
    onSave: (payload: CreateAddressPayload) => Promise<UserAddress>;
    onConfirm: (address: DeliveryAddress) => void;
}

export default function NewAddressForm({ onSave, onConfirm }: NewAddressFormProps) {
    const t = useTranslations('Checkout.addresses');
    const [position, setPosition] = useState<MapPosition>(SANTA_CRUZ_CENTER);
    // El marcador empieza en el centro de la ciudad: hay que moverlo para confirmar una ubicación real
    const [hasPickedLocation, setHasPickedLocation] = useState(false);
    const [focusKey, setFocusKey] = useState(0);
    const [title, setTitle] = useState(() => t('defaultName'));
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
            setError(t('geolocationUnsupported'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                handlePositionChange({ lat: coords.latitude, lng: coords.longitude });
                setFocusKey((key) => key + 1);
                setError(null);
            },
            () => setError(t('geolocationFailed'))
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
            setError(getApiErrorMessage(error, t('saveFailed')));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.newAddress}>
            <p className={styles.hint}>
                {t('mapHint')}
            </p>

            <div className={styles.mapWrapper}>
                <AddressMap position={position} onPositionChange={handlePositionChange} focusKey={focusKey} />
            </div>

            <div className={styles.mapFooter}>
                <button type="button" className={styles.linkButton} onClick={handleLocate}>
                    <LocateFixed size={16} />
                    {t('useMyLocation')}
                </button>
                <span className={styles.coords}>
                    {hasPickedLocation
                        ? `Lat ${position.lat.toFixed(5)}, Lng ${position.lng.toFixed(5)}`
                        : t('noLocation')}
                </span>
            </div>

            <div className={styles.field}>
                <label htmlFor="address-title">{t('name')}</label>
                <input
                    id="address-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={50}
                    placeholder={t('namePlaceholder')}
                />
            </div>

            <div className={styles.field}>
                <label htmlFor="address-street">{t('street')}</label>
                <input
                    id="address-street"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    maxLength={255}
                    placeholder={t('streetPlaceholder')}
                    autoComplete="street-address"
                />
                {address.length > 0 && !isAddressValid && (
                    <span className={styles.error}>{t('streetInvalid')}</span>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor="address-reference">{t('reference')}</label>
                <input
                    id="address-reference"
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={255}
                    placeholder={t('referencePlaceholder')}
                />
            </div>

            <label className={styles.checkbox}>
                <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                {t('save')}
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button
                type="button"
                className={styles.continueButton}
                onClick={handleConfirm}
                disabled={!canConfirm || isSaving}
            >
                {isSaving ? t('saving') : t('confirm')}
            </button>
        </div>
    );
}
