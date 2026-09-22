import React, { Suspense } from 'react';
import RegisterForm from '@/components/modules/auth/RegisterForm';

export const revalidate = false;

export default function page() {
    return (
        <Suspense>
            <RegisterForm />
        </Suspense>
    );
};

export function generateMetadata() {
    return {
        title: "Crear cuenta",
        description: "Registro de nuevos usuarios",
    };
}
