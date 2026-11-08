'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, RefreshCw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './platform-admin.module.scss';
import LanguageSwitcher from '@/components/modules/i18n/LanguageSwitcher';
import PlatformLoginGate from './PlatformLoginGate';
import { type BackupOverview, type BranchOverview, PlatformAdminContext, type PlatformAdminState } from './PlatformAdminContext';
import { PLATFORM_BASE_PATH, PLATFORM_NAV, isNavItemActive } from './platformNav';
import {
    PlatformApiError,
    type PlatformMetrics,
    type PlatformSession,
    type PlatformTenant,
    platformAdminService,
    platformBackupService,
} from '@/service/api/platformAdmin.service';

// La sesión (token + email) vive solo en esta pestaña: se borra al cerrarla. No va a localStorage
// (persistiría en el equipo). Sobrevive a la recarga y a la navegación entre secciones.
const SESSION_STORAGE = 'sf_platform_session';

interface StoredSession {
    token: string;
    email: string;
}

const readStoredSession = (): StoredSession | null => {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(SESSION_STORAGE) ?? 'null');
        return typeof parsed?.token === 'string' && typeof parsed?.email === 'string' ? parsed : null;
    } catch {
        return null;
    }
};

// Esqueleto del panel del SaaS: login, cabecera (cuenta, idioma, salir), menú lateral en escritorio y
// menú desplegable en móvil. Las secciones (rutas hijas de /plataforma) leen la sesión y las tiendas del
// contexto. Ocultar una sección acá no da permisos: cada endpoint de /platform lo valida
// PlatformAdminGuard en la API.
export default function PlatformAdminShell({ children }: { children: React.ReactNode }) {
    const t = useTranslations('PlatformAdmin');
    const pathname = usePathname();

    const [hydrated, setHydrated] = useState(false);
    const [session, setSession] = useState<StoredSession | null>(null);
    const [gateError, setGateError] = useState<string | null>(null);
    const [tenants, setTenants] = useState<PlatformTenant[]>([]);
    const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [loadedAt, setLoadedAt] = useState<Date | null>(null);
    const [backupOverview, setBackupOverview] = useState<BackupOverview>({ status: 'idle' });
    // Generación del resumen de respaldos: "Actualizar" y "Salir" la incrementan, y una respuesta de una
    // generación anterior se descarta. backupInFlight evita dos pedidos simultáneos de la misma
    // generación (React en desarrollo ejecuta dos veces los efectos al montar Inicio).
    const backupGeneration = useRef(0);
    const backupInFlight = useRef<number | null>(null);
    const [branchOverview, setBranchOverview] = useState<BranchOverview>({ status: 'idle' });
    // Misma idea para sucursales; la clave en curso incluye el alcance ("<generación>:<scope>")
    const branchGeneration = useRef(0);
    const branchInFlight = useRef<string | null>(null);

    // sessionStorage solo existe en el navegador: se lee al montar (no durante el render del servidor)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSession(readStoredSession());
        setHydrated(true);
    }, []);
    const token = session?.token ?? '';

    const signOut = useCallback((reason?: string) => {
        try {
            sessionStorage.removeItem(SESSION_STORAGE);
        } catch {
            // sin storage: igual se olvida en memoria
        }
        setSession(null);
        setTenants([]);
        setMetrics(null);
        setError(null);
        setLoadedAt(null);
        backupGeneration.current += 1;
        setBackupOverview({ status: 'idle' });
        branchGeneration.current += 1;
        setBranchOverview({ status: 'idle' });
        setMenuOpen(false);
        setGateError(reason ?? null);
    }, []);

    const reportError = useCallback(
        (err: unknown, fallback: string) => {
            // Sesión vencida o cuenta desactivada: se vuelve a pedir el login
            if (err instanceof PlatformApiError && err.status === 401) {
                signOut(t('sessionExpired'));
                return;
            }
            setError(err instanceof Error && err.message ? err.message : fallback);
        },
        [signOut, t],
    );

    const load = useCallback(
        async (sessionToken: string) => {
            setIsLoading(true);
            setError(null);
            try {
                const [tenantList, metricData] = await Promise.all([
                    platformAdminService.getTenants(sessionToken),
                    platformAdminService.getMetrics(sessionToken),
                ]);
                setTenants(tenantList);
                setMetrics(metricData);
                setLoadedAt(new Date());
            } catch (err) {
                reportError(err, t('loadFailed'));
            } finally {
                setIsLoading(false);
            }
        },
        [reportError, t],
    );

    // Solo dos consultas al plano de control (public.config y public.backup_jobs): no recorre las tiendas
    const loadBackupOverview = useCallback(async () => {
        if (!token) return;
        const generation = backupGeneration.current;
        if (backupInFlight.current === generation) return;
        backupInFlight.current = generation;
        setBackupOverview({ status: 'loading' });
        try {
            const api = platformBackupService(token);
            const [config, jobs] = await Promise.all([api.config(), api.list()]);
            if (generation === backupGeneration.current) setBackupOverview({ status: 'ready', config, jobs });
        } catch (err) {
            if (generation !== backupGeneration.current) return;
            if (err instanceof PlatformApiError && err.status === 401) {
                signOut(t('sessionExpired'));
                return;
            }
            setBackupOverview({ status: 'error', message: err instanceof Error && err.message ? err.message : t('home.backups.loadFailed') });
        } finally {
            if (backupInFlight.current === generation) backupInFlight.current = null;
        }
    }, [token, signOut, t]);

    // Sucursales: el servidor consulta el schema de cada tienda, así que solo se pide al abrir la sección
    // (o con "Actualizar"), nunca en la carga general del panel
    const loadBranches = useCallback(
        async (scope: string) => {
            if (!token) return;
            const generation = branchGeneration.current;
            const key = `${generation}:${scope}`;
            if (branchInFlight.current === key) return;
            branchInFlight.current = key;
            setBranchOverview({ status: 'loading', scope });
            try {
                const data = await platformAdminService.getBranches(token, scope === 'all' ? undefined : scope);
                if (generation === branchGeneration.current && branchInFlight.current === key) setBranchOverview({ status: 'ready', scope, data });
            } catch (err) {
                if (generation !== branchGeneration.current || branchInFlight.current !== key) return;
                if (err instanceof PlatformApiError && err.status === 401) {
                    signOut(t('sessionExpired'));
                    return;
                }
                setBranchOverview({ status: 'error', scope, message: err instanceof Error && err.message ? err.message : t('branches.loadFailed') });
            } finally {
                if (branchInFlight.current === key) branchInFlight.current = null;
            }
        },
        [token, signOut, t],
    );

    // "Actualizar": vuelve a pedir tiendas y métricas, y marca el resumen de respaldos para pedirlo de
    // nuevo (Inicio lo pide si está abierto; en otra sección se pide al volver a Inicio)
    const refresh = useCallback(() => {
        backupGeneration.current += 1;
        setBackupOverview({ status: 'idle' });
        branchGeneration.current += 1;
        setBranchOverview({ status: 'idle' });
        return load(token);
    }, [load, token]);

    useEffect(() => {
        // Carga al iniciar sesión: los setState ocurren después del await dentro de load
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (token) load(token);
    }, [token, load]);

    // Menú móvil: Escape lo cierra
    useEffect(() => {
        if (!menuOpen) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [menuOpen]);

    const handleSignedIn = (next: PlatformSession) => {
        const stored = { token: next.accessToken, email: next.admin.email };
        try {
            sessionStorage.setItem(SESSION_STORAGE, JSON.stringify(stored));
        } catch {
            // sin storage: la sesión vive solo mientras la página esté abierta
        }
        setGateError(null);
        setSession(stored);
    };

    const value = useMemo<PlatformAdminState>(
        () => ({
            token,
            email: session?.email ?? '',
            tenants,
            metrics,
            isLoading,
            error,
            reload: () => load(token),
            reportError,
            loadedAt,
            backupOverview,
            loadBackupOverview,
            branchOverview,
            loadBranches,
        }),
        [token, session?.email, tenants, metrics, isLoading, error, load, reportError, loadedAt, backupOverview, loadBackupOverview, branchOverview, loadBranches],
    );

    // Antes de leer sessionStorage no se sabe si hay sesión: no se muestra el login para no parpadear
    if (!hydrated) return <div className={styles.shell} aria-busy="true" />;

    if (!session) return <PlatformLoginGate initialError={gateError} onSignedIn={handleSignedIn} />;

    const nav = (
        <nav aria-label={t('nav.label')} className={styles.nav}>
            <ul>
                {PLATFORM_NAV.map((item) => {
                    const active = isNavItemActive(item, pathname);
                    const Icon = item.icon;
                    return (
                        <li key={item.key}>
                            <Link
                                href={item.href}
                                className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
                                aria-current={active ? 'page' : undefined}
                                onClick={() => setMenuOpen(false)}
                            >
                                <Icon size={18} aria-hidden />
                                <span className={styles.navText}>{t(`nav.${item.key}`)}</span>
                                {!item.ready && <span className={styles.navPending}>{t('nav.pending')}</span>}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );

    return (
        <PlatformAdminContext.Provider value={value}>
            <div className={styles.shell}>
                <header className={styles.topbar}>
                    <div className={styles.topbarStart}>
                        <button
                            type="button"
                            className={styles.menuButton}
                            onClick={() => setMenuOpen((open) => !open)}
                            aria-expanded={menuOpen}
                            aria-controls="platform-nav-drawer"
                            aria-label={menuOpen ? t('nav.close') : t('nav.open')}
                        >
                            {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
                        </button>
                        <Link href="/plataforma" className={styles.brand}>
                            NovaSoft · {t('brandSuffix')}
                        </Link>
                    </div>
                    <div className={styles.topbarActions}>
                        <span className={styles.account} title={session.email}>
                            {session.email}
                        </span>
                        <LanguageSwitcher />
                        <button
                            type="button"
                            className={styles.topbarButton}
                            onClick={refresh}
                            disabled={isLoading}
                            aria-label={t('refresh')}
                        >
                            <RefreshCw size={16} className={isLoading ? styles.spin : ''} aria-hidden />
                            <span className={styles.topbarButtonText}>{t('refresh')}</span>
                        </button>
                        <button type="button" className={styles.topbarButton} onClick={() => signOut()} aria-label={t('signOut')}>
                            <LogOut size={16} aria-hidden />
                            <span className={styles.topbarButtonText}>{t('signOut')}</span>
                        </button>
                    </div>
                </header>

                <div className={styles.body}>
                    <aside className={styles.sidebar}>{nav}</aside>

                    {menuOpen && (
                        <>
                            <div className={styles.drawerBackdrop} onClick={() => setMenuOpen(false)} aria-hidden />
                            <aside id="platform-nav-drawer" className={styles.drawer}>
                                <p className={styles.drawerAccount}>{session.email}</p>
                                {nav}
                            </aside>
                        </>
                    )}

                    <main className={styles.content}>
                        {/* En Inicio, un fallo de carga sin datos previos lo muestra la propia pantalla (con reintentar) */}
                        {error && !(pathname === PLATFORM_BASE_PATH && !metrics) && (
                            <div className={styles.errorBanner} role="alert">
                                {error}
                            </div>
                        )}
                        {children}
                    </main>
                </div>
            </div>
        </PlatformAdminContext.Provider>
    );
}
