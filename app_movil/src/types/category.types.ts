export interface Category {
  id: string;
  name: string;
  description?: string | null;
  slug: string;
  imageUrl?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CategoriesApiResponse {
  data: Category[];
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
