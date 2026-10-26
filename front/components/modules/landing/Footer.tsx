'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useStoreName } from '@/providers/StoreInfoProvider';
import { useStoreAppearance } from '@/providers/StoreAppearanceProvider';
import { SOCIAL_ICONS } from '../appearance/socialIcons';
import styles from './footer.module.scss';

export default function Footer() {
    const t = useTranslations('Footer');
    const tSocial = useTranslations('AdminAppearance.social.platforms');
    const storeName = useStoreName();
    // Redes que la tienda configuró en /admin/settings/appearance
    const { socialLinks } = useStoreAppearance();

    return (
        <footer className={styles.footer}>
            <div className={styles.container}>
                <div className={styles.content}>
                    <div className={styles.brand}>
                        <h3>{storeName}</h3>
                        <p>{t('tagline')}</p>
                        {socialLinks && socialLinks.length > 0 && (
                            <div className={styles.social}>
                                {socialLinks.map((link, i) => {
                                    const Icon = SOCIAL_ICONS[link.platform] ?? SOCIAL_ICONS.website;
                                    const label = tSocial(link.platform);
                                    return (
                                        <a key={`${link.platform}-${i}`} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
                                            <Icon size={18} />
                                        </a>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className={styles.section}>
                        <h4>{t('branches')}</h4>
                        <ul>
                            <li>
                                <Link href="/">{t('branchCentro')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('branchEquipetrol')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('onlineStore')}</Link>
                            </li>
                        </ul>
                    </div>

                    <div className={styles.section}>
                        <h4>{t('support')}</h4>
                        <ul>
                            <li>
                                <Link href="/">{t('faq')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('sizeGuide')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('shipping')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('returns')}</Link>
                            </li>
                        </ul>
                    </div>
                </div>

                <p className={styles.copyright}>
                    {t('rights', { year: new Date().getFullYear(), store: storeName })}
                </p>
            </div>
        </footer>
    );
}
