import AppearanceSettingsClient from "@/components/modules/appearance/AppearanceSettingsClient";

// Personalización de la tienda pública. El permiso MANAGE_APPEARANCE lo exige el backend; el menú
// solo muestra el ítem a quien lo tiene.
export default function AdminAppearancePage() {
    return <AppearanceSettingsClient />;
}
