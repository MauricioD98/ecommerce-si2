'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './admin-table.module.scss';

interface AdminModalProps {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}

export default function AdminModal({ title, onClose, children }: AdminModalProps) {
    // Cierra con Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <div className={styles.overlay} onMouseDown={onClose}>
            <div
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className={styles.modalHeader}>
                    <h2>{title}</h2>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Cerrar">
                        <X size={20} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
