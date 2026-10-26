import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("registerTitle"),
        description: t("registerDescription"),
    };
}
