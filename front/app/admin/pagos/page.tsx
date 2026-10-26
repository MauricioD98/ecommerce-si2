import { redirect } from "next/navigation";

// Ruta anterior de los cobros con tarjeta: ahora todo está en Gestión de pagos
export default async function AdminPaymentsLegacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
        if (typeof value === "string") params.set(key, value);
    }
    const query = params.toString();
    redirect(`/admin/settings/payments${query ? `?${query}` : ""}`);
}
