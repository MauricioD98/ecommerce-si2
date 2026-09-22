import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Cart } from '../types';
import { cartApi } from '../api/cart.api';
import { useAuth } from './AuthContext';

interface CartContextType {
  cart: Cart | null;
  isLoading: boolean;
  itemCount: number;
  totalAmount: number;
  fetchCart: () => Promise<void>;
  addToCart: (productId: string, quantity?: number) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeFromCart: (itemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [cart, setCart] = useState<Cart | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchCart = useCallback(async () => {
    if (!isAuthenticated) {
      setCart(null);
      return;
    }
    try {
      setIsLoading(true);
      const data = await cartApi.getCart();
      setCart(data);
    } catch {
      // Cart might not exist yet or offline
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCart();
    } else {
      setCart(null);
    }
  }, [isAuthenticated, fetchCart]);

  const addToCart = async (productId: string, quantity: number = 1) => {
    setIsLoading(true);
    try {
      const updated = await cartApi.addItem({ productId, quantity });
      setCart(updated);
    } finally {
      setIsLoading(false);
    }
  };

  const updateQuantity = async (itemId: string, quantity: number) => {
    setIsLoading(true);
    try {
      if (quantity <= 0) {
        const updated = await cartApi.removeItem(itemId);
        setCart(updated);
      } else {
        const updated = await cartApi.updateItemQuantity(itemId, { quantity });
        setCart(updated);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const removeFromCart = async (itemId: string) => {
    setIsLoading(true);
    try {
      const updated = await cartApi.removeItem(itemId);
      setCart(updated);
    } finally {
      setIsLoading(false);
    }
  };

  const clearCart = async () => {
    setIsLoading(true);
    try {
      const updated = await cartApi.clearCart();
      setCart(updated);
    } finally {
      setIsLoading(false);
    }
  };

  const itemCount = useMemo(() => {
    if (!cart?.cartItems) return 0;
    return cart.cartItems.reduce((acc, item) => acc + item.quantity, 0);
  }, [cart]);

  const totalAmount = useMemo(() => {
    if (!cart) return 0;
    if (typeof cart.total === 'number') return cart.total;
    if (cart.cartItems) {
      return cart.cartItems.reduce((acc, item) => {
        const price = Number(item.product?.price || 0);
        return acc + price * item.quantity;
      }, 0);
    }
    return 0;
  }, [cart]);

  return (
    <CartContext.Provider
      value={{
        cart,
        isLoading,
        itemCount,
        totalAmount,
        fetchCart,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = (): CartContextType => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
