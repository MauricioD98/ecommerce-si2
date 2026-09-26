'use client';

import React, { useEffect } from 'react';
import styles from "./header.module.scss";
import Link from 'next/link';
import { LayoutDashboard, ShoppingCart, User as UserIcon, LogOut } from "lucide-react";
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useRouter } from 'next/navigation';
import { canAccessAdmin } from '@/utils/permissions';
import BranchSelector from './BranchSelector';

export default function Header(){
    const {totalItems} = useCart();
    const {isAuthenticated,isLoading,user,logout,refreshProfile}=useAuth();
    const router = useRouter();

    // Mantiene actualizado el descuento de trabajador y el rol del usuario
    useEffect(()=>{
        if(isAuthenticated){
            refreshProfile();
        }
    },[isAuthenticated,refreshProfile]);

    const showDashboard = canAccessAdmin(user);
    const handleLogoutClick = async ()=>{
        await logout()
    }
    const handleLoginClick = ()=>{
        router.push("/auth/login");
    }

    return (
        <header className={styles.header}>
            <div className={styles.containers}>
               {/* logo */}
               <Link href="/" className={styles.logo}>
                STELLA FEMME
               </Link>

               {/* Branch selector - Solo visible en pantallas grandes */}
               <div className={styles.desktopBranch}>
                 <BranchSelector />
               </div>

               {/* Acciones e iconos */}
               <div className={styles.actions}>
                <Link href="/cart" className={styles.cartButton} aria-label="Carrito de compras" title="Carrito">
                    <ShoppingCart size={19} />
                    {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
                </Link>

                {isAuthenticated ? (
                    <>
                     <Link href="/account" className={styles.cartButton} aria-label="Mi cuenta" title="Mi cuenta">
                        <UserIcon size={19} />
                     </Link>
                     {showDashboard && (
                        <Link href="/admin" className={styles.cartButton} aria-label="Panel administrativo" title="Panel administrativo">
                            <LayoutDashboard size={19} />
                        </Link>
                     )}
                     <button
                        onClick={handleLogoutClick}
                        className={styles.logoutButton}
                        disabled={isLoading}
                        title="Cerrar sesión"
                        aria-label="Cerrar sesión"
                     >
                      <LogOut size={16} className={styles.logoutIcon} />
                      <span className={styles.logoutText}>{isLoading ? "..." : "Cerrar sesión"}</span>
                     </button>
                    </>
                ):(
                   <button className={styles.loginButton} onClick={handleLoginClick} title="Iniciar sesión">
                    Iniciar sesión
                   </button>
                )}
               </div>
            </div>

            {/* Selector de sucursal en móvil (< 768px): fila dedicada y limpia */}
            <div className={styles.mobileBranchRow}>
              <BranchSelector />
            </div>
        </header>
    );
};