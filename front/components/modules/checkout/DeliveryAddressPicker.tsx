'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './delivery-step.module.scss';
import NewAddressForm from './NewAddressForm';
import { useAddresses } from '@/hooks/useAddresses';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { DeliveryAddress, toDeliveryAddress } from '@/types/address.types';

type Tab = 'saved' | 'new';

interface DeliveryAddressPickerProps {
    deliveryAddress: DeliveryAddress | null;
    onAddressChange: (address: DeliveryAddress | null) => void;
}

// "Mis Direcciones" (guardadas) o "Nueva Dirección" (mapa) para el envío a domicilio
export default function DeliveryAddressPicker({ deliveryAddress, onAddressChange }: DeliveryAddressPickerProps) {
    const { addresses, isLoading, error, createAddress, removeAddress } = useAddresses();
    const t = useTranslations('Checkout.addresses');
    const [chosenTab, setChosenTab] = useState<Tab | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const preselected = useRef(false);

    // Sin direcciones guardadas se abre directamente el mapa
    const tab: Tab = chosenTab ?? (addresses.length > 0 ? 'saved' : 'new');

    // Preselecciona la dirección predeterminada una sola vez
    useEffect(() => {
        if (preselected.current || isLoading) return;
        preselected.current = true;
        const defaultAddress = addresses.find((address) => address.isDefault);
        if (defaultAddress && !deliveryAddress) {
            onAddressChange(toDeliveryAddress(defaultAddress));
        }
    }, [isLoading, addresses, deliveryAddress, onAddressChange]);

    const handleRemove = async (id: string, title: string) => {
        if (!window.confirm(t('confirmDelete', { title }))) return;
        setActionError(null);
        try {
            await removeAddress(id);
            if (deliveryAddress?.id === id) onAddressChange(null);
        } catch (error) {
            setActionError(getApiErrorMessage(error, t('deleteFailed')));
        }
    };

    return (
        <div className={styles.addressPicker}>
            <div className={styles.tabs} role="tablist" aria-label={t('tabsLabel')}>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'saved'}
                    className={`${styles.tab} ${tab === 'saved' ? styles.tabActive : ''}`}
                    onClick={() => setChosenTab('saved')}
                >
                    {t('saved')}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'new'}
                    className={`${styles.tab} ${tab === 'new' ? styles.tabActive : ''}`}
                    onClick={() => setChosenTab('new')}
                >
                    {t('new')}
                </button>
            </div>

            {tab === 'saved' && (
                <div className={styles.savedList}>
                    {isLoading && <p className={styles.hint}>{t('loading')}</p>}
                    {(error || actionError) && <p className={styles.error}>{error ?? actionError}</p>}
                    {!isLoading && addresses.length === 0 && (
                        <p className={styles.hint}>{t('empty')}</p>
                    )}

                    {addresses.map((address) => {
                        const isSelected = deliveryAddress?.id === address.id;
                        return (
                            <div
                                key={address.id}
                                className={`${styles.addressCard} ${isSelected ? styles.branchSelected : ''}`}
                            >
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    className={styles.addressCardBody}
                                    onClick={() => onAddressChange(toDeliveryAddress(address))}
                                >
                                    <MapPin size={20} className={styles.addressIcon} />
                                    <span className={styles.optionText}>
                                        <span className={styles.branchName}>
                                            {address.title}
                                            {address.isDefault && <span className={styles.defaultBadge}>{t('default')}</span>}
                                        </span>
                                        <span className={styles.branchAddress}>{address.address}</span>
                                        {address.reference && <span className={styles.branchAddress}>{address.reference}</span>}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className={styles.iconButton}
                                    onClick={() => handleRemove(address.id, address.title)}
                                    aria-label={t('deleteLabel', { title: address.title })}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {tab === 'new' && (
                <NewAddressForm
                    onSave={createAddress}
                    onConfirm={(address) => {
                        onAddressChange(address);
                        // rAF antes de cambiar de tab (desmonta el mapa): le da a Leaflet un frame
                        // para asentar cualquier reposicionamiento pendiente del marcador. Ver el
                        // cleanup de AddressMap para el fix de fondo del "_leaflet_pos" de undefined.
                        requestAnimationFrame(() => setChosenTab('saved'));
                    }}
                />
            )}
        </div>
    );
}
