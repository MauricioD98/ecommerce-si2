'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CaseSensitive, FileText, ImagePlus, Palette, PanelLeft, PanelTop, Plus, RotateCcw, Share2, Trash2, Upload, Wallpaper } from 'lucide-react';
import { useTranslations } from 'next-intl';
import table from '../admin/admin-table.module.scss';
import styles from './appearance.module.scss';
import AppearancePreview from './AppearancePreview';
import { SOCIAL_ICONS, SOCIAL_PLACEHOLDERS } from './socialIcons';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { APPEARANCE_IMAGE_LIMITS, AppearanceImageKind, appearanceService } from '@/service/api/appearance.service';
import {
    DEFAULT_APPEARANCE,
    FONT_FAMILIES,
    FontFamily,
    SOCIAL_PLATFORMS,
    SocialLink,
    SocialPlatform,
    StoreAppearance,
    StoreAppearanceUpdate,
} from '@/types/appearance.types';
import { getStoreFontClass } from '@/utils/fonts';
import { useStoreName } from '@/providers/StoreInfoProvider';
import { getCurrentTenantId } from '@/utils/tenant';
import { refreshStoreAppearance } from '@/app/admin/settings/appearance/actions';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const DESCRIPTION_MAX = 2000;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Combinaciones listas para probar con un clic (fondo del botón / texto del botón)
const PRESETS: { key: 'classic' | 'rose' | 'terracotta' | 'olive' | 'ocean' | 'cream'; primary: string; secondary: string }[] = [
    { key: 'classic', primary: '#000000', secondary: '#ffffff' },
    { key: 'rose', primary: '#be185d', secondary: '#ffffff' },
    { key: 'terracotta', primary: '#c2410c', secondary: '#fff7ed' },
    { key: 'olive', primary: '#4d7c0f', secondary: '#f7fee7' },
    { key: 'ocean', primary: '#1d4ed8', secondary: '#ffffff' },
    { key: 'cream', primary: '#f5e6d3', secondary: '#3f2a1d' },
];

type Feedback = { type: 'success' | 'error'; text: string } | null;

// Lo que se edita en el formulario. Las imágenes nuevas quedan como File hasta guardar.
interface Draft {
    primaryColor: string;
    secondaryColor: string;
    description: string;
    socialLinks: SocialLink[];
    logoUrl: string | null;
    faviconUrl: string | null;
    fontFamily: FontFamily;
    navbarBackgroundColor: string;
    navbarTextColor: string;
    searchBarBackgroundColor: string;
    storeBackgroundColor: string;
    storeBackgroundImage: string | null;
    adminMenuColor: string;
}

const toDraft = (a: StoreAppearance): Draft => ({
    primaryColor: a.primaryColor,
    secondaryColor: a.secondaryColor,
    description: a.description ?? '',
    socialLinks: a.socialLinks ?? [],
    logoUrl: a.logoUrl,
    faviconUrl: a.faviconUrl,
    // Una tienda con un valor viejo fuera del catálogo arranca en el default
    fontFamily: FONT_FAMILIES.includes(a.fontFamily) ? a.fontFamily : DEFAULT_APPEARANCE.fontFamily,
    navbarBackgroundColor: a.navbarBackgroundColor,
    navbarTextColor: a.navbarTextColor,
    searchBarBackgroundColor: a.searchBarBackgroundColor,
    storeBackgroundColor: a.storeBackgroundColor,
    storeBackgroundImage: a.storeBackgroundImage,
    adminMenuColor: a.adminMenuColor,
});

// Campo de la apariencia que guarda cada imagen subida
const IMAGE_FIELD = { logo: 'logoUrl', favicon: 'faviconUrl', background: 'storeBackgroundImage' } as const;
const IMAGE_KINDS = ['logo', 'favicon', 'background'] as const;

// Contraste WCAG entre el fondo y el texto del botón de compra (< 3 cuesta leerlo)
const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastRatio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const isHttpUrl = (value: string) => {
    try {
        const url = new URL(value.trim());
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
};

// Personalización de la tienda pública: pantalla dividida con el formulario a la izquierda y una
// vista previa en vivo a la derecha. Nada llega a la tienda hasta "Guardar cambios".
export default function AppearanceSettingsClient() {
    const t = useTranslations('AdminAppearance');
    const router = useRouter();
    const storeName = useStoreName();

    const [saved, setSaved] = useState<StoreAppearance | null>(null);
    const [draft, setDraft] = useState<Draft>(toDraft(DEFAULT_APPEARANCE));
    const [files, setFiles] = useState<Partial<Record<AppearanceImageKind, File>>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await appearanceService.get();
            setSaved(data);
            setDraft(toDraft(data));
            setFiles({});
            setLoadError(null);
        } catch (err) {
            setLoadError(getApiErrorMessage(err, t('loadFailed')));
        } finally {
            setIsLoading(false);
        }
        // t solo cambia con el idioma
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // Carga inicial: el setState ocurre después del await dentro de load, no de forma síncrona
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
    }, [load]);

    // Vista previa local de las imágenes elegidas (todavía sin subir); se liberan al cambiar o desmontar
    const logoPreview = useObjectUrl(files.logo);
    const faviconPreview = useObjectUrl(files.favicon);
    const backgroundPreview = useObjectUrl(files.background);
    const logoSrc = logoPreview ?? draft.logoUrl;
    const faviconSrc = faviconPreview ?? draft.faviconUrl;
    const backgroundSrc = backgroundPreview ?? draft.storeBackgroundImage;

    const dirty = useMemo(
        () => Boolean(saved && (IMAGE_KINDS.some((kind) => files[kind]) || JSON.stringify(draft) !== JSON.stringify(toDraft(saved)))),
        [draft, files, saved],
    );

    // Avisar antes de salir con cambios sin guardar
    useEffect(() => {
        if (!dirty) return;
        const warn = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const patch = (changes: Partial<Draft>) => {
        setDraft((current) => ({ ...current, ...changes }));
        setFeedback(null);
    };

    const pickImage = (kind: AppearanceImageKind, file?: File) => {
        if (!file) return;
        if (!IMAGE_TYPES.includes(file.type)) return setFeedback({ type: 'error', text: t('images.invalidType') });
        if (file.size > APPEARANCE_IMAGE_LIMITS[kind]) {
            return setFeedback({ type: 'error', text: t('images.tooLarge', { max: APPEARANCE_IMAGE_LIMITS[kind] / 1024 }) });
        }
        setFiles((current) => ({ ...current, [kind]: file }));
        setFeedback(null);
    };

    const removeImage = (kind: AppearanceImageKind) => {
        setFiles((current) => ({ ...current, [kind]: undefined }));
        patch({ [IMAGE_FIELD[kind]]: null });
    };

    const invalidLinks = draft.socialLinks.some((link) => link.url.trim() && !isHttpUrl(link.url));
    const colorsValid = HEX_COLOR.test(draft.primaryColor) && HEX_COLOR.test(draft.secondaryColor);
    const lowContrast = colorsValid && contrastRatio(draft.primaryColor, draft.secondaryColor) < 3;
    const lowNavbarContrast = contrastRatio(draft.navbarBackgroundColor, draft.navbarTextColor) < 3;

    // Lo que muestra la vista previa: el borrador tal cual (los ColorField solo propagan #rrggbb válidos)
    const previewAppearance: StoreAppearance = draft;

    const save = async () => {
        if (!saved) return;
        setBusy(true);
        setFeedback(null);
        try {
            // 1. Imágenes nuevas (multipart, validadas por el backend por sus bytes)
            for (const kind of IMAGE_KINDS) {
                const file = files[kind];
                if (file) await appearanceService.uploadImage(kind, file);
            }
            // 2. El resto, solo lo que cambió. Las imágenes quitadas viajan como null.
            const update: StoreAppearanceUpdate = {
                primaryColor: draft.primaryColor,
                secondaryColor: draft.secondaryColor,
                navbarBackgroundColor: draft.navbarBackgroundColor,
                navbarTextColor: draft.navbarTextColor,
                searchBarBackgroundColor: draft.searchBarBackgroundColor,
                storeBackgroundColor: draft.storeBackgroundColor,
                adminMenuColor: draft.adminMenuColor,
                fontFamily: draft.fontFamily,
                description: draft.description,
                socialLinks: draft.socialLinks
                    .map((link) => ({ ...link, url: link.url.trim() }))
                    .filter((link) => link.url),
            };
            if (!files.logo && saved.logoUrl && !draft.logoUrl) update.logoUrl = null;
            if (!files.favicon && saved.faviconUrl && !draft.faviconUrl) update.faviconUrl = null;
            if (!files.background && saved.storeBackgroundImage && !draft.storeBackgroundImage) update.storeBackgroundImage = null;
            const fresh = await appearanceService.update(update);

            setSaved(fresh);
            setDraft(toDraft(fresh));
            setFiles({});
            setFeedback({ type: 'success', text: t('saved') });

            // La tienda (y este mismo panel) leen la apariencia cacheada en el servidor: se expira y se
            // vuelve a pedir el layout para que el cambio se vea ya
            const tenantId = getCurrentTenantId();
            if (tenantId) await refreshStoreAppearance(tenantId).catch(() => undefined);
            router.refresh();
        } catch (err) {
            setFeedback({ type: 'error', text: getApiErrorMessage(err, t('saveFailed')) });
        } finally {
            setBusy(false);
        }
    };

    const discard = () => {
        if (!saved) return;
        setDraft(toDraft(saved));
        setFiles({});
        setFeedback(null);
    };

    return (
        <div className={table.page}>
            <div className={table.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
            </div>

            {loadError && <div className={table.errorMessage}>{loadError}</div>}

            {isLoading && !saved ? (
                <div className={table.loadingState}>{t('loading')}</div>
            ) : (
                saved && (
                    <div className={styles.split}>
                        {/* Columna izquierda: controles */}
                        <div className={styles.controls}>
                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-images">
                                <h2 id="ap-images" className={styles.sectionTitle}><ImagePlus size={18} />{t('images.title')}</h2>
                                <ImageField
                                    id="ap-logo"
                                    label={t('images.logo')}
                                    hint={t('images.logoHint', { max: APPEARANCE_IMAGE_LIMITS.logo / 1024 })}
                                    src={logoSrc}
                                    pending={Boolean(files.logo)}
                                    disabled={busy}
                                    onPick={(file) => pickImage('logo', file)}
                                    onRemove={() => removeImage('logo')}
                                />
                                <ImageField
                                    id="ap-favicon"
                                    label={t('images.favicon')}
                                    hint={t('images.faviconHint', { max: APPEARANCE_IMAGE_LIMITS.favicon / 1024 })}
                                    src={faviconSrc}
                                    pending={Boolean(files.favicon)}
                                    disabled={busy}
                                    small
                                    onPick={(file) => pickImage('favicon', file)}
                                    onRemove={() => removeImage('favicon')}
                                />
                            </section>

                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-font">
                                <h2 id="ap-font" className={styles.sectionTitle}><CaseSensitive size={18} />{t('font.title')}</h2>
                                <div className={table.field}>
                                    <label htmlFor="ap-font-select">{t('font.label')}</label>
                                    <select
                                        id="ap-font-select"
                                        className={table.input}
                                        value={draft.fontFamily}
                                        onChange={(e) => patch({ fontFamily: e.target.value as FontFamily })}
                                    >
                                        {FONT_FAMILIES.map((font) => (
                                            <option key={font} value={font}>{font}</option>
                                        ))}
                                    </select>
                                    <small>{t('font.hint')}</small>
                                </div>
                                <div className={`${styles.fontSample} ${getStoreFontClass(draft.fontFamily)}`} aria-hidden>
                                    <strong>{storeName}</strong>
                                    <span>{t('font.sample')}</span>
                                </div>
                            </section>

                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-colors">
                                <h2 id="ap-colors" className={styles.sectionTitle}><Palette size={18} />{t('colors.title')}</h2>
                                <div className={styles.colorGrid}>
                                    <ColorField
                                        id="ap-primary"
                                        label={t('colors.primary')}
                                        hint={t('colors.primaryHint')}
                                        value={draft.primaryColor}
                                        onChange={(primaryColor) => patch({ primaryColor })}
                                    />
                                    <ColorField
                                        id="ap-secondary"
                                        label={t('colors.secondary')}
                                        hint={t('colors.secondaryHint')}
                                        value={draft.secondaryColor}
                                        onChange={(secondaryColor) => patch({ secondaryColor })}
                                    />
                                </div>
                                {lowContrast && (
                                    <p className={styles.warning}><AlertTriangle size={15} />{t('colors.lowContrast')}</p>
                                )}
                                <div>
                                    <span className={table.statLabel}>{t('colors.presets')}</span>
                                    <div className={styles.presets}>
                                        {PRESETS.map((preset) => {
                                            const active = draft.primaryColor === preset.primary && draft.secondaryColor === preset.secondary;
                                            return (
                                                <button
                                                    key={preset.key}
                                                    type="button"
                                                    className={`${styles.preset} ${active ? styles.presetActive : ''}`}
                                                    onClick={() => patch({ primaryColor: preset.primary, secondaryColor: preset.secondary })}
                                                    aria-pressed={active}
                                                    title={t(`colors.presetNames.${preset.key}`)}
                                                >
                                                    <span style={{ background: preset.primary, color: preset.secondary }}>Aa</span>
                                                    {t(`colors.presetNames.${preset.key}`)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>

                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-navbar">
                                <h2 id="ap-navbar" className={styles.sectionTitle}><PanelTop size={18} />{t('navbar.title')}</h2>
                                <div className={styles.colorGrid}>
                                    <ColorField
                                        id="ap-navbar-bg"
                                        label={t('navbar.background')}
                                        hint={t('navbar.backgroundHint')}
                                        value={draft.navbarBackgroundColor}
                                        onChange={(navbarBackgroundColor) => patch({ navbarBackgroundColor })}
                                    />
                                    <ColorField
                                        id="ap-navbar-text"
                                        label={t('navbar.text')}
                                        hint={t('navbar.textHint')}
                                        value={draft.navbarTextColor}
                                        onChange={(navbarTextColor) => patch({ navbarTextColor })}
                                    />
                                    <ColorField
                                        id="ap-search-bg"
                                        label={t('navbar.search')}
                                        hint={t('navbar.searchHint')}
                                        value={draft.searchBarBackgroundColor}
                                        onChange={(searchBarBackgroundColor) => patch({ searchBarBackgroundColor })}
                                    />
                                </div>
                                {lowNavbarContrast && (
                                    <p className={styles.warning}><AlertTriangle size={15} />{t('navbar.lowContrast')}</p>
                                )}
                            </section>

                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-background">
                                <h2 id="ap-background" className={styles.sectionTitle}><Wallpaper size={18} />{t('background.title')}</h2>
                                <ColorField
                                    id="ap-store-bg"
                                    label={t('background.color')}
                                    hint={t('background.colorHint')}
                                    value={draft.storeBackgroundColor}
                                    onChange={(storeBackgroundColor) => patch({ storeBackgroundColor })}
                                />
                                <ImageField
                                    id="ap-store-bg-image"
                                    label={t('background.image')}
                                    hint={t('background.imageHint', { max: APPEARANCE_IMAGE_LIMITS.background / 1024 })}
                                    src={backgroundSrc}
                                    pending={Boolean(files.background)}
                                    disabled={busy}
                                    wide
                                    onPick={(file) => pickImage('background', file)}
                                    onRemove={() => removeImage('background')}
                                />
                            </section>

                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-admin">
                                <h2 id="ap-admin" className={styles.sectionTitle}><PanelLeft size={18} />{t('admin.title')}</h2>
                                <ColorField
                                    id="ap-admin-menu"
                                    label={t('admin.menu')}
                                    hint={t('admin.menuHint')}
                                    value={draft.adminMenuColor}
                                    onChange={(adminMenuColor) => patch({ adminMenuColor })}
                                />
                            </section>

                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-description">
                                <h2 id="ap-description" className={styles.sectionTitle}><FileText size={18} />{t('description.title')}</h2>
                                <div className={table.field}>
                                    <label htmlFor="ap-description-input">{t('description.label')}</label>
                                    <textarea
                                        id="ap-description-input"
                                        className={`${table.input} ${table.textareaSmall}`}
                                        value={draft.description}
                                        maxLength={DESCRIPTION_MAX}
                                        rows={5}
                                        placeholder={t('description.placeholder')}
                                        onChange={(e) => patch({ description: e.target.value })}
                                    />
                                    <small className={styles.counter}>
                                        {t('description.hint')} · {draft.description.length}/{DESCRIPTION_MAX}
                                    </small>
                                </div>
                            </section>

                            <section className={`${table.tableCard} ${table.form} ${table.formCard}`} aria-labelledby="ap-social">
                                <h2 id="ap-social" className={styles.sectionTitle}><Share2 size={18} />{t('social.title')}</h2>
                                <SocialLinksField links={draft.socialLinks} onChange={(socialLinks) => patch({ socialLinks })} />
                            </section>
                        </div>

                        {/* Columna derecha: vista previa en vivo (estado local, antes de guardar) */}
                        <aside className={styles.previewColumn} aria-labelledby="ap-preview">
                            <div className={styles.previewSticky}>
                                <div className={styles.previewHeading}>
                                    <h2 id="ap-preview" className={styles.sectionTitle}>{t('preview.title')}</h2>
                                    <span className={`${table.badge} ${dirty ? table.badgeWarning : table.badgeSuccess}`}>
                                        {dirty ? t('unsaved') : t('upToDate')}
                                    </span>
                                </div>
                                <AppearancePreview
                                    storeName={storeName}
                                    appearance={previewAppearance}
                                    logoSrc={logoSrc}
                                    backgroundSrc={backgroundSrc}
                                />

                                {feedback && (
                                    <div className={feedback.type === 'success' ? table.successMessage : table.errorMessage}>{feedback.text}</div>
                                )}
                                {invalidLinks && <div className={table.errorMessage}>{t('social.invalidUrl')}</div>}

                                <div className={styles.actions}>
                                    <button type="button" className={table.buttonSecondary} onClick={discard} disabled={busy || !dirty}>
                                        <RotateCcw size={16} />
                                        {t('discard')}
                                    </button>
                                    <button
                                        type="button"
                                        className={table.button}
                                        onClick={save}
                                        disabled={busy || !dirty || invalidLinks || !colorsValid}
                                    >
                                        {busy ? t('saving') : t('save')}
                                    </button>
                                </div>
                            </div>
                        </aside>
                    </div>
                )
            )}
        </div>
    );
}

function useObjectUrl(file?: File): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!file) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- se limpia al quitar el archivo
            setUrl(null);
            return;
        }
        const next = URL.createObjectURL(file);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [file]);
    return url;
}

function ImageField({
    id,
    label,
    hint,
    src,
    pending,
    disabled,
    small,
    wide,
    onPick,
    onRemove,
}: {
    id: string;
    label: string;
    hint: string;
    src: string | null;
    pending: boolean;
    disabled: boolean;
    small?: boolean;
    wide?: boolean;
    onPick: (file?: File) => void;
    onRemove: () => void;
}) {
    const t = useTranslations('AdminAppearance.images');
    const input = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    return (
        <div className={styles.imageField}>
            <button
                type="button"
                className={`${styles.dropzone} ${small ? styles.dropzoneSmall : ''} ${wide ? styles.dropzoneWide : ''} ${dragging ? styles.dropzoneActive : ''}`}
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    onPick(e.dataTransfer.files?.[0]);
                }}
                disabled={disabled}
                aria-describedby={`${id}-hint`}
                aria-label={src ? t('replace', { name: label }) : t('upload', { name: label })}
            >
                {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- object URL / data URL local, no pasa por next/image
                    <img src={src} alt="" />
                ) : (
                    <Upload size={small ? 18 : 22} />
                )}
            </button>
            <div className={styles.imageMeta}>
                <strong>{label}</strong>
                <small id={`${id}-hint`}>{hint}</small>
                {pending && <span className={styles.pendingTag}>{t('pending')}</span>}
                <div className={styles.imageButtons}>
                    <input
                        ref={input}
                        id={id}
                        type="file"
                        accept={IMAGE_TYPES.join(',')}
                        hidden
                        onChange={(e) => {
                            onPick(e.target.files?.[0]);
                            e.target.value = '';
                        }}
                    />
                    <button type="button" className={table.buttonSecondary} onClick={() => input.current?.click()} disabled={disabled}>
                        <Upload size={15} />
                        {src ? t('replaceShort') : t('uploadShort')}
                    </button>
                    {src && (
                        <button type="button" className={table.buttonDanger} onClick={onRemove} disabled={disabled}>
                            <Trash2 size={15} />
                            {t('remove')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function ColorField({
    id,
    label,
    hint,
    value,
    onChange,
}: {
    id: string;
    label: string;
    hint: string;
    value: string;
    onChange: (value: string) => void;
}) {
    // El texto se edita libre y solo se propaga cuando es un #rrggbb completo
    const [text, setText] = useState(value);
    const [lastValue, setLastValue] = useState(value);
    if (value !== lastValue) {
        setLastValue(value);
        setText(value);
    }

    return (
        <div className={table.field}>
            <label htmlFor={id}>{label}</label>
            <div className={styles.colorRow}>
                <input
                    id={id}
                    type="color"
                    className={styles.colorSwatch}
                    value={HEX_COLOR.test(value) ? value : '#000000'}
                    onChange={(e) => onChange(e.target.value)}
                />
                <input
                    className={`${table.input} ${styles.hexInput}`}
                    value={text}
                    maxLength={7}
                    spellCheck={false}
                    aria-label={`${label} (hex)`}
                    aria-invalid={!HEX_COLOR.test(text)}
                    onChange={(e) => {
                        const next = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                        setText(next);
                        if (HEX_COLOR.test(next)) onChange(next.toLowerCase());
                    }}
                />
            </div>
            <small>{hint}</small>
        </div>
    );
}

function SocialLinksField({ links, onChange }: { links: SocialLink[]; onChange: (links: SocialLink[]) => void }) {
    const t = useTranslations('AdminAppearance.social');
    const used = new Set(links.map((link) => link.platform));
    const nextPlatform = SOCIAL_PLATFORMS.find((p) => !used.has(p)) ?? 'website';

    const update = (index: number, changes: Partial<SocialLink>) =>
        onChange(links.map((link, i) => (i === index ? { ...link, ...changes } : link)));

    return (
        <>
            <p className={table.cellSub}>{t('description')}</p>
            {links.length === 0 && <div className={styles.emptyLinks}>{t('empty')}</div>}
            <ul className={styles.linkList}>
                {links.map((link, index) => {
                    const Icon = SOCIAL_ICONS[link.platform];
                    const invalid = Boolean(link.url.trim()) && !isHttpUrl(link.url);
                    return (
                        <li key={index} className={styles.linkRow}>
                            <span className={styles.linkIcon} aria-hidden><Icon size={16} /></span>
                            <select
                                className={`${table.input} ${styles.linkPlatform}`}
                                value={link.platform}
                                aria-label={t('platform')}
                                onChange={(e) => update(index, { platform: e.target.value as SocialPlatform })}
                            >
                                {SOCIAL_PLATFORMS.map((platform) => (
                                    <option key={platform} value={platform}>{t(`platforms.${platform}`)}</option>
                                ))}
                            </select>
                            <input
                                className={table.input}
                                type="url"
                                inputMode="url"
                                value={link.url}
                                maxLength={500}
                                placeholder={SOCIAL_PLACEHOLDERS[link.platform]}
                                aria-label={t('url')}
                                aria-invalid={invalid}
                                onChange={(e) => update(index, { url: e.target.value })}
                            />
                            <button
                                type="button"
                                className={styles.iconButton}
                                onClick={() => onChange(links.filter((_, i) => i !== index))}
                                aria-label={t('remove')}
                                title={t('remove')}
                            >
                                <Trash2 size={16} />
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div>
                <button
                    type="button"
                    className={table.buttonSecondary}
                    onClick={() => onChange([...links, { platform: nextPlatform, url: '' }])}
                    disabled={links.length >= SOCIAL_PLATFORMS.length * 2}
                >
                    <Plus size={16} />
                    {t('add')}
                </button>
            </div>
        </>
    );
}
