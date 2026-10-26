'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { Collection, CollectionPayload } from '@/types/admin.types';

interface CollectionFormModalProps {
    collection?: Collection;
    onClose: () => void;
    onSubmit: (payload: CollectionPayload) => Promise<void>;
}

export default function CollectionFormModal({ collection, onClose, onSubmit }: CollectionFormModalProps) {
    const t = useTranslations('AdminCollections');
    const tc = useTranslations('AdminCommon');
    const [name, setName] = useState(collection?.name ?? '');
    const [description, setDescription] = useState(collection?.description ?? '');
    // Vacío = el backend genera el slug a partir del nombre; solo se manda si la persona lo escribe
    const [slug, setSlug] = useState(collection?.slug ?? '');
    const [bannerImageUrl, setBannerImageUrl] = useState(collection?.bannerImageUrl ?? '');
    const [isActive, setIsActive] = useState(collection?.isActive ?? true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const validate = (): string | null => {
        if (!name.trim()) return t('nameRequired');
        if (slug.trim() && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim())) {
            return t('slugInvalid');
        }
        if (bannerImageUrl.trim() && !/^https?:\/\//i.test(bannerImageUrl.trim())) {
            return t('imageInvalid');
        }
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
                bannerImageUrl: bannerImageUrl.trim() || undefined,
                isActive,
            });
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, t('saveFailed')));
            setIsSaving(false);
        }
    };

    return (
        <AdminModal title={collection ? t('editTitle') : t('newTitle')} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                <div className={styles.field}>
                    <label htmlFor="collection-name">{tc('name')}</label>
                    <input
                        id="collection-name"
                        className={styles.input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={100}
                        placeholder={t('namePlaceholder')}
                    />
                </div>

                <div className={styles.field}>
                    <label htmlFor="collection-description">{tc('description')}</label>
                    <textarea
                        id="collection-description"
                        className={`${styles.input} ${styles.textareaSmall}`}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={255}
                        placeholder={t('descriptionPlaceholder')}
                    />
                </div>

                <div className={styles.field}>
                    <label htmlFor="collection-slug">{t('slugLabel')}</label>
                    <input
                        id="collection-slug"
                        className={styles.input}
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        maxLength={100}
                        placeholder={t('slugPlaceholder')}
                    />
                    <small className={styles.cellSub}>{t('slugHint')}</small>
                </div>

                <div className={styles.field}>
                    <label htmlFor="collection-banner">{t('imageLabel')}</label>
                    <input
                        id="collection-banner"
                        className={styles.input}
                        value={bannerImageUrl}
                        onChange={(e) => setBannerImageUrl(e.target.value)}
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
