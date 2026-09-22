import { apiClient } from "./axios.config";
import { ProductCart } from "./product.service";
// IMPORTANTE: Asegúrate de tener CartResponse creado en tus types
import { CartResponse } from "@/types/cart.types";

export class CartService {
    private static readonly ENDPOINT = "/cart"; // Se agregó el ENDPOINT faltante

    // El backend no tiene /cart/merge: se sincroniza vaciando el carrito del servidor y agregando
    // cada ítem local. Nunca lanza error: si falla, el checkout puede continuar igualmente.
    static async mergeCart(localCard: (ProductCart & { selectedSize?: string })[], branchId?: string): Promise<CartResponse> {
        try {
            await apiClient.delete(this.ENDPOINT);

            for (const item of localCard) {
                try {
                    await apiClient.post(`${this.ENDPOINT}/items`, {
                        productId: item.productId,
                        quantity: Number(item.quantity),
                        ...(item.selectedSize ? { size: item.selectedSize } : {}),
                        // El backend valida el stock contra el inventario de esa sucursal
                        ...(branchId ? { branchId } : {}),
                    });
                } catch (error) {
                    console.warn(`No se pudo sincronizar el producto ${item.productId}`, error);
                }
            }

            return { success: true, message: "Carrito sincronizado", data: null };
        } catch (error) {
            console.warn("No se pudo sincronizar el carrito con el servidor", error);
            return { success: false, message: "No se pudo sincronizar el carrito", data: null };
        }
    }
}
