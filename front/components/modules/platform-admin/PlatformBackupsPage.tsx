'use client';

import React from 'react';
import PlatformBackupsSection from '@/components/modules/backups/PlatformBackupsSection';
import { usePlatformAdmin } from './PlatformAdminContext';

// Respaldos del SaaS: el mismo módulo de respaldos que ya existía, ahora en su propia sección del menú.
export default function PlatformBackupsPage() {
    const { token, tenants } = usePlatformAdmin();
    return <PlatformBackupsSection token={token} tenants={tenants} />;
}
