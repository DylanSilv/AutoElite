import type {
  CategoryDto,
  ModifierGroupDto,
  ModifierOptionDto,
  ProductDto,
  VariantDto,
} from '@autoelite/shared';
import type {
  Category,
  ModifierGroup,
  ModifierOption,
  Product,
  ProductVariant,
} from '@prisma/client';

export function toCategoryDto(category: Category, productsCount?: number): CategoryDto {
  return {
    id: category.publicId,
    name: category.name,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    ...(productsCount === undefined ? {} : { productsCount }),
  };
}

export function toVariantDto(variant: ProductVariant): VariantDto {
  return {
    id: variant.publicId,
    name: variant.name,
    priceCents: variant.priceCents,
    isAvailable: variant.isAvailable,
    sortOrder: variant.sortOrder,
  };
}

export function toModifierOptionDto(option: ModifierOption): ModifierOptionDto {
  return {
    id: option.publicId,
    name: option.name,
    priceDeltaCents: option.priceDeltaCents,
    isAvailable: option.isAvailable,
    sortOrder: option.sortOrder,
  };
}

export function toModifierGroupDto(
  group: ModifierGroup & { options: ModifierOption[] },
): ModifierGroupDto {
  return {
    id: group.publicId,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    isActive: group.isActive,
    sortOrder: group.sortOrder,
    options: [...group.options]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toModifierOptionDto),
  };
}

type ProductWithRelations = Product & {
  category: Category;
  variants: ProductVariant[];
  modifierGroups: { group: ModifierGroup & { options: ModifierOption[] } }[];
};

export function toProductDto(product: ProductWithRelations): ProductDto {
  return {
    id: product.publicId,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    isAvailable: product.isAvailable,
    sortOrder: product.sortOrder,
    category: { id: product.category.publicId, name: product.category.name },
    variants: product.variants
      .filter((v) => v.deletedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toVariantDto),
    modifierGroups: product.modifierGroups.map((link) => toModifierGroupDto(link.group)),
  };
}

/** Include compartido por todas las consultas que devuelven un ProductDto. */
export const productInclude = {
  category: true,
  variants: true,
  modifierGroups: { include: { group: { include: { options: true } } } },
} as const;
