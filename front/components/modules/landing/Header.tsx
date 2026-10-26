'use client';

import React, { useEffect } from 'react';
import styles from "./header.module.scss";
import Link from 'next/link';
import { LayoutDashboard, ShoppingCart, User as UserIcon, LogOut } from "lucide-react";
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useRouter } from 'next/navigation';
import { canAccessAdmin } from '@/utils/permissions';
import { useTranslations } from 'next-intl';
import { useStoreName } from '@/providers/StoreInfoProvider';
import BranchSelector from './BranchSelector';
import LanguageSwitcher from '../i18n/LanguageSwitcher';

export default function Header(){
    const {totalItems} = useCart();
    const {isAuthenticated,isLoading,user,logout,refreshProfile}=useAuth();
    const router = useRouter();
    const t = useTranslations('Header');
    const storeName = useStoreName();

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
                {storeName}
               </Link>

               {/* Branch selector - Solo visible en pantallas grandes */}
               <div className={styles.desktopBranch}>
                 <BranchSelector />
               </div>

               {/* Acciones e iconos */}
               <div className={styles.actions}>
                <LanguageSwitcher />
                <Link href="/cart" className={styles.cartButton} aria-label={t('cart')} title={t('cart')}>
                    <ShoppingCart size={19} />
                    {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
                </Link>

                {isAuthenticated ? (
                    <>
                     <Link href="/account" className={styles.cartButton} aria-label={t('account')} title={t('account')}>
                        <UserIcon size={19} />
                     </Link>
                     {showDashboard && (
                        <Link href="/admin" className={styles.cartButton} aria-label={t('admin')} title={t('admin')}>
                            <LayoutDashboard size={19} />
                        </Link>
                     )}
                     <button
                        onClick={handleLogoutClick}
                        className={styles.logoutButton}
                        disabled={isLoading}
                        title={t('logout')}
                        aria-label={t('logout')}
                     >
                      <LogOut size={16} className={styles.logoutIcon} />
                      <span className={styles.logoutText}>{isLoading ? "..." : t('logout')}</span>
                     </button>
                    </>
                ):(
                   <button className={styles.loginButton} onClick={handleLoginClick} title={t('login')}>
                    {t('login')}
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