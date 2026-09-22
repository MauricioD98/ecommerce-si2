'use client';

import React from 'react';
import { MapPin, Store, Truck } from 'lucide-react';
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
}

export default function DeliveryStep({
    fulfillmentType,
    onFulfillmentChange,
    deliveryAddress,
    onAddressChange,
    onContinue,
}: DeliveryStepProps) {
    // La sucursal elegida es la misma del selector del Header: así el stock que ve el cliente coincide con el del pedido
    const { branches, selectedBranchId, selectBranch, isLoading, error } = useBranches();

    const isPickup = fulfillmentType === 'PICKUP';
    // El envío a domicilio necesita una dirección con su ubicación en el mapa
    const canContinue = !!selectedBranchId && (isPickup || !!deliveryAddress);

    const options: { type: FulfillmentType; icon: React.ReactNode; title: string; description: string }[] = [
        {
            type: 'DELIVERY',
            icon: <Truck size={22} />,
            title: 'Envío a domicilio',
            description: 'Recibe tu pedido en la dirección que indiques',
        },
        {
            type: 'PICKUP',
            icon: <Store size={22} />,
            title: 'Retiro en tienda',
            description: 'Recógelo en la sucursal que elijas. Sin costo de envío',
        },
    ];

    return (
        <div className={styles.delivery}>
            <h2>Método de entrega</h2>

            <div className={styles.options} role="radiogroup" aria-label="Método de entrega">
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
                {isPickup ? 'Sucursal de retiro' : 'Sucursal de despacho'}
            </h3>

            {isLoading && <p className={styles.hint}>Cargando sucursales...</p>}
            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.branches} role="radiogroup" aria-label="Sucursal">
                {branches.map((branch) => (
                    <button
                        key={branch.id}
                        type="button"
                        role="radio"
                        aria-checked={branch.id === selectedBranchId}
                        className={`${styles.branch} ${branch.id === selectedBranchId ? styles.branchSelected : ''}`}
                        onClick={() => selectBranch(branch.id)}
                    >
                        <span className={styles.branchName}>{branch.name}</span>
                        {branch.address && <span className={styles.branchAddress}>{branch.address}</span>}
                        {branch.phone && <span className={styles.branchAddress}>Tel: {branch.phone}</span>}
                    </button>
                ))}
            </div>
            {!selectedBranchId && !isLoading && (
                <p className={styles.hint}>Elige una sucursal para continuar.</p>
            )}

            {!isPickup && (
                <>
                    <h3 className={styles.subtitle}>Dirección de entrega</h3>
                    <DeliveryAddressPicker deliveryAddress={deliveryAddress} onAddressChange={onAddressChange} />

                    {deliveryAddress ? (
                        <div className={styles.selectedAddress}>
                            <MapPin size={18} />
                            <span>
                                Entregaremos en <strong>{deliveryAddress.address}</strong>
                                {deliveryAddress.reference ? ` (${deliveryAddress.reference})` : ''}
                            </span>
                        </div>
                    ) : (
                        <p className={styles.hint}>Elige una dirección guardada o agrega una nueva en el mapa.</p>
                    )}
                </>
            )}

            <button type="button" className={styles.continueButton} onClick={onContinue} disabled={!canContinue}>
                Continuar al pago
            </button>
        </div>
    );
}
