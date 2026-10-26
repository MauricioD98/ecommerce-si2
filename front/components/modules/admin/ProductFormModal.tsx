'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { PLACEHOLDER_IMAGE } from '@/service/api/product.service';
import { CategoryOption, ProductPayload } from '@/types/admin.types';
import { Product, ProductTranslationLanguage, ProductTranslations } from '@/types/product.types';
import { Branch } from '@/types/branch.types';
import { CollectionOption } from '@/types/collection.types';

// Mismas tallas que acepta el backend (enum WomenSize)
const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

// Idiomas a los que se traduce el catálogo (etiqueta: AdminProducts.form.languages.<código>).
// El español es el Nombre/Descripción de arriba.
const TRANSLATION_LANGUAGES: ProductTranslationLanguage[] = ['en', 'fr', 'zh'];

interface ProductFormModalProps {
    product?: Product;
    categories: CategoryOption[];
    collections: CollectionOption[];
    // Exclusividad de sucursal: sin alcance global el campo queda bloqueado en la propia (el
    // backend la fuerza igual del lado del servidor); con alcance global se puede elegir cualquiera
    // o dejarlo global.
    isGlobal: boolean;
    ownBranchName?: string;
    branches: Branch[];
    onClose: () => void;
    onSubmit: (payload: ProductPayload) => Promise<void>;
}

export default function ProductFormModal({ product, categories, collections, isGlobal, ownBranchName, branches, onClose, onSubmit }: ProductFormModalProps) {
    const t = useTranslations('AdminProducts');
    const tc = useTranslations('AdminCommon');
    // base*: el texto en español sin traducir. product.name ya viene en el idioma de quien navega y,
    // si se usara acá, guardar pisaría el español con ese idioma.
    const [name, setName] = useState(product?.baseName ?? product?.name ?? '');
    const [description, setDescription] = useState(product?.baseDescription ?? product?.description ?? '');
    const [translations, setTranslations] = useState<ProductTranslations>(product?.translations ?? {});
    const [translationLanguage, setTranslationLanguage] = useState<ProductTranslationLanguage>('en');
    const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
    const [sku, setSku] = useState(product?.sku ?? '');
    const [price, setPrice] = useState(product ? String(product.price) : '');
    const [sizes, setSizes] = useState<string[]>(product?.sizes ?? []);
    const [collectionIds, setCollectionIds] = useState<string[]>(product?.collections?.map((c) => c.id) ?? []);
    // El backend devuelve una imagen de reemplazo cuando no hay ninguna: no se muestra como valor
    const [imageUrl, setImageUrl] = useState(product && product.imageUrl !== PLACEHOLDER_IMAGE ? product.imageUrl : '');
    const [isActive, setIsActive] = useState(product?.isActive ?? true);
    // '' = global. Solo lo edita quien tiene alcance global; para adminSuc este valor nunca se
    // manda (ver handleSubmit) y el backend igual fuerza su propia sucursal.
    const [branchId, setBranchId] = useState(product?.branchId ?? '');
    const [previewFailed, setPreviewFailed] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggleSize = (size: string) => {
        setSizes((prev) => (prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]));
    };

    const updateTranslation = (field: 'name' | 'description', value: string) => {
        setTranslations((prev) => ({
            ...prev,
            [translationLanguage]: { ...prev[translationLanguage], [field]: value },
        }));
    };

    // Un idioma "traducido" para el indicador de las pestañas: con al menos el nombre cargado
    const isTranslated = (code: ProductTranslationLanguage) => !!translations[code]?.name?.trim();

    const toggleCollection = (collectionId: string) => {
        setCollectionIds((prev) => (prev.includes(collectionId) ? prev.filter((id) => id !== collectionId) : [...prev, collectionId]));
    };

    const validate = (): string | null => {
        if (!name.trim()) return t('form.errors.name');
        if (!categoryId) return t('form.errors.category');
        if (!sku.trim()) return t('form.errors.sku');
        const priceValue = Number(price);
        if (price.trim() === '' || Number.isNaN(priceValue) || priceValue < 0) return t('form.errors.price');
        if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) return t('form.errors.priceDecimals');
        if (sizes.length === 0) return t('form.errors.sizes');
        if (imageUrl.trim() && !/^https?:\/\//i.test(imageUrl.trim())) return t('form.errors.imageUrl');
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            await onSubmit({
                name: name.trim(),
                description: description.trim(),
                categoryId,
                sku: sku.trim(),
                price: Number(price),
                sizes,
                imageUrl: imageUrl.trim(),
                isActive,
                collectionIds,
                // El backend recorta espacios y descarta los idiomas vacíos
                translations,
                // Sin alcance global no se manda: el backend fuerza la sucursal propia igual, pero
                // así el payload no sugiere una opción que la UI ni siquiera mostró
                ...(isGlobal ? { branchId: branchId || null } : {}),
            });
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, t('form.saveFailed')));
            setIsSaving(false);
        }
    };

    const showPreview = imageUrl.trim() && /^https?:\/\//i.test(imageUrl.trim()) && !previewFailed;

    return (
        <AdminModal title={product ? t('form.editTitle') : t('form.newTitle')} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                {!product && (
                    <p className={styles.cellSub}>
                        {isGlobal ? t('form.newGlobalHint') : t('form.newBranchHint')}
                    </p>
                )}

                <div className={styles.field}>
                    <label htmlFor="product-branch">{tc('branch')}</label>
                    {isGlobal ? (
                        <select
                            id="product-branch"
                            className={styles.input}
                            value={branchId}
                            onChange={(e) => setBranchId(e.target.value)}
                        >
                            <option value="">{t('form.global')}</option>
                            {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>
                    ) : (
                        <p className={styles.cellSub}>
                            {t.rich('form.creatingFor', { branch: ownBranchName ?? t('yourBranch'), strong: (chunks) => <strong>{chunks}</strong> })}
                        </p>
                    )}
                </div>

                <div className={styles.field}>
                    <label htmlFor="product-name">{tc('name')}</label>
                    <input id="product-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder={t('form.namePlaceholder')} />
                </div>

                <div className={styles.field}>
                    <label htmlFor="product-description">{tc('description')}</label>
                    <textarea
                        id="product-description"
                        className={`${styles.input} ${styles.textareaSmall}`}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('form.descriptionPlaceholder')}
                    />
                </div>

                <fieldset className={styles.field}>
                    <legend>{t('form.translations')}</legend>
                    <small className={styles.cellSub}>{t('form.translationsHint')}</small>
                    <div className={styles.badgeList} role="tablist" aria-label={t('form.translationLanguage')}>
                        {TRANSLATION_LANGUAGES.map((code) => (
                            <button
                                key={code}
                                type="button"
                                role="tab"
                                aria-selected={translationLanguage === code}
                                className={`${styles.sizeChip} ${translationLanguage === code ? styles.sizeChipActive : ''}`}
                                onClick={() => setTranslationLanguage(code)}
                            >
                                {t(`form.languages.${code}`)}
                                {isTranslated(code) ? ' ✓' : ''}
                            </button>
                        ))}
                    </div>
                    <label htmlFor="product-translation-name">{t('form.translatedName', { lang: translationLanguage.toUpperCase() })}</label>
                    <input
                        id="product-translation-name"
                        className={styles.input}
                        lang={translationLanguage}
                        value={translations[translationLanguage]?.name ?? ''}
                        onChange={(e) => updateTranslation('name', e.target.value)}
                        maxLength={200}
                        placeholder={name || t('form.translatedNamePlaceholder')}
                    />
                    <label htmlFor="product-translation-description">{t('form.translatedDescription', { lang: translationLanguage.toUpperCase() })}</label>
                    <textarea
                        id="product-translation-description"
                        className={`${styles.input} ${styles.textareaSmall}`}
                        lang={translationLanguage}
                        value={translations[translationLanguage]?.description ?? ''}
                        onChange={(e) => updateTranslation('description', e.target.value)}
                        maxLength={5000}
                        placeholder={description || t('form.translatedDescriptionPlaceholder')}
                    />
                </fieldset>

                <div className={styles.formRow}>
                    <div className={styles.field}>
                        <label htmlFor="product-category">{t('category')}</label>
                        <select id="product-category" className={styles.input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                            <option value="">{t('form.selectCategory')}</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="product-sku">SKU</label>
                        <input id="product-sku" className={styles.input} value={sku} onChange={(e) => setSku(e.target.value)} maxLength={50} placeholder="VES-004" />
                    </div>
                </div>

                <div className={styles.field}>
                    <label htmlFor="product-price">{t('price')}</label>
                    <input id="product-price" type="number" min={0} step="0.01" className={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="129.90" />
                </div>

                <div className={styles.field}>
                    <label>{t('sizes')}</label>
                    <div className={styles.badgeList} role="group" aria-label={t('form.sizesLabel')}>
                        {SIZE_OPTIONS.map((size) => (
                            <button
                                key={size}
                                type="button"
                                aria-pressed={sizes.includes(size)}
                                className={`${styles.sizeChip} ${sizes.includes(size) ? styles.sizeChipActive : ''}`}
                                onClick={() => toggleSize(size)}
                            >
                                {size}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.field}>
                    <label>{t('form.collections')}</label>
                    {collections.length === 0 ? (
                        <small className={styles.cellSub}>{t('form.noCollections')}</small>
                    ) : (
                        <div className={styles.badgeList} role="group" aria-label={t('form.collectionsLabel')}>
                            {collections.map((collection) => (
                                <button
                                    key={collection.id}
                                    type="button"
                                    aria-pressed={collectionIds.includes(collection.id)}
                                    className={`${styles.sizeChip} ${collectionIds.includes(collection.id) ? styles.sizeChipActive : ''}`}
                                    onClick={() => toggleCollection(collection.id)}
                                >
                                    {collection.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className={styles.field}>
                    <label htmlFor="product-image">{t('form.image')}</label>
                    <input
                        id="product-image"
                        className={styles.input}
                        value={imageUrl}
                        onChange={(e) => {
                            setImageUrl(e.target.value);
                            setPreviewFailed(false);
                        }}
                        placeholder={t('form.imagePlaceholder')}
                    />
                    {showPreview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={imageUrl.trim()}
                            alt={t('form.preview')}
                            className={styles.imagePreview}
                            onError={() => setPreviewFailed(true)}
                        />
                    )}
                    {previewFailed && <small>{t('form.previewFailed')}</small>}
                </div>

                <label className={styles.checkbox}>
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    {t('form.active')}
                </label>

                <div className={styles.modalFooter}>
                    <button type="button" className={styles.buttonSecondary} onClick={onClose}>
                        {tc('cancel')}
                    </button>
                    <button type="submit" className={styles.button} disabled={isSaving}>
                        {isSaving ? tc('saving') : tc('save')}
                    </button>
                </div>
            </form>
        </AdminModal>
    );
}
