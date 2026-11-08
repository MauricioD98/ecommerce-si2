const LOCALES: Record<string, string> = { es: 'es-BO', en: 'en-US', fr: 'fr-FR', zh: 'zh-CN' };

/** Fecha y hora corta de una copia guardada, en el idioma de la app */
export function formatSavedAt(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString(LOCALES[language] ?? language, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
