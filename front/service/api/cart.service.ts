import { apiClient } from "./axios.config";

export class CartService {
    private static readonly ENDPOINT = "/cart"; // Se agregó el ENDPOINT faltante

    // Reemplaza el carrito del servidor por el local en UNA transacción (aplica solo diferencias). Si una
    // línea no tiene stock falla todo y lanza: antes los errores se tragaban y la orden salía sin reserva.
    // Devuelve la revisión del carrito: la compra se confirma contra esa revisión exacta.
    static async syncCart(localCart: { productId: string; quantity: number; selectedSize?: string }[], branchId?: string): Promise<{ version: number; total: number }> {
        const response = await apiClient.put<{ version: number; total: number }>(this.ENDPOINT, {
            items: localCart.map((item) => ({
                productId: item.productId,
                quantity: Number(item.quantity),
                size: item.selectedSize,
            })),
            ...(branchId ? { branchId } : {}),
        });
        return response.data;
    }
}
