'use client';

import React from 'react';
import { Check, XCircle } from 'lucide-react';
import styles from './orders.module.scss';
import { ORDER_TIMELINE_STEPS, OrderStatusValue } from './orderStatus';

interface OrderTimelineProps {
    status: OrderStatusValue;
}

// Línea de tiempo del pedido: [✓ Pago Confirmado] -- [✓ Preparando] -- [ En Camino ] -- [ Entregado ]
export default function OrderTimeline({ status }: OrderTimelineProps) {
    if (status === 'CANCELADO') {
        return (
            <div className={styles.cancelledBanner}>
                <XCircle size={20} />
                <span>Este pedido fue cancelado.</span>
            </div>
        );
    }

    const currentIndex = ORDER_TIMELINE_STEPS.findIndex((step) => step.status === status);

    return (
        <div className={styles.timeline}>
            {ORDER_TIMELINE_STEPS.map((step, index) => {
                const done = index <= currentIndex;
                const active = index === currentIndex;
                const isLast = index === ORDER_TIMELINE_STEPS.length - 1;

                return (
                    <React.Fragment key={step.status}>
                        <div className={styles.timelineStep}>
                            <span
                                className={`${styles.timelineDot} ${done ? styles.timelineDotDone : ''} ${active ? styles.timelineDotActive : ''}`}
                            >
                                {done ? <Check size={16} /> : index + 1}
                            </span>
                            <span className={`${styles.timelineLabel} ${done ? styles.timelineLabelDone : ''}`}>
                                {step.label}
                            </span>
                        </div>
                        {!isLast && (
                            <div className={`${styles.timelineConnector} ${index < currentIndex ? styles.timelineConnectorDone : ''}`} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}
