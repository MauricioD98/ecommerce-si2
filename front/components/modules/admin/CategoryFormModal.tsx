'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Category, CategoryPayload } from '@/types/admin.types';

interface CategoryFormModalProps {
    category?: Category;
    onClose: () => void;
    onSubmit: (payload: CategoryPayload) => Promise<void>;
}

export default function CategoryFormModal({ category, onClose, onSubmit }: CategoryFormModalProps) {
    const t = useTranslations('AdminCategories');
    const tc = useTranslations('AdminCommon');
    const [name, setName] = useState(category?.name ?? '');
    const [description, setDescription] = useState(category?.description ?? '');
    // Vacío = el backend genera el slug a partir del nombre; solo se manda si la persona lo escribe
    const [slug, setSlug] = useState(category?.slug ?? '');
    const [imageUrl, setImageUrl] = useState(category?.imageUrl ?? '');
    const [isActive, setIsActive] = useState(category?.isActive ?? true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const validate = (): string | null => {
        if (!name.trim()) return t('nameRequired');
        if (slug.trim() && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim())) {
            return t('slugInvalid');
        }
        if (imageUrl.trim() && !/^https?:\/\//i.test(imageUrl.trim())) return t('imageInvalid');
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
                description: description.trim() || undefined,
                slug: slug.trim() || undefined,
                imageUrl: imageUrl.trim() || undefined,
                isActive,
            });
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, t('saveFailed')));
            setIsSaving(false);
        }
    };

    return (
        <AdminModal title={category ? t('editTitle') : t('newTitle')} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                <div className={styles.field}>
                    <label htmlFor="category-name">{tc('name')}</label>
                    <input
                        id="category-name"
                        className={styles.input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={100}
                        placeholder={t('namePlaceholder')}
                    />
                </div>

                <div className={styles.field}>
                    <label htmlFor="category-description">{tc('description')}</label>
                    <textarea
                        id="category-description"
                        className={`${styles.input} ${styles.textareaSmall}`}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={255}
                        placeholder={t('descriptionPlaceholder')}
                    />
                </div>

                <div className={styles.field}>
                    <label htmlFor="category-slug">{t('slugLabel')}</label>
                    <input
                        id="category-slug"
                        className={styles.input}
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        maxLength={100}
                        placeholder={t('slugPlaceholder')}
                    />
                    <small className={styles.cellSub}>{t('slugHint')}</small>
                </div>

                <div className={styles.field}>
                    <label htmlFor="category-image">{t('imageLabel')}</label>
                    <input
                        id="category-image"
                        className={styles.input}
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder={t('imagePlaceholder')}
                    />
                </div>

                <label className={styles.checkbox}>
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    {t('activeLabel')}
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
