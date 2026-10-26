import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import React from 'react';
import ForgotPasswordForm from '@/components/modules/auth/ForgotPasswordForm';

export const revalidate = false;

export default function page() {
    return <ForgotPasswordForm />;
};

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("forgotTitle"),
        description: t("forgotDescription"),
    };
}
