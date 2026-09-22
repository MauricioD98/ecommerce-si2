'use client';

import React from 'react';
import styles from './footer.module.scss';
import { Link } from 'lucide-react';
export default function Footer() {
    return <footer className={styles.footer}>
        <div className={styles.container}>
            <div className={styles.content}>
                <div className={styles.brand}>
                    <h3 >STELLA FEMME</h3>
                    <p>Moda femenina con estilo y calidad, en tu sucursal o en tu puerta.</p>
                </div>

                <div className={styles.section}>
                    <h4>Tienda</h4>
                    <ul>
                        <li>
                            <Link href="/">Todos los productos</Link>
                        </li>
                        <li>
                            <Link href="/">Categorías</Link>
                        </li>
                        <li>
                            <Link href="/">Novedades</Link>
                        </li>
                        <li>
                            <Link href="/">Ofertas</Link>
                        </li>
                    </ul>
                </div>

                <div className={styles.section}>
                    <h4>Soporte</h4>
                    <ul>
                        <li>
                            <Link href="/">Centro de ayuda</Link>
                        </li>
                        <li>
                            <Link href="/">Contáctanos</Link>
                        </li>
                        <li>
                            <Link href="/">Información de envío</Link>
                        </li>
                        <li>
                            <Link href="/">Devoluciones y cambios</Link>
                        </li>
                    </ul>
                </div>

                <div className={styles.section}>
                    <h4>Empresa</h4>
                    <ul>
                        <li>
                            <Link href="/">Sobre nosotros</Link>
                        </li>
                        <li>
                            <Link href="/">Trabaja con nosotros</Link>
                        </li>
                        <li>
                            <Link href="/">Política de privacidad</Link>
                        </li>
                        <li>
                            <Link href="/">Términos del servicio</Link>
                        </li>
                    </ul>
                </div>            </div>
            <p style={{ color: '#666', fontSize: '0.8rem', textAlign: 'center' }}>
                © {new Date().getFullYear()} Stella Femme. Todos los derechos reservados.
            </p>
        </div>
    </footer>
};