import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import type { TenantStatus } from '@/service/api/platformAdmin.service';

// Presentación compartida por la lista y el detalle de tiendas del panel del SaaS

export const TENANT_STATUSES: TenantStatus[] = ['ACTIVE', 'SUSPENDED', 'PROVISIONING', 'FAILED'];

export const STATUS_BADGE: Record<TenantStatus, string> = {
    ACTIVE: tableStyles.badgeSuccess,
    SUSPENDED: tableStyles.badgeDanger,
    PROVISIONING: tableStyles.badgeInfo,
    FAILED: tableStyles.badgeWarning,
};

export const SUBSCRIPTION_BADGE: Record<string, string> = {
    active: tableStyles.badgeSuccess,
    trialing: tableStyles.badgeInfo,
    past_due: tableStyles.badgeWarning,
    incomplete: tableStyles.badgeWarning,
    unpaid: tableStyles.badgeDanger,
    canceled: tableStyles.badgeDanger,
    incomplete_expired: tableStyles.badgeDanger,
    paused: tableStyles.badgeMuted,
};

export const KNOWN_SUBSCRIPTION_STATUSES = Object.keys(SUBSCRIPTION_BADGE) as (
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'incomplete'
    | 'unpaid'
    | 'canceled'
    | 'incomplete_expired'
    | 'paused'
)[];

/**
 * Estados de Stripe con los que el webhook suspende la tienda (api: SUSPENDING_STATUSES en
 * subscriptions.service.ts). Si se reactiva a mano una tienda en uno de estos estados, el próximo
 * evento de Stripe puede volver a suspenderla.
 */
export const SUSPENDING_SUBSCRIPTION_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);

export const PLAN_BADGE: Record<string, string> = {
    starter: tableStyles.badgeInfo,
    growth: tableStyles.badgeSuccess,
    pro: tableStyles.badgeWarning,
};

/** Nombres comerciales (iguales en todos los idiomas); free y legacy se traducen */
export const PLAN_NAMES: Record<string, string> = { starter: 'Starter', growth: 'Growth', pro: 'Pro' };

export const normalizePlan = (plan: string | null | undefined) => (plan ?? '').trim().toLowerCase();
