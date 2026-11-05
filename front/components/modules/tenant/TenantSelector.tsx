"use client";

import { FormEvent, useEffect, useState } from "react";
import { ChevronRight, Loader2, Store } from "lucide-react";
import { apiClient } from "@/service/api/axios.config";
import { authService, PublicTenant } from "@/service/api/auth.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { switchTenant } from "@/utils/tenant";
import styles from "./tenant-selector.module.scss";

interface ResolvedTenant {
    id: string;
    slug: string;
    name: string;
}

// Permite elegir cualquiera de las tiendas activas en 1 clic o ingresar su slug manualmente,
// y cambia de tienda (switchTenant recarga la página).
export function TenantSelector() {
    const [slug, setSlug] = useState("");
    const [tenants, setTenants] = useState<PublicTenant[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        authService
            .getPublicTenants()
            .then((list) => setTenants(list))
            .catch(() => undefined);
    }, []);

    const handlePickStore = async (tenantId: string) => {
        setLoading(true);
        setError(null);
        await switchTenant(tenantId);
    };

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const value = slug.trim().toLowerCase();
        if (!value) return;

        setLoading(true);
        setError(null);
        try {
            const { data } = await apiClient.get<{ data: ResolvedTenant }>(
                `/platform/tenants/resolve/${encodeURIComponent(value)}`
            );
            await switchTenant(data.data.id);
        } catch (err) {
            setError(getApiErrorMessage(err, "No encontramos una tienda con ese nombre."));
            setLoading(false);
        }
    };

    return (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="tenant-selector-title">
            <form className={styles.card} onSubmit={onSubmit}>
                <Store size={36} strokeWidth={1.75} />
                <h1 id="tenant-selector-title">¿En qué tienda quieres comprar?</h1>

                {tenants.length > 0 && (
                    <div className={styles.storeList}>
                        {tenants.map((tenant) => (
                            <button
                                key={tenant.id}
                                type="button"
                                className={styles.storeOption}
                                onClick={() => handlePickStore(tenant.id)}
                                disabled={loading}
                            >
                                <span className={styles.storeOptionInfo}>
                                    <span className={styles.storeOptionName}>{tenant.name}</span>
                                    <span className={styles.storeOptionSlug}>/{tenant.slug}</span>
                                </span>
                                <ChevronRight size={18} />
                            </button>
                        ))}
                    </div>
                )}

                <p>
                    {tenants.length > 0
                        ? "O escribe el nombre/identificador de otra tienda:"
                        : <>Escribe el nombre de la tienda tal como aparece en su enlace (por ejemplo, <code>mi-tienda</code>).</>}
                </p>

                <input
                    className={styles.input}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="nombre-de-la-tienda"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus={tenants.length === 0}
                    disabled={loading}
                />
                {error && <span className={styles.error}>{error}</span>}

                <button type="submit" className={styles.button} disabled={loading || !slug.trim()}>
                    {loading ? <Loader2 size={18} className={styles.spin} /> : "Continuar"}
                </button>
            </form>
        </div>
    );
}
