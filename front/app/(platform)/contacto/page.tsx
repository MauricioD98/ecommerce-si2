import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContactForm } from "@/components/modules/platform/ContactForm";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return { title: { absolute: t("contactTitle") }, description: t("contactDescription") };
}

export default function ContactoPage() {
    return <ContactForm />;
}
