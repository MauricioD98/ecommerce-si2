import { IRootState, useAppDispatch } from "@/store";
import { useCallback, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { ProductService } from "@/service/api/product.service";
import { CartItem } from "@/types/cart.types";
import { Product } from "@/types/product.types";
import { calculateCartTotals, getEmployeeDiscountPercent } from "@/utils/pricing";
import {
    addToCart as addToCartAction,
    removeFromCart as removeFromCartAction,
    incrementQuantity as incrementQuantityAction,
    decrementQuantity as decrementQuantityAction,
    syncProducts as syncProductsAction,
    clearAllCart as clearCartAction,
} from "@/store/slices/cartSlice";

export function useCart() {
    const dispatch = useAppDispatch();
    const reduxCart = useSelector((state: IRootState) => state.cart);

    const user = useSelector((state: IRootState) => state.auth.user);

    const items: CartItem[] = reduxCart.items;
    // Referencia al carrito más reciente, para que syncCartProducts no cambie en cada render
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    // Descuento de producto -> subtotal -> descuento de trabajador (si el usuario lo tiene) -> total
    const totals = calculateCartTotals(items, getEmployeeDiscountPercent(user));

    const addProductToCart = async (product: Product, selectedSize?: string) => {
        dispatch(addToCartAction({ product, selectedSize }));
    };

    const decrementProductQuantity = async (productId: string, selectedSize?: string) => {
        dispatch(decrementQuantityAction({ productId, selectedSize }));
    };

    const incrementProductQuantity = async (productId: string, selectedSize?: string) => {
        dispatch(incrementQuantityAction({ productId, selectedSize }));
    };



    const removeFromCart = async (productId: string, selectedSize?: string) => {
        dispatch(removeFromCartAction({ productId, selectedSize }));
    };

    // Vuelve a pedir cada producto del carrito con la sucursal elegida para actualizar su oferta y stock.
    // Si alguno falla se conserva su copia anterior.
    const syncCartProducts = useCallback(async (branchId?: string | null) => {
        const ids = [...new Set(itemsRef.current.map((item: CartItem) => item.productId))];
        if (ids.length === 0) return;

        const results = await Promise.allSettled(ids.map((id) => ProductService.getProductById(id, branchId)));
        const products = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
        if (products.length > 0) {
            dispatch(syncProductsAction(products));
        }
    }, [dispatch]);

    const clearAllCart = () => {
        dispatch(clearCartAction());
    };

    return {
        items,
        totalItems: items.reduce((sum: number, i: CartItem) => sum + i.quantity, 0),
        // Total a pagar (con todos los descuentos); el detalle está en `totals`
        totalPrice: totals.total,
        totals,
        addProductToCart,
        decrementProductQuantity,
        incrementProductQuantity,
        removeFromCart,
        syncCartProducts,
        clearAllCart,
    };
}