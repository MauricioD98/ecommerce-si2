import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContactForm } from "@/components/modules/platform/ContactForm";
import { PLATFORM_BRAND } from "@/utils/storeName";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    const description = t("contactDescription");
    return {
        title: { absolute: t("contactTitle") },
        description,
        applicationName: PLATFORM_BRAND,
        openGraph: { siteName: PLATFORM_BRAND, title: t("contactTitle"), description },
    };
}

export default function ContactoPage() {
    return <ContactForm />;
}
