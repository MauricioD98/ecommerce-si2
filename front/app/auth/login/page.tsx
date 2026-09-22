import React, { Suspense } from 'react';
import LoginForm from '@/components/modules/auth/LoginForm';

export const revalidate = false;

export default function page() {
    return (
        <Suspense>
            <LoginForm />
        </Suspense>
    );
};

export function generateMetadata() {
    return {
        title: "Autenticación",
        description: "Autenticación de usuarios",
        icons:{
            icon: `path to asset file`
        }

    };
}
