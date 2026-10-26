import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlatformLanding } from "@/components/modules/platform/PlatformLanding";

// Landing de ventas del SaaS. Solo existe en los hosts de la plataforma: en el dominio propio de
// una tienda, front/proxy.ts responde 404 (el cliente final no debe ver el SaaS).
export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return { title: { absolute: t("plansTitle") }, description: t("plansDescription") };
}

// Next 16: searchParams llega como Promise
export default async function PlanesPage({ searchParams }: { searchParams: Promise<{ cancelado?: string }> }) {
    const { cancelado } = await searchParams;
    return <PlatformLanding cancelled={cancelado === "1"} />;
}
