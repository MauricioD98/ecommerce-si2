import React from 'react';
import ForgotPasswordForm from '@/components/modules/auth/ForgotPasswordForm';

export const revalidate = false;

export default function page() {
    return <ForgotPasswordForm />;
};

export function generateMetadata() {
    return {
        title: "Recuperar contraseña",
        description: "Restablece tu contraseña",
    };
}
