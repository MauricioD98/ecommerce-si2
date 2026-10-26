'use client';

import React from 'react';
import { LayoutDashboard, Palette, Search, ShoppingBag, ShoppingCart, Store, User as UserIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { StoreAppearance } from '@/types/appearance.types';
import { appearanceCssVars, backgroundImageCss } from '@/utils/appearanceTheme';
import { getStoreFontClass } from '@/utils/fonts';
import { SOCIAL_ICONS } from './socialIcons';
import styles from './appearance.module.scss';

interface Props {
    storeName: string;
    appearance: StoreAppearance;
    // Imágenes ya resueltas para mostrar (object URL de un archivo sin subir, o la guardada)
    logoSrc: string | null;
    backgroundSrc: string | null;
}

// Maqueta de la tienda pública (header, búsqueda, ficha de producto, footer) y del menú del panel.
// Usa las mismas variables CSS y la misma clase de fuente que app/layout.tsx pone en <body>, así que
// lo que se ve acá es lo que verá el cliente.
export default function AppearancePreview({ storeName, appearance, logoSrc, backgroundSrc }: Props) {
    const t = useTranslations('AdminAppearance.preview');
    // La vista previa siempre usa la imagen local tal cual (object URL o data URL): no hace falta el
    // Route Handler de la tienda
    const themeStyle = appearanceCssVars(appearance, backgroundSrc ? `url(${JSON.stringify(backgroundSrc)})` : backgroundImageCss(null));
    const links = (appearance.socialLinks ?? []).filter((link) => link.url.trim());

    return (
        <div className={`${styles.previewTheme} ${getStoreFontClass(appearance.fontFamily)}`} style={themeStyle}>
            <div className={styles.previewFrame} aria-label={t('label')} role="img">
                <div className={styles.browserBar} aria-hidden>
                    <span /><span /><span />
                    <div className={styles.browserUrl}>{t('url')}</div>
                </div>

                <header className={styles.previewHeader}>
                    {logoSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element -- object URL / data URL local
                        <img src={logoSrc} alt="" className={styles.previewLogo} />
                    ) : (
                        <strong className={styles.previewBrand}>{storeName}</strong>
                    )}
                    <div className={styles.previewIcons} aria-hidden>
                        <UserIcon size={15} />
                        <span className={styles.previewCart}>
                            <ShoppingCart size={15} />
                            <span className={styles.previewBadge}>2</span>
                        </span>
                    </div>
                </header>

                <div className={styles.previewBody}>
                    <div className={styles.previewSearch} aria-hidden>
                        <Search size={13} />
                        {t('search')}
                    </div>

                    <div className={styles.previewHero}>
                        <h3>{storeName}</h3>
                        <p>{appearance.description?.trim() || t('descriptionPlaceholder')}</p>
                    </div>

                    <div className={styles.previewProduct}>
                        <div className={styles.previewImage} aria-hidden>
                            <ShoppingBag size={34} />
                        </div>
                        <div className={styles.previewInfo}>
                            <span className={styles.previewCategory}>{t('category')}</span>
                            <strong>{t('productName')}</strong>
                            <span className={styles.previewPrice}>Bs 249.00</span>
                            <div className={styles.previewSizes} aria-hidden>
                                {['S', 'M', 'L'].map((size) => (
                                    <span key={size} className={size === 'M' ? styles.previewSizeActive : undefined}>{size}</span>
                                ))}
                            </div>
                            {/* No es un botón real: la maqueta entera es role="img" */}
                            <span className={styles.previewBuy}>{t('addToCart')}</span>
                        </div>
                    </div>
                </div>

                <footer className={styles.previewFooter}>
                    <span>© {new Date().getFullYear()} {storeName}</span>
                    {links.length > 0 && (
                        <div className={styles.previewSocial}>
                            {links.map((link, i) => {
                                const Icon = SOCIAL_ICONS[link.platform];
                                return <Icon key={`${link.platform}-${i}`} size={15} />;
                            })}
                        </div>
                    )}
                </footer>
            </div>

            {/* Menú lateral del panel con el color elegido para el panel */}
            <div className={styles.previewAdmin} aria-label={t('adminLabel')} role="img">
                <strong>{storeName}</strong>
                <span className={styles.previewAdminItem}><LayoutDashboard size={13} />{t('adminOrders')}</span>
                <span className={`${styles.previewAdminItem} ${styles.previewAdminActive}`}><Palette size={13} />{t('adminCustomize')}</span>
                <span className={styles.previewAdminItem}><Store size={13} />{t('adminStore')}</span>
            </div>
        </div>
    );
}
