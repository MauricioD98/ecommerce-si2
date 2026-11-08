'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, MapPin, WifiOff, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './size-picker-modal.module.scss';
import { Product } from '@/types/product.types';
import { Branch } from '@/types/branch.types';
import { ProductService } from '@/service/api/product.service';
import { BranchService } from '@/service/api/branch.service';
import { useAppDispatch } from '@/store';
import { setSelectedBranch } from '@/store/slices/branchSlice';
import { useSelectedBranchId } from '@/hooks/useBranches';
import { useCart } from '@/hooks/useCart';
import { getSizeAvailability } from '@/utils/sizeAvailability';

interface SizePickerModalProps {
    // Producto tal como lo trae la tarjeta del catálogo (puede estar desactualizado)
    product: Product;
    onClose: () => void;
    // Recibe la copia recién consultada del producto (con el stock de la sucursal) y la talla elegida
    onConfirm: (product: Product, size: string) => void;
}

type Status = 'loading' | 'ready' | 'offline' | 'error' | 'no-branch';

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// Selector de talla del catálogo. La disponibilidad se consulta a la API con la sucursal elegida en el
// momento de abrir y se vuelve a verificar al confirmar. El carrito sigue siendo local: la reserva y la
// validación definitiva (producto activo, talla del producto, sucursal activa y stock) las hace
// PUT /cart en el checkout.
export default function SizePickerModal({ product, onClose, onConfirm }: SizePickerModalProps) {
    const t = useTranslations('Store.sizePicker');
    const dispatch = useAppDispatch();
    const branchId = useSelectedBranchId();
    const { items } = useCart();
    const titleId = useId();
    const descId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);

    // Resultado de la última consulta, etiquetado con la sucursal y el intento con que se pidió: si
    // cambia la sucursal, el resultado viejo deja de valer solo (no se muestra stock de otra sucursal)
    const [loaded, setLoaded] = useState<{ branchId: string; attempt: number; product: Product; offline: boolean } | null>(null);
    const [failed, setFailed] = useState<{ branchId: string; attempt: number } | null>(null);
    // La talla elegida también queda ligada a la sucursal en la que se eligió
    const [pick, setPick] = useState<{ branchId: string; size: string } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [branches, setBranches] = useState<Branch[] | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    // El catálogo se recarga al enfocar la ventana y entrega un objeto nuevo del mismo producto:
    // se guarda en refs para no reiniciar la selección por eso
    const productRef = useRef(product);
    const onCloseRef = useRef(onClose);
    const branchIdRef = useRef(branchId);
    const itemsRef = useRef(items);
    useEffect(() => {
        productRef.current = product;
        onCloseRef.current = onClose;
        branchIdRef.current = branchId;
        itemsRef.current = items;
    });
    const productId = product.id;

    // Nombre de la sucursal (solo informativo); no elige ninguna por su cuenta
    useEffect(() => {
        let active = true;
        BranchService.getActiveBranches().then((data) => {
            if (active) setBranches(data);
        });
        return () => {
            active = false;
        };
    }, []);

    // Carga el stock por talla de ESTA sucursal
    useEffect(() => {
        if (!branchId) return;
        let active = true;
        ProductService.getProductById(productId, branchId)
            .then((data) => {
                if (active) setLoaded({ branchId, attempt: reloadKey, product: data, offline: false });
            })
            .catch(() => {
                if (!active) return;
                // Sin conexión se usa el último catálogo cargado (ya traía stock por sucursal), avisando
                // que se confirmará al pagar. Con conexión, un error no se disfraza de disponibilidad.
                const cached = productRef.current;
                if (isOffline() && cached.id === productId && cached.stockBySize) {
                    setLoaded({ branchId, attempt: reloadKey, product: cached, offline: true });
                } else {
                    setFailed({ branchId, attempt: reloadKey });
                }
            });
        return () => {
            active = false;
        };
    }, [productId, branchId, reloadKey]);

    const current = loaded && loaded.branchId === branchId && loaded.attempt === reloadKey ? loaded : null;
    const fresh = current?.product ?? null;
    const status: Status = !branchId
        ? 'no-branch'
        : current
            ? (current.offline ? 'offline' : 'ready')
            : failed && failed.branchId === branchId && failed.attempt === reloadKey
                ? 'error'
                : 'loading';

    const availability = useMemo(
        () => (fresh ? getSizeAvailability(fresh, items) : null),
        [fresh, items],
    );
    const anyAvailable = !!availability?.some((row) => row.available > 0);

    // Talla efectiva: la elegida en esta sucursal mientras siga con stock; si el producto tiene una
    // sola talla y está disponible, queda marcada para que el cliente solo tenga que confirmarla
    const selected = useMemo(() => {
        if (!availability || !branchId) return null;
        if (pick && pick.branchId === branchId) {
            const row = availability.find((r) => r.size === pick.size);
            if (row && row.available > 0) return row.size;
        }
        if (availability.length === 1 && availability[0].available > 0) return availability[0].size;
        return null;
    }, [availability, pick, branchId]);

    // Escape cierra, Tab queda dentro del diálogo, el fondo no se desplaza y el foco vuelve al botón
    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialogRef.current?.focus();

        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (e.key !== 'Tab' || !dialogRef.current) return;
            const focusables = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
                ),
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.body.style.overflow = previousOverflow;
            previouslyFocused?.focus?.();
        };
    }, []);

    const handleConfirm = useCallback(async () => {
        if (!selected || !current || !branchId || current.branchId !== branchId) return;
        const requestBranch = branchId;
        setNotice(null);
        setIsConfirming(true);
        try {
            // Segunda consulta justo antes de añadir: el stock pudo cambiar mientras el modal estaba abierto
            let latest = current.product;
            if (!isOffline()) {
                try {
                    latest = await ProductService.getProductById(productId, requestBranch);
                } catch {
                    if (!isOffline()) {
                        setNotice(t('error'));
                        return;
                    }
                }
            }
            // Si mientras tanto cambió la sucursal, no se añade nada: el efecto ya recarga la nueva
            if (latest.id !== productId || branchIdRef.current !== requestBranch) return;
            setLoaded({ ...current, product: latest });
            const row = getSizeAvailability(latest, itemsRef.current)?.find((r) => r.size === selected);
            if (!row || row.available <= 0) {
                setPick(null);
                setNotice(t('stockChanged', { size: selected }));
                return;
            }
            onConfirm(latest, selected);
        } finally {
            setIsConfirming(false);
        }
    }, [selected, current, branchId, productId, onConfirm, t]);

    const branchName = branches?.find((b) => b.id === branchId)?.name;
    const canConfirm = !!selected && (status === 'ready' || status === 'offline') && !isConfirming;

    const content = (
        <div
            className={styles.overlay}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descId}
                tabIndex={-1}
            >
                <div className={styles.header}>
                    <div>
                        <h2 id={titleId} className={styles.title}>{t('title')}</h2>
                        <p id={descId} className={styles.productName}>{product.name}</p>
                    </div>
                    <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('close')}>
                        <X size={18} />
                    </button>
                </div>

                {status === 'no-branch' && (
                    <div className={styles.section}>
                        <p className={styles.info}>
                            <MapPin size={16} aria-hidden="true" />
                            <span>{t('noBranch')}</span>
                        </p>
                        {branches === null && <p className={styles.muted}>{t('loadingBranches')}</p>}
                        {branches !== null && branches.length === 0 && (
                            <p className={styles.muted}>{t('noBranches')}</p>
                        )}
                        <div className={styles.branchList}>
                            {(branches ?? []).map((branch) => (
                                <button
                                    key={branch.id}
                                    type="button"
                                    className={styles.branchBtn}
                                    onClick={() => dispatch(setSelectedBranch(branch.id))}
                                >
                                    <span className={styles.branchName}>{branch.name}</span>
                                    {branch.address && <span className={styles.muted}>{branch.address}</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {status === 'loading' && (
                    <p className={styles.loading} role="status">
                        <Loader2 size={18} className={styles.spin} aria-hidden="true" />
                        {t('loading')}
                    </p>
                )}

                {status === 'error' && (
                    <div className={styles.section}>
                        <p className={styles.error} role="alert">
                            <AlertTriangle size={16} aria-hidden="true" />
                            <span>{t('error')}</span>
                        </p>
                        <button type="button" className={styles.secondaryBtn} onClick={() => setReloadKey((k) => k + 1)}>
                            {t('retry')}
                        </button>
                    </div>
                )}

                {(status === 'ready' || status === 'offline') && availability && (
                    <div className={styles.section}>
                        {branchName && (
                            <p className={styles.muted}>
                                <MapPin size={14} aria-hidden="true" /> {t('availabilityAt', { branch: branchName })}
                            </p>
                        )}
                        {status === 'offline' && (
                            <p className={styles.warning}>
                                <WifiOff size={16} aria-hidden="true" />
                                <span>{t('offline')}</span>
                            </p>
                        )}
                        {availability.length === 1 && availability[0].available > 0 && (
                            <p className={styles.info}>{t('singleSize', { size: availability[0].size })}</p>
                        )}
                        {!anyAvailable && <p className={styles.error}>{t('noneAvailable')}</p>}

                        <fieldset className={styles.sizes}>
                            <legend className={styles.legend}>{t('sizesLabel')}</legend>
                            {availability.map((row) => {
                                const disabled = row.available <= 0;
                                return (
                                    <label
                                        key={row.size}
                                        className={`${styles.sizeOption} ${selected === row.size ? styles.sizeSelected : ''} ${disabled ? styles.sizeDisabled : ''}`}
                                    >
                                        <input
                                            type="radio"
                                            name={`size-${product.id}`}
                                            value={row.size}
                                            checked={selected === row.size}
                                            disabled={disabled}
                                            onChange={() => {
                                                if (branchId) setPick({ branchId, size: row.size });
                                                setNotice(null);
                                            }}
                                        />
                                        <span className={styles.sizeName}>{row.size}</span>
                                        <span className={styles.sizeStock}>
                                            {row.stock <= 0
                                                ? t('unavailable')
                                                : disabled
                                                    ? t('allInCart')
                                                    : t('available', { count: row.available })}
                                        </span>
                                    </label>
                                );
                            })}
                        </fieldset>
                    </div>
                )}

                {notice && (
                    <p className={styles.error} role="alert">
                        <AlertTriangle size={16} aria-hidden="true" />
                        <span>{notice}</span>
                    </p>
                )}

                <div className={styles.actions}>
                    <button type="button" className={styles.secondaryBtn} onClick={onClose}>
                        {t('cancel')}
                    </button>
                    <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={handleConfirm}
                        disabled={!canConfirm}
                    >
                        {isConfirming
                            ? t('checking')
                            : selected
                                ? t('confirm', { size: selected })
                                : t('chooseSize')}
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(content, document.body);
}
