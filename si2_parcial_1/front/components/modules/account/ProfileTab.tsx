'use client';

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Info } from 'lucide-react';
import styles from './account.module.scss';
import { useAuth } from '@/hooks/useAuth';
import { authService } from '@/service/api/auth.service';
import { BranchService } from '@/service/api/branch.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Branch } from '@/types/branch.types';

const PHONE_REGEX = /^\+?[\d\s-]{7,20}$/;

// Pestaña 1: datos personales y sucursal favorita (la que se usa para sus notificaciones)
export default function ProfileTab() {
    const { user, refreshProfile } = useAuth();

    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [preferredBranchId, setPreferredBranchId] = useState('');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    // El formulario se llena una sola vez con el perfil; no se pisa lo que el usuario esté escribiendo
    const initialized = useRef(false);
    useEffect(() => {
        if (!user || initialized.current) return;
        initialized.current = true;
        setFirstName(user.firstName ?? '');
        setLastName(user.lastName ?? '');
        setPhone(user.phone ?? '');
        setPreferredBranchId(user.preferredBranchId ?? '');
    }, [user]);

    useEffect(() => {
        let active = true;
        BranchService.getActiveBranches()
            .then((data) => active && setBranches(data))
            .catch(() => active && setError('No se pudieron cargar las sucursales.'));
        return () => {
            active = false;
        };
    }, []);

    const phoneInvalid = phone.trim().length > 0 && !PHONE_REGEX.test(phone.trim());
    const canSubmit = firstName.trim().length > 0 && !phoneInvalid && !isSaving;

    const markDirty = () => setSaved(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        setIsSaving(true);
        setError(null);
        setSaved(false);
        try {
            await authService.updateProfile({
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                // Vacío = el backend lo guarda como null
                phone: phone.trim(),
                preferredBranchId: preferredBranchId || null,
            });
            await refreshProfile();
            setSaved(true);
        } catch (err) {
            setError(getApiErrorMessage(err, 'No se pudo guardar tu perfil. Inténtalo de nuevo.'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className={styles.card}>
            <h1 className={styles.heading}>Mi perfil</h1>
            <p className={styles.subheading}>Actualiza tus datos personales y elige tu sucursal favorita.</p>

            <form className={styles.form} onSubmit={handleSubmit} noValidate>
                {error && (
                    <div className={styles.alertError} role="alert">
                        <Info size={18} />
                        <span>{error}</span>
                    </div>
                )}
                {saved && (
                    <div className={styles.alertSuccess} role="status">
                        <Check size={18} />
                        <span>Tus datos se guardaron correctamente.</span>
                    </div>
                )}

                <div className={styles.row}>
                    <div className={styles.field}>
                        <label htmlFor="firstName">Nombre</label>
                        <input id="firstName" type="text" value={firstName} maxLength={60} required autoComplete="given-name" onChange={(e) => { setFirstName(e.target.value); markDirty(); }} />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="lastName">Apellido</label>
                        <input id="lastName" type="text" value={lastName} maxLength={60} autoComplete="family-name" onChange={(e) => { setLastName(e.target.value); markDirty(); }} />
                    </div>
                </div>

                <div className={styles.field}>
                    <label htmlFor="email">Correo electrónico</label>
                    <input id="email" type="email" value={user?.email ?? ''} disabled readOnly />
                    <span className={styles.hint}>El correo no se puede cambiar.</span>
                </div>

                <div className={styles.field}>
                    <label htmlFor="phone">Teléfono</label>
                    <input id="phone" type="tel" value={phone} maxLength={20} placeholder="+591 70000000" autoComplete="tel" aria-invalid={phoneInvalid} onChange={(e) => { setPhone(e.target.value); markDirty(); }} />
                    {phoneInvalid && <span className={styles.fieldError}>Ingresa un teléfono válido (7 a 20 dígitos).</span>}
                </div>

                <div className={styles.field}>
                    <label htmlFor="preferredBranch">Sucursal favorita</label>
                    <select id="preferredBranch" value={preferredBranchId} onChange={(e) => { setPreferredBranchId(e.target.value); markDirty(); }}>
                        <option value="">Sin sucursal favorita</option>
                        {branches.map((branch) => (
                            <option key={branch.id} value={branch.id}>
                                {branch.name}
                                {branch.address ? ` — ${branch.address}` : ''}
                            </option>
                        ))}
                    </select>
                    <span className={styles.hint}>Te avisaremos de las novedades y ofertas de esta sucursal.</span>
                </div>

                <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
                    {isSaving ? 'Guardando...' : 'Guardar cambios'}
                </button>
            </form>
        </div>
    );
}
