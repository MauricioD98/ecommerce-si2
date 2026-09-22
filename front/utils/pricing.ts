// Espejo de las reglas de precios del backend (api/src/common/utils/pricing.ts).
// Sirve para mostrar el carrito local; el total definitivo lo calcula el backend al crear la orden.
import { Product } from "@/types/product.types";

export const round2 = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

// Espejo de DELIVERY_SHIPPING_COST en api/src/common/constants/pricing.ts.
// Solo para previsualizar el total en el checkout: el monto real y definitivo lo calcula el backend al crear la orden.
export const DELIVERY_SHIPPING_COST = 15;

// El descuento viene anidado en `discount` y corresponde a la sucursal con la que se pidió el producto
type PricedProduct = Pick<Product, "price" | "discount">;

// Precio vigente: discountPrice (si es menor al precio) > discountPercentage > precio base
export function getEffectivePrice(product: PricedProduct): number {
    const price = Number(product.price);

    const { discountPrice: rawDiscountPrice, discountPercentage } = product.discount ?? {};

    if (rawDiscountPrice != null) {
        const discountPrice = Number(rawDiscountPrice);
        if (discountPrice >= 0 && discountPrice < price) return round2(discountPrice);
    }

    const percentage = discountPercentage ?? 0;
    if (percentage > 0 && percentage <= 100) return round2(price * (1 - percentage / 100));

    return round2(price);
}

export const hasProductDiscount = (product: PricedProduct): boolean =>
    getEffectivePrice(product) < Number(product.price);

// Porcentaje de descuento de trabajador del usuario (0 si no tiene). El backend lo asigna solo al personal
export function getEmployeeDiscountPercent(user?: { employeeDiscount?: number } | null): number {
    return Math.min(Math.max(user?.employeeDiscount ?? 0, 0), 100);
}

export interface CartTotals {
    listSubtotal: number;      // suma a precio de lista
    productDiscount: number;   // ahorro por descuentos de producto
    subtotal: number;          // tras descuentos de producto
    employeeDiscountPercent: number;
    employeeDiscount: number;  // monto del descuento de trabajador
    total: number;
}

export function calculateCartTotals(
    lines: { product: PricedProduct; quantity: number }[],
    employeeDiscountPercent: number
): CartTotals {
    const listSubtotal = round2(lines.reduce((s, l) => s + Number(l.product.price) * l.quantity, 0));
    const subtotal = round2(lines.reduce((s, l) => s + getEffectivePrice(l.product) * l.quantity, 0));
    const employeeDiscount = round2((subtotal * employeeDiscountPercent) / 100);

    return {
        listSubtotal,
        productDiscount: round2(listSubtotal - subtotal),
        subtotal,
        employeeDiscountPercent,
        employeeDiscount,
        total: round2(subtotal - employeeDiscount),
    };
}
