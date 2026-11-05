import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SignupSuccessClient from "@/components/modules/platform/SignupSuccessClient";
import { PLATFORM_BRAND } from "@/utils/storeName";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    const description = t("signupDescription");
    return {
        title: { absolute: t("signupTitle") },
        description,
        applicationName: PLATFORM_BRAND,
        openGraph: { siteName: PLATFORM_BRAND, title: t("signupTitle"), description },
        robots: { index: false },
    };
}

// Suspense: SignupSuccessClient usa useSearchParams (session_id que agrega Stripe a la success_url)
export default function PlanesExitoPage() {
    return (
        <Suspense fallback={null}>
            <SignupSuccessClient />
        </Suspense>
    );
}
