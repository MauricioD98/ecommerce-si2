'use client';

import React from 'react';
import Link from 'next/link';
import styles from './footer.module.scss';

export default function Footer() {
    return (
        <footer className={styles.footer}>
            <div className={styles.container}>
                <div className={styles.content}>
                    <div className={styles.brand}>
                        <h3>STELLA FEMME</h3>
                        <p>Moda femenina con estilo y calidad, en tu sucursal o en tu puerta.</p>
                    </div>

                    <div className={styles.section}>
                        <h4>Sucursales</h4>
                        <ul>
                            <li>
                                <Link href="/">Sucursal Centro</Link>
                            </li>
                            <li>
                                <Link href="/">Sucursal Equipetrol</Link>
                            </li>
                            <li>
                                <Link href="/">Tienda Online</Link>
                            </li>
                        </ul>
                    </div>

                    <div className={styles.section}>
                        <h4>Soporte</h4>
                        <ul>
                            <li>
                                <Link href="/">Preguntas Frecuentes</Link>
                            </li>
                            <li>
                                <Link href="/">Guía de Tallas</Link>
                            </li>
                            <li>
                                <Link href="/">Envíos y Entregas</Link>
                            </li>
                            <li>
                                <Link href="/">Política de Devoluciones</Link>
                            </li>
                        </ul>
                    </div>
                </div>

                <p className={styles.copyright}>
                    © {new Date().getFullYear()} Stella Femme. Todos los derechos reservados.
                </p>
            </div>
        </footer>
    );
}
