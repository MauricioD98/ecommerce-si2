'use client';

import React, { useState } from 'react';
import { Box } from 'lucide-react';
import styles from './admin-table.module.scss';
import AdminModal from './AdminModal';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { PLACEHOLDER_IMAGE } from '@/service/api/product.service';
import { CategoryOption, ProductPayload } from '@/types/admin.types';
import { Product } from '@/types/product.types';
import { Branch } from '@/types/branch.types';
import { CollectionOption } from '@/types/collection.types';

// Mismas tallas que acepta el backend (enum WomenSize)
const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

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
    const [name, setName] = useState(product?.name ?? '');
    const [description, setDescription] = useState(product?.description ?? '');
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

    const toggleCollection = (collectionId: string) => {
        setCollectionIds((prev) => (prev.includes(collectionId) ? prev.filter((id) => id !== collectionId) : [...prev, collectionId]));
    };

    const validate = (): string | null => {
        if (!name.trim()) return 'El nombre es obligatorio.';
        if (!categoryId) return 'Selecciona una categoría.';
        if (!sku.trim()) return 'El SKU es obligatorio.';
        const priceValue = Number(price);
        if (price.trim() === '' || Number.isNaN(priceValue) || priceValue < 0) return 'Ingresa un precio válido.';
        if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) return 'El precio admite hasta 2 decimales.';
        if (sizes.length === 0) return 'Selecciona al menos una talla.';
        if (imageUrl.trim() && !/^https?:\/\//i.test(imageUrl.trim())) return 'La imagen debe ser una URL que empiece con http:// o https://';
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
                // Sin alcance global no se manda: el backend fuerza la sucursal propia igual, pero
                // así el payload no sugiere una opción que la UI ni siquiera mostró
                ...(isGlobal ? { branchId: branchId || null } : {}),
            });
            onClose();
        } catch (error) {
            setError(getApiErrorMessage(error, 'No se pudo guardar el producto.'));
            setIsSaving(false);
        }
    };

    const showPreview = imageUrl.trim() && /^https?:\/\//i.test(imageUrl.trim()) && !previewFailed;

    return (
        <AdminModal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}>
            <form className={styles.form} onSubmit={handleSubmit}>
                {error && <div className={styles.errorMessage}>{error}</div>}

                {!product && (
                    <p className={styles.cellSub}>
                        {isGlobal
                            ? 'El producto nace con stock 0 en la(s) sucursal(es) donde quede disponible. Asígnale stock desde Inventario.'
                            : 'Este producto quedará disponible solo en tu sucursal. Nace con stock 0: asígnale stock desde Inventario.'}
                    </p>
                )}

                <div className={styles.field}>
                    <label htmlFor="product-branch">Sucursal</label>
                    {isGlobal ? (
                        <select
                            id="product-branch"
                            className={styles.input}
                            value={branchId}
                            onChange={(e) => setBranchId(e.target.value)}
                        >
                            <option value="">Global (disponible en todas las sucursales)</option>
                            {branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>
                    ) : (
                        <p className={styles.cellSub}>
                            Creando producto para: <strong>{ownBranchName ?? 'tu sucursal'}</strong>
                        </p>
                    )}
                </div>

                <div className={styles.field}>
                    <label htmlFor="product-name">Nombre</label>
                    <input id="product-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Vestido largo rojo de fiesta" />
                </div>

                <div className={styles.field}>
                    <label htmlFor="product-description">Descripción</label>
                    <textarea
                        id="product-description"
                        className={`${styles.input} ${styles.textareaSmall}`}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Material, corte, ocasión de uso..."
                    />
                </div>

                <div className={styles.formRow}>
                    <div className={styles.field}>
                        <label htmlFor="product-category">Categoría</label>
                        <select id="product-category" className={styles.input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                            <option value="">Selecciona una categoría</option>
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
                    <label htmlFor="product-price">Precio</label>
                    <input id="product-price" type="number" min={0} step="0.01" className={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="129.90" />
                </div>

                <div className={styles.field}>
                    <label>Tallas</label>
                    <div className={styles.badgeList} role="group" aria-label="Tallas disponibles">
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
                    <label>Colecciones (opcional)</label>
                    {collections.length === 0 ? (
                        <small className={styles.cellSub}>
                            Todavía no hay colecciones creadas. Andá a Colecciones para crear la primera.
                        </small>
                    ) : (
                        <div className={styles.badgeList} role="group" aria-label="Colecciones del producto">
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
                    <label htmlFor="product-image">Imagen (URL)</label>
                    <input
                        id="product-image"
                        className={styles.input}
                        value={imageUrl}
                        onChange={(e) => {
                            setImageUrl(e.target.value);
                            setPreviewFailed(false);
                        }}
                        placeholder="https://ejemplo.com/imagen.jpg"
                    />
                    {showPreview && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={imageUrl.trim()}
                            alt="Vista previa"
                            className={styles.imagePreview}
                            onError={() => setPreviewFailed(true)}
                        />
                    )}
                    {previewFailed && <small>No se pudo cargar la imagen. Revisa la URL.</small>}

                    {/* Placeholder: la carga de modelos 3D aún no existe */}
                    <button
                        type="button"
                        className={styles.beta3dButton}
                        onClick={() => window.alert('La carga de modelos 3D estará disponible próximamente')}
                    >
                        <Box size={18} />
                        Cargar modelo 3D (BETA)
                    </button>
                </div>

                <label className={styles.checkbox}>
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    Producto activo (visible en la tienda)
                </label>

                <div className={styles.modalFooter}>
                    <button type="button" className={styles.buttonSecondary} onClick={onClose}>
                        Cancelar
                    </button>
                    <button type="submit" className={styles.button} disabled={isSaving}>
                        {isSaving ? 'Guardando...' : 'Guardar'}
                    </button>
                </div>
            </form>
        </AdminModal>
    );
}
