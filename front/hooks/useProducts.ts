import { useState, useCallback } from "react";
import { Product, ProductQueryParams, ProductsResponse } from "../types/product.types";
import { ProductService } from "../service/api/product.service"

export function useProducts() {

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [meta, setMeta] = useState({
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1
    });

    const [product, setProduct] = useState<Product | null>(null)


    const getProducts = useCallback(
        async (params?: ProductQueryParams): Promise<ProductsResponse | null> => {
            setIsLoading(true);
            setError(null);

            try {
                const response = await ProductService.getProducts(params);
                setProducts(response.data);
                setMeta(response.pagination);
                return response;

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const message = "Failed to load products: " + errorMessage;

                setError(message);
                return null;
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    const getProduct = useCallback(
        async (id: string, branchId?: string | null): Promise<Product | null> => {
            if (!id) return null;
            setIsLoading(true);
            setError(null);
            try {
                const response = await ProductService.getProductById(id, branchId);
                if (response) {
                    setProduct(response);
                    return response;
                }
                throw new Error("Product not found");
            } catch (error) {
                const message = "Failed to load product: " + error;
                setError(message);
                return null;
            } finally {
                setIsLoading(false);
            }
        }, []
    );




    return { isLoading, products, getProducts, error, meta, getProduct, product };
}