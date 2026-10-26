'use client';

import React from 'react';
import { MapPin, Store, Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './delivery-step.module.scss';
import DeliveryAddressPicker from './DeliveryAddressPicker';
import { useBranches } from '@/hooks/useBranches';
import { FulfillmentType } from '@/types/branch.types';
import { DeliveryAddress } from '@/types/address.types';

interface DeliveryStepProps {
    fulfillmentType: FulfillmentType;
    onFulfillmentChange: (type: FulfillmentType) => void;
    deliveryAddress: DeliveryAddress | null;
    onAddressChange: (address: DeliveryAddress | null) => void;
    onContinue: () => void;
    stockError?: string | null;
}

export default function DeliveryStep({
    fulfillmentType,
    onFulfillmentChange,
    deliveryAddress,
    onAddressChange,
    onContinue,
    stockError,
}: DeliveryStepProps) {
    // La sucursal elegida es la misma donde el cliente seleccionó y realizó su pedido
    const { branches, selectedBranch, selectedBranchId, isLoading, error } = useBranches();
    const t = useTranslations('Checkout.delivery');

    const isPickup = fulfillmentType === 'PICKUP';
    // El envío a domicilio necesita una dirección con su ubicación en el mapa
    const canContinue = !!selectedBranchId && (isPickup || !!deliveryAddress);

    // Solo debe aparecer la sucursal donde realizó el pedido
    const activeBranch = selectedBranch || branches.find((b) => b.id === selectedBranchId) || (branches.length > 0 ? branches[0] : null);
    const displayedBranches = activeBranch ? [activeBranch] : [];

    const options: { type: FulfillmentType; icon: React.ReactNode; title: string; description: string }[] = [
        {
            type: 'DELIVERY',
            icon: <Truck size={22} />,
            title: t('homeDelivery'),
            description: t('homeDeliveryDescription'),
        },
        {
            type: 'PICKUP',
            icon: <Store size={22} />,
            title: t('pickup'),
            description: t('pickupDescription'),
        },
    ];

    return (
        <div className={styles.delivery}>
            <h2>{t('title')}</h2>

            <div className={styles.options} role="radiogroup" aria-label={t('title')}>
                {options.map((option) => (
                    <button
                        key={option.type}
                        type="button"
                        role="radio"
                        aria-checked={fulfillmentType === option.type}
                        className={`${styles.option} ${fulfillmentType === option.type ? styles.optionSelected : ''}`}
                        onClick={() => onFulfillmentChange(option.type)}
                    >
                        <span className={styles.optionIcon}>{option.icon}</span>
                        <span className={styles.optionText}>
                            <span className={styles.optionTitle}>{option.title}</span>
                            <span className={styles.optionDescription}>{option.description}</span>
                        </span>
                    </button>
                ))}
            </div>

            <h3 className={styles.subtitle}>
                {isPickup ? t('pickupBranch') : t('dispatchBranch')}
            </h3>

            {isLoading && <p className={styles.hint}>{t('loadingBranch')}</p>}
            {error && <p className={styles.error}>{error}</p>}

            {displayedBranches.length > 0 && (
                <div className={styles.branches}>
                    {displayedBranches.map((branch) => (
                        <div
                            key={branch.id}
                            className={`${styles.branch} ${styles.branchSelected}`}
                            style={{ cursor: 'default' }}
                        >
                            <span className={styles.branchName}>{branch.name}</span>
                            {branch.address && <span className={styles.branchAddress}>{branch.address}</span>}
                            {branch.phone && <span className={styles.branchAddress}>{t('phone', { phone: branch.phone })}</span>}
                        </div>
                    ))}
                </div>
            )}
            {!activeBranch && !isLoading && (
                <p className={styles.hint}>{t('branchNotFound')}</p>
            )}

            {!isPickup && (
                <>
                    <h3 className={styles.subtitle}>{t('addressTitle')}</h3>
                    <DeliveryAddressPicker deliveryAddress={deliveryAddress} onAddressChange={onAddressChange} />

                    {deliveryAddress ? (
                        <div className={styles.selectedAddress}>
                            <MapPin size={18} />
                            <span>
                                {t.rich('deliverTo', {
                                    address: deliveryAddress.address,
                                    reference: deliveryAddress.reference ? ` (${deliveryAddress.reference})` : '',
                                    strong: (chunks) => <strong>{chunks}</strong>,
                                })}
                            </span>
                        </div>
                    ) : (
                        <p className={styles.hint}>{t('chooseAddress')}</p>
                    )}
                </>
            )}

            {stockError && <p className={styles.error}>{stockError}</p>}

            <button type="button" className={styles.continueButton} onClick={onContinue} disabled={!canContinue}>
                {t('continue')}
            </button>
        </div>
    );
}
