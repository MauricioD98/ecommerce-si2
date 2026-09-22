'use client'

import React from 'react';
import styles from './breadcrumbs.module.scss'
import { Link } from 'lucide-react';

export default function Breadcrumbs({ productName = "Nombre del producto" }: { productName: string }) {
    return (
        <div className={styles.breadcrumbs}>
            <div className={styles.container}>
                <nav className={styles.nav} aria-label="Ruta de navegación">
                    <Link className={styles.link} href="/">
                        Tienda
                    </Link>
                    <span className={styles.separator}></span>
                    <span className={styles.current}>{productName}</span>
                </nav>
            </div>
        </div>
    )
}