import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { appStorage } from '../utils/storage';
import es from './locales/es.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';

// Idiomas de la app. Mismos que el front (front/i18n/config.ts) y que la API (nestjs-i18n).
export const LANGUAGES = ['es', 'en', 'fr', 'zh'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'es';

// Cada idioma escrito en sí mismo: lo reconoce quien no entiende el idioma actual de la app
export const LANGUAGE_LABELS: Record<Language, string> = {
  es: 'Español',
  en: 'English',
  fr: 'Français',
  zh: '中文',
};

const LANGUAGE_KEY = '@language';

export function isLanguage(value: string | null | undefined): value is Language {
  return !!value && (LANGUAGES as readonly string[]).includes(value);
}

// Primer idioma soportado de la lista del sistema (el usuario puede tener varios configurados).
// languageCode ya viene sin región: "fr" para fr-CA, "zh" para zh-Hans-CN.
function deviceLanguage(): Language {
  try {
    const match = getLocales()
      .map((locale) => locale.languageCode?.toLowerCase())
      .find(isLanguage);
    return match ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Arranca i18next con el idioma del dispositivo y, si el usuario eligió otro en Perfil, lo aplica.
 * App.tsx espera esta promesa antes de renderizar para que no se vea un parpadeo de idioma.
 */
export async function initI18n(): Promise<void> {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        es: { translation: es },
        en: { translation: en },
        fr: { translation: fr },
        zh: { translation: zh },
      },
      lng: deviceLanguage(),
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...LANGUAGES],
      interpolation: { escapeValue: false }, // React ya escapa
      returnNull: false,
    });
  }

  const saved = await appStorage.getItem(LANGUAGE_KEY);
  if (isLanguage(saved) && saved !== i18n.language) {
    await i18n.changeLanguage(saved);
  }
}

/** Cambia el idioma en caliente (react-i18next re-renderiza) y lo recuerda en AsyncStorage. */
export async function changeLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  await appStorage.setItem(LANGUAGE_KEY, language);
}

/** Idioma activo, para el header Accept-Language de la API (src/api/client.ts). */
export function getCurrentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

export default i18n;
