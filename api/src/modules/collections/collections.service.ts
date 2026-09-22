import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Collection, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionResponseDto } from './dto/collection-response.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { QueryCollectionDto } from './dto/query-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';

@Injectable()
export class CollectionsService {
  constructor(private prisma: PrismaService) {}

  async create(createCollectionDto: CreateCollectionDto): Promise<CollectionResponseDto> {
    const { name, slug, ...rest } = createCollectionDto;

    const collectionSlug =
      slug ??
      name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '');

    const existing = await this.prisma.collection.findUnique({ where: { slug: collectionSlug } });
    if (existing) {
      throw new ConflictException(`Collection with slug ${collectionSlug} already exists`);
    }

    const collection = await this.prisma.collection.create({
      data: { name, slug: collectionSlug, ...rest },
    });

    return this.formatCollection(collection, 0);
  }

  async findAll(queryDto: QueryCollectionDto): Promise<{
    data: CollectionResponseDto[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { isActive, search, page = 1, limit = 10 } = queryDto;

    const where: Prisma.CollectionWhereInput = {};
    if (isActive !== undefined) {
      where.isActive = isActive;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const total = await this.prisma.collection.count({ where });
    const collections = await this.prisma.collection.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { products: true } } },
    });

    return {
      data: collections.map((collection) => this.formatCollection(collection, collection._count.products)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findBySlug(slug: string): Promise<CollectionResponseDto> {
    const collection = await this.prisma.collection.findUnique({
      where: { slug },
      include: { _count: { select: { products: true } } },
    });

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    return this.formatCollection(collection, collection._count.products);
  }

  async update(id: string, updateCollectionDto: UpdateCollectionDto): Promise<CollectionResponseDto> {
    const existing = await this.prisma.collection.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Collection not found');
    }

    if (updateCollectionDto.slug && updateCollectionDto.slug !== existing.slug) {
      const slugTaken = await this.prisma.collection.findUnique({ where: { slug: updateCollectionDto.slug } });
      if (slugTaken) {
        throw new ConflictException(`Collection with slug ${updateCollectionDto.slug} already exists`);
      }
    }

    const updated = await this.prisma.collection.update({
      where: { id },
      data: updateCollectionDto,
      include: { _count: { select: { products: true } } },
    });

    return this.formatCollection(updated, updated._count.products);
  }

  async remove(id: string): Promise<{ message: string }> {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    if (collection._count.products > 0) {
      throw new BadRequestException(
        `Cannot delete collection with ${collection._count.products} products. Remove them from the collection first`,
      );
    }

    await this.prisma.collection.delete({ where: { id } });

    return { message: 'Collection deleted successfully' };
  }

  private formatCollection(collection: Collection, productCount: number): CollectionResponseDto {
    return {
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description,
      bannerImageUrl: collection.bannerImageUrl,
      isActive: collection.isActive,
      productCount,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    };
  }
}
