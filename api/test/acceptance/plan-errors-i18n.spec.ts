import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Controller,
  ForbiddenException,
  Get,
  type INestApplication,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  Post,
  UseGuards,
} from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n';
import { RequirePlanFeature } from '../../src/common/decorators/plan-feature.decorator';
import { PlanFeatureGuard } from '../../src/common/decorators/guards/plan-feature.guard';
import { I18nExceptionFilter } from '../../src/i18n/i18n-exception.filter';
import { FALLBACK_LANGUAGE } from '../../src/i18n/i18n-message';
import { BranchesService } from '../../src/modules/branches/branches.service';
import { planFeatureMessage } from '../../src/modules/platform/plans';
import { ProductsService } from '../../src/modules/products/products.service';
import { tenantStorage } from '../../src/tenancy/tenant-context';

// Errores de plan (funcionalidad no incluida, topes de sucursales y productos) traducidos por
// I18nExceptionFilter. No necesita PostgreSQL: los servicios reales corren con un Prisma falso que
// solo responde los conteos, así que también se puede correr suelto con node --test.

// Tienda Starter que ya llegó a sus topes (1 sucursal, 200 productos activos)
const fakePrisma = {
  branch: { count: async () => 1 },
  product: { count: async () => 200 },
};

// Hace de TenantMiddleware: abre el contexto de la tienda con el plan del header
function fakeTenant(req: Request, _res: Response, next: NextFunction) {
  const plan = req.header('x-test-plan') ?? 'starter';
  tenantStorage.run({ tenantId: 't-1', schemaName: 'tenant_legacy', plan }, () => next());
}

// Como TenantMiddleware con x-client-platform: mobile: el error sale de un middleware, no de un handler
function rejectMobile(_req: Request, _res: Response, next: NextFunction) {
  next(new ForbiddenException(planFeatureMessage('mobileApp')));
}

@Controller('plan-test')
class PlanTestController {
  private readonly branches = new BranchesService(fakePrisma as never);
  private readonly products = new ProductsService(fakePrisma as never, {} as never);

  @Get('pos')
  @UseGuards(PlanFeatureGuard)
  @RequirePlanFeature('pos')
  pos() {
    return { ok: true };
  }

  @Post('branches')
  createBranch() {
    return this.branches.create({ name: 'Sucursal 2' } as never);
  }

  @Post('products')
  createProduct() {
    return this.products.create({ sku: 'X-1' } as never, { id: 'u-1' } as never);
  }

  @Get('mobile')
  mobile() {
    return { ok: true };
  }
}

@Module({
  imports: [
    // Misma configuración que app.module.ts
    I18nModule.forRoot({
      fallbackLanguage: FALLBACK_LANGUAGE,
      loaderOptions: { path: join(__dirname, '..', '..', 'src', 'i18n', 'locales'), watch: false },
      resolvers: [{ use: QueryResolver, options: ['lang'] }, new HeaderResolver(['x-lang']), AcceptLanguageResolver],
    }),
  ],
  controllers: [PlanTestController],
  providers: [{ provide: APP_FILTER, useClass: I18nExceptionFilter }],
})
class PlanTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(rejectMobile).forRoutes('plan-test/mobile');
    consumer.apply(fakeTenant).forRoutes(PlanTestController);
  }
}

describe('Errores de plan traducidos (es, en, fr, zh)', () => {
  let app: INestApplication;
  let base: string;

  before(async () => {
    app = await NestFactory.create(PlanTestModule, { logger: ['error'] });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  after(() => app.close());

  async function call(method: 'GET' | 'POST', path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}/plan-test/${path}`, { method, headers });
    const body = (await res.json()) as { statusCode: number; message: string };
    // Nunca se filtra una clave sin resolver ni un placeholder sin interpolar
    assert.doesNotMatch(body.message, /errors\.|PLAN_|\{\w+\}/);
    return { status: res.status, body };
  }

  const FEATURE: Record<string, string> = {
    es: 'El Punto de Venta (POS) está disponible desde el plan Growth. Actualiza tu plan en Suscripción.',
    en: 'The Point of Sale (POS) is available from the Growth plan. Upgrade your plan in Subscription.',
    fr: 'Le point de vente (POS) est disponible à partir du forfait Growth. Mettez à niveau votre forfait dans Abonnement.',
    zh: '销售点（POS）从 Growth 套餐起提供。请在“订阅”中升级套餐。',
  };
  const BRANCHES: Record<string, string> = {
    es: 'Tu plan Starter permite crear hasta 1 sucursal. Actualiza tu plan en Suscripción para agregar más sucursales.',
    en: 'Your Starter plan allows up to 1 branch. Upgrade your plan in Subscription to add more branches.',
    fr: "Votre forfait Starter permet de créer jusqu'à 1 boutique. Mettez à niveau votre forfait dans Abonnement pour en ajouter davantage.",
    zh: '你的 Starter 套餐最多可创建 1 家门店。请在“订阅”中升级套餐以添加更多门店。',
  };
  const PRODUCTS: Record<string, string> = {
    es: 'Tu plan Starter permite hasta 200 productos activos. Actualiza al plan Growth o superior para tener productos ilimitados.',
    en: 'Your Starter plan allows up to 200 active products. Upgrade to the Growth plan or higher for unlimited products.',
    fr: "Votre forfait Starter permet jusqu'à 200 produits actifs. Passez au forfait Growth ou supérieur pour des produits illimités.",
    zh: '你的 Starter 套餐最多可有 200 件在售商品。升级到 Growth 或更高套餐即可不限商品数量。',
  };

  for (const lang of ['es', 'en', 'fr', 'zh']) {
    it(`${lang}: funcionalidad no incluida (POS en Starter) → 403 con el plan necesario`, async () => {
      const { status, body } = await call('GET', 'pos', { 'accept-language': lang });
      assert.equal(status, 403);
      assert.equal(body.statusCode, 403);
      assert.equal(body.message, FEATURE[lang]);
    });

    it(`${lang}: tope de sucursales → 403 con el límite y el plan`, async () => {
      const { status, body } = await call('POST', 'branches', { 'accept-language': lang });
      assert.equal(status, 403);
      assert.equal(body.message, BRANCHES[lang]);
    });

    it(`${lang}: tope de productos activos → 403 con el límite y el plan sin tope`, async () => {
      const { status, body } = await call('POST', 'products', { 'accept-language': lang });
      assert.equal(status, 403);
      assert.equal(body.message, PRODUCTS[lang]);
    });
  }

  it('el plan que sí incluye la funcionalidad no se bloquea', async () => {
    const res = await fetch(`${base}/plan-test/pos`, { headers: { 'x-test-plan': 'growth' } });
    assert.equal(res.status, 200);
  });

  it('sin idioma o con uno no soportado responde en español', async () => {
    assert.equal((await call('GET', 'pos')).body.message, FEATURE.es);
    assert.equal((await call('GET', 'pos', { 'accept-language': 'de-DE,de;q=0.9' })).body.message, FEATURE.es);
    assert.equal((await call('POST', 'products', { 'x-lang': 'pt' })).body.message, PRODUCTS.es);
  });

  it('respeta ?lang= y x-lang, y las variantes regionales (en-US, zh-CN)', async () => {
    assert.equal((await call('GET', 'pos?lang=fr')).body.message, FEATURE.fr);
    assert.equal((await call('GET', 'pos', { 'x-lang': 'zh' })).body.message, FEATURE.zh);
    assert.equal((await call('GET', 'pos', { 'accept-language': 'en-US,en;q=0.9' })).body.message, FEATURE.en);
    assert.equal((await call('GET', 'pos', { 'accept-language': 'zh-CN' })).body.message, FEATURE.zh);
  });

  it('los 4 diccionarios tienen las mismas claves de plan y los mismos argumentos', () => {
    const dir = join(__dirname, '..', '..', 'src', 'i18n', 'locales');
    // { "PLAN_FEATURE.pos": "plan", "PLAN_BRANCH_LIMIT": "count,plan", ... } (plurales unidos por clave)
    const planKeys = (lang: string) => {
      const errors = JSON.parse(readFileSync(join(dir, lang, 'errors.json'), 'utf8')) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(errors)) {
        if (!key.startsWith('PLAN_') || key === 'PLAN_UNAVAILABLE') continue;
        const isPlural = typeof value === 'object' && value !== null && 'other' in value;
        const entries = typeof value === 'string' || isPlural ? [[key, value]] : Object.entries(value as object).map(([k, v]) => [`${key}.${k}`, v]);
        for (const [name, text] of entries as [string, unknown][]) {
          const texts = typeof text === 'string' ? [text] : Object.values(text as object).map(String);
          out[name] = [...new Set(texts.flatMap((t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',');
        }
      }
      return out;
    };
    const es = planKeys('es');
    assert.ok(Object.keys(es).length >= 16);
    for (const lang of ['en', 'fr', 'zh']) assert.deepEqual(planKeys(lang), es, lang);
  });

  it('el bloqueo de app móvil (lanzado en un middleware) también se traduce', async () => {
    const en = await call('GET', 'mobile', { 'accept-language': 'en' });
    assert.equal(en.status, 403);
    assert.equal(en.body.message, 'This store does not have the customer Mobile App enabled on its current plan (available from the Pro plan).');
    const zh = await call('GET', 'mobile?lang=zh');
    assert.equal(zh.body.message, '该店铺当前套餐未开通客户移动应用（Pro 套餐起提供）。');
    const es = await call('GET', 'mobile');
    assert.equal(es.body.message, 'Esta tienda no tiene habilitada la App Móvil para clientes en su plan actual (disponible desde el plan Pro).');
  });
});
