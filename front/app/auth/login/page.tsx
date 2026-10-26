import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("loginTitle"),
        description: t("loginDescription"),
    };
}
