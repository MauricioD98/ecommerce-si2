type Numeric = number | string | { toString(): string };

export interface PricedProduct {
  price: Numeric;
  discountPrice?: Numeric | null;
  discountPercentage?: number | null;
}

export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

// Precio vigente del producto: discountPrice (si es menor al precio) > discountPercentage > precio base
export function getEffectivePrice(product: PricedProduct): number {
  const price = Number(product.price);

  if (product.discountPrice != null) {
    const discountPrice = Number(product.discountPrice);
    if (discountPrice >= 0 && discountPrice < price) {
      return round2(discountPrice);
    }
  }

  const percentage = product.discountPercentage ?? 0;
  if (percentage > 0 && percentage <= 100) {
    return round2(price * (1 - percentage / 100));
  }

  return round2(price);
}

// Precio de un producto en una sucursal: el descuento vive en su registro de inventario
export function getBranchPrice(
  product: { price: Numeric },
  inventory?: { discountPrice?: Numeric | null; discountPercentage?: number | null } | null,
): number {
  return getEffectivePrice({
    price: product.price,
    discountPrice: inventory?.discountPrice,
    discountPercentage: inventory?.discountPercentage,
  });
}

// % de descuento de trabajador del usuario (0 si no tiene). Solo se asigna desde /users/staff
export function getEmployeeDiscountPercent(user: { employeeDiscount: number }): number {
  return Math.min(Math.max(user.employeeDiscount ?? 0, 0), 100);
}

export function calculateTotals(
  lines: { unitPrice: number; quantity: number }[],
  employeeDiscountPercent: number,
) {
  const subtotal = round2(
    lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  );
  const discountApplied = round2((subtotal * employeeDiscountPercent) / 100);
  return {
    subtotal,
    discountApplied,
    total: round2(subtotal - discountApplied),
  };
}
