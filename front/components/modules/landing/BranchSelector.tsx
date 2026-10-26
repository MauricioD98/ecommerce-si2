'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './branch-selector.module.scss';
import { useBranches } from '@/hooks/useBranches';

export default function BranchSelector() {
    const { branches, selectedBranch, selectedBranchId, selectBranch, isLoading, error } = useBranches();
    const [open, setOpen] = useState(false);
    const t = useTranslations('Store.branch');
    const containerRef = useRef<HTMLDivElement>(null);

    // Cierra el menú al hacer clic fuera o con Escape
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open]);

    const handleSelect = (branchId: string) => {
        selectBranch(branchId);
        setOpen(false);
    };

    return (
        <div className={styles.container} ref={containerRef}>
            <button
                type="button"
                className={`${styles.trigger} ${!selectedBranch ? styles.triggerEmpty : ''}`}
                onClick={() => setOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <MapPin size={16} />
                <span className={styles.triggerLabel}>
                    {selectedBranch ? selectedBranch.name : t('choose')}
                </span>
                <ChevronDown size={16} className={open ? styles.chevronOpen : ''} />
            </button>

            {open && (
                <div className={styles.menu} role="listbox" aria-label={t('menuLabel')}>
                    <p className={styles.menuTitle}>{t('question')}</p>

                    {isLoading && <p className={styles.message}>{t('loading')}</p>}
                    {error && <p className={styles.messageError}>{error}</p>}
                    {!isLoading && !error && branches.length === 0 && (
                        <p className={styles.message}>{t('empty')}</p>
                    )}

                    {(branches || []).map((branch) => (
                        <button
                            key={branch.id}
                            type="button"
                            role="option"
                            aria-selected={branch.id === selectedBranchId}
                            className={`${styles.option} ${branch.id === selectedBranchId ? styles.optionActive : ''}`}
                            onClick={() => handleSelect(branch.id)}
                        >
                            <span className={styles.optionInfo}>
                                <span className={styles.optionName}>{branch.name}</span>
                                {branch.address && <span className={styles.optionAddress}>{branch.address}</span>}
                            </span>
                            {branch.id === selectedBranchId && <Check size={16} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
