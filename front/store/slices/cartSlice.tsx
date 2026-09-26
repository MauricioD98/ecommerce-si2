import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { CartItem, CartState } from "@/types/cart.types";
import { Product } from "@/types/product.types";
import { getEffectivePrice } from "@/utils/pricing";

const initialState: CartState = {
    items: [],
    totalItems: 0,
    totalPrice: 0,
};

interface CartItemKey {
    productId: string;
    selectedSize?: string;
}

const matches = (i: CartItem, key: CartItemKey) =>
    i.productId === key.productId && i.selectedSize === key.selectedSize;

const recalcTotals = (state: CartState) => {
    state.totalItems = state.items.reduce(
        (sum: number, i: CartItem) => sum + i.quantity,
        0
    );
    state.totalPrice = state.items.reduce(
        (sum: number, i: CartItem) => sum + getEffectivePrice(i.product) * i.quantity,
        0
    );
};

const cartSlice = createSlice({
    name: "cart",
    initialState,
    reducers: {
        addToCart: (
            state: CartState,
            action: PayloadAction<{ product: Product; selectedSize?: string; quantity?: number }>
        ) => {
            const { product, selectedSize, quantity = 1 } = action.payload;
            if (quantity <= 0) return;

            let maxStock = product.stock;
            if (selectedSize && product.stockBySize) {
                const sizeRow = product.stockBySize.find((s) => s.size === selectedSize);
                if (sizeRow !== undefined) maxStock = sizeRow.stock;
            }
            if (maxStock <= 0) return;

            const existing = state.items.find(
                (i: CartItem) => matches(i, { productId: product.id, selectedSize })
            );
            if (existing) {
                existing.quantity = Math.min(existing.quantity + quantity, maxStock);
                existing.updateAt = new Date().toISOString();
            } else {
                const initialQty = Math.min(quantity, maxStock);
                if (initialQty <= 0) return;
                const newItem: CartItem = {
                    id: crypto.randomUUID(),
                    cartId: "",
                    productId: product.id,
                    product,
                    price: getEffectivePrice(product),
                    quantity: initialQty,
                    selectedSize,
                    CreatedAt: new Date().toISOString(),
                    updateAt: new Date().toISOString(),
                };
                state.items.push(newItem);
            }
            recalcTotals(state);
        },

        removeFromCart: (state: CartState, action: PayloadAction<CartItemKey>) => {
            state.items = state.items.filter(
                (i: CartItem) => !matches(i, action.payload)
            );
            recalcTotals(state);
        },

        incrementQuantity: (state: CartState, action: PayloadAction<CartItemKey>) => {
            const item = state.items.find(
                (i: CartItem) => matches(i, action.payload)
            );
            if (!item) return;

            let maxStock = item.product.stock;
            if (item.selectedSize && item.product.stockBySize) {
                const sizeRow = item.product.stockBySize.find((s) => s.size === item.selectedSize);
                if (sizeRow !== undefined) maxStock = sizeRow.stock;
            }

            if (item.quantity < maxStock) {
                item.quantity += 1;
                item.updateAt = new Date().toISOString();
                recalcTotals(state);
            }
        },

        decrementQuantity: (state: CartState, action: PayloadAction<CartItemKey>) => {
            const item = state.items.find(
                (i: CartItem) => matches(i, action.payload)
            );
            if (item) {
                if (item.quantity <= 1) {
                    state.items = state.items.filter(
                        (i: CartItem) => !matches(i, action.payload)
                    );
                } else {
                    item.quantity -= 1;
                }
                recalcTotals(state);
            }
        },

        // Reemplaza la copia de cada producto por la que trae la sucursal seleccionada (precio, oferta y stock)
        syncProducts: (state: CartState, action: PayloadAction<Product[]>) => {
            for (const product of action.payload) {
                for (const item of state.items) {
                    if (item.productId === product.id) {
                        item.product = product;
                        item.price = getEffectivePrice(product);
                    }
                }
            }
            recalcTotals(state);
        },

        clearAllCart: (state: CartState) => {
            state.items = [];
            state.totalItems = 0;
            state.totalPrice = 0;
        },
    },
});

export const {
    addToCart,
    removeFromCart,
    incrementQuantity,
    decrementQuantity,
    syncProducts,
    clearAllCart,
} = cartSlice.actions;

export default cartSlice.reducer;
