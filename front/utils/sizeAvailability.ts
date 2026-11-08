import { CartItem } from "@/types/cart.types";
import { Product } from "@/types/product.types";

export interface SizeAvailability {
    size: string;
    // Stock de la talla en la sucursal (sin restar el carrito)
    stock: number;
    // Lo que todavía se puede añadir: stock menos lo que ya está en el carrito en esa talla
    available: number;
    inCart: number;
}

// Disponibilidad por talla de un producto en la sucursal con la que se pidió (`stockBySize`).
// Solo lista las tallas reales del producto (`product.sizes`). Una talla sin fila de inventario en esa
// sucursal cuenta como sin stock. Devuelve null si el producto no trae stock por sucursal: en ese caso
// no hay datos verificados para afirmar que una talla está disponible.
export function getSizeAvailability(product: Product, cartItems: CartItem[]): SizeAvailability[] | null {
    if (!product.stockBySize) return null;
    const stockMap = new Map(product.stockBySize.map((row) => [row.size, row.stock]));
    return product.sizes.map((size) => {
        const stock = Math.max(0, stockMap.get(size) ?? 0);
        const inCart = cartItems
            .filter((item) => item.productId === product.id && item.selectedSize === size)
            .reduce((sum, item) => sum + item.quantity, 0);
        return { size, stock, inCart, available: Math.max(0, stock - inCart) };
    });
}
