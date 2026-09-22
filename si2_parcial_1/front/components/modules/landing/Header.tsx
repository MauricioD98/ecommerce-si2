'use client';

import React, { useEffect } from 'react';
import styles from "./header.module.scss";
import Link from 'next/link';
import { LayoutDashboard, ShoppingCart, User as UserIcon } from "lucide-react";
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

            {/*corntainer*/}
            <div className={styles.containers}>
               {/* logo */}
               <Link href="/" className={styles.logo}>
                STELLA FEMME
               </Link>
               {/*icons */}
               <div className={styles.actions}>
                <BranchSelector />
                <Link href="/cart" className={styles.cartButton}>
                    <ShoppingCart size={20} />
                    {totalItems > 0 && <span className={styles.badge}>{totalItems}</span>}
                </Link>
                {isAuthenticated ? (
                    <>
                     <Link href="/account" className={styles.cartButton} aria-label="Mi cuenta" title="Mi cuenta">
                        <UserIcon size={20} />
                     </Link>
                     {showDashboard && (
                        <Link href="/admin" className={styles.cartButton} aria-label="Panel administrativo" title="Panel administrativo">
                            <LayoutDashboard size={20} />
                        </Link>
                     )}
                     <button
                        onClick={handleLogoutClick}
                        className={styles.logoutButton}
                        disabled={isLoading}
                     >
                      {isLoading? "Cerrando sesión...":"Cerrar sesión"}
                     </button>
                    </>
                ):(
                   <button className={styles.loginButton} onClick={handleLoginClick}>
                    Iniciar sesión
                   </button>
                )}
               </div>
            </div>
        </header>
    );
};