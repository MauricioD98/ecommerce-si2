import './env';
import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { AppModule } from '../../../src/app.module';
import { ValidationFailedException } from '../../../src/i18n/i18n-exception.filter';
import { runInTenant } from '../../../src/tenancy/tenant-context';
import { acceptanceDatabaseUrl } from './env';

export const TENANT_A = { tenantId: '11111111-1111-4111-8111-111111111111', schemaName: 'tenant_11111111111141118111111111111111' };
export const TENANT_B = { tenantId: '22222222-2222-4222-8222-222222222222', schemaName: 'tenant_22222222222242228222222222222222' };

export const inTenantA = <T>(fn: () => Promise<T>) => runInTenant(TENANT_A, fn);
export const inTenantB = <T>(fn: () => Promise<T>) => runInTenant(TENANT_B, fn);

// Barrera determinista para fijar un intercalado concreto entre dos operaciones
export function barrier() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

export async function bootApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error'] } as never);
  (app as unknown as { set(k: string, v: unknown): void }).set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => new ValidationFailedException(errors),
    }),
  );
  await app.listen(0, '127.0.0.1');
  return app;
}

export async function withSql<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: acceptanceDatabaseUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export interface Fixture {
  roleId: string;
  categoryId: string;
  branchA: string;
  branchB: string;
}

// Filas mínimas de una tienda
export async function seedTenant(schema: string): Promise<Fixture> {
  return withSql(async (c) => {
    const s = `"${schema}"`;
    const existing = await c.query(`SELECT id FROM ${s}.roles WHERE name='CLIENTE'`);
    const roleId: string = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows[0]) {
      await c.query(`INSERT INTO ${s}.roles (id,name,permissions,"updatedAt") VALUES ($1,'CLIENTE','{}',now())`, [roleId]);
    }
    const categoryId = randomUUID();
    await c.query(`INSERT INTO ${s}.categories (id,name,slug,"updatedAt") VALUES ($1,'Cat',$2,now())`, [categoryId, `cat-${categoryId}`]);
    const [branchA, branchB] = [randomUUID(), randomUUID()];
    for (const [id, name] of [[branchA, 'A'], [branchB, 'B']]) {
      await c.query(`INSERT INTO ${s}.branches (id,name,"updatedAt") VALUES ($1,$2,now())`, [id, name]);
    }
    return { roleId, categoryId, branchA, branchB };
  });
}

export async function createUser(schema: string, fx: Fixture, overrides: { permissions?: string[] } = {}): Promise<string> {
  return withSql(async (c) => {
    const s = `"${schema}"`;
    const id = randomUUID();
    let roleId = fx.roleId;
    if (overrides.permissions) {
      roleId = randomUUID();
      await c.query(`INSERT INTO ${s}.roles (id,name,permissions,"updatedAt") VALUES ($1,$2,$3,now())`, [roleId, `R-${roleId}`, overrides.permissions]);
    }
    await c.query(`INSERT INTO ${s}.users (id,email,password,"roleId","updatedAt") VALUES ($1,$2,'x',$3,now())`, [id, `${id}@test.local`, roleId]);
    return id;
  });
}

export async function createProduct(
  schema: string,
  fx: Fixture,
  stock: Record<string, Record<string, number>>,
  price = 100,
): Promise<string> {
  return withSql(async (c) => {
    const s = `"${schema}"`;
    const id = randomUUID();
    const sizes = [...new Set(Object.values(stock).flatMap((bySize) => Object.keys(bySize)))];
    const total = Object.values(stock).flatMap((bySize) => Object.values(bySize)).reduce((a, b) => a + b, 0);
    await c.query(
      `INSERT INTO ${s}.products (id,name,sizes,price,stock,sku,"categoryId","updatedAt") VALUES ($1,'P',$2,$3,$4,$5,$6,now())`,
      [id, sizes, price, total, `SKU-${id}`, fx.categoryId],
    );
    for (const [branchId, bySize] of Object.entries(stock)) {
      for (const [size, qty] of Object.entries(bySize)) {
        await c.query(
          `INSERT INTO ${s}.product_inventories (id,size,stock,"productId","branchId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())`,
          [randomUUID(), size, qty, id, branchId],
        );
      }
    }
    return id;
  });
}

export async function stockOf(schema: string, productId: string, branchId: string, size: string) {
  return withSql(async (c) => {
    const { rows } = await c.query(
      `SELECT stock,"damagedStock" FROM "${schema}".product_inventories WHERE "productId"=$1 AND "branchId"=$2 AND size=$3`,
      [productId, branchId, size],
    );
    return rows[0] ? { stock: rows[0].stock as number, damaged: rows[0].damagedStock as number } : null;
  });
}

export const key = () => randomUUID();

// Cliente HTTP real contra una instancia de la API (en proceso o réplica). La IP varía para no chocar con el throttler.
let ipCounter = 0;
export class Api {
  constructor(
    readonly baseUrl: string,
    readonly tenantId: string,
    readonly token?: string,
  ) {}

  as(token: string, tenantId = this.tenantId): Api {
    return new Api(this.baseUrl, tenantId, token);
  }

  async call(method: string, path: string, options: { body?: unknown; key?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
    ipCounter += 1;
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      signal: options.signal,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': this.tenantId,
        'x-forwarded-for': `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`,
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(options.key ? { 'idempotency-key': options.key } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  addToCart(productId: string, quantity: number, size: string, branchId: string) {
    return this.call('POST', '/cart/items', { body: { productId, quantity, size, branchId } });
  }

  async cartVersion(): Promise<number> {
    return (await this.call('GET', '/cart')).body.version;
  }

  createOrder(options: { key: string; cartVersion: number; items: { productId: string; quantity: number; size: string }[]; branchId: string; [k: string]: unknown }) {
    const { key: idempotencyKey, ...body } = options;
    return this.call('POST', '/orders', { key: idempotencyKey, body: { fulfillmentType: 'PICKUP', ...body } });
  }
}

export function apiFor(app: INestApplication, tenantId: string, userId?: string, permissions: string[] = []): Promise<Api> {
  return app.getUrl().then((url) => {
    const base = url.replace('[::1]', '127.0.0.1');
    return new Api(base, tenantId, userId ? tokenFor(app, userId, tenantId, permissions) : undefined);
  });
}

export async function count(schema: string, table: string, where: string, params: unknown[] = []): Promise<number> {
  return withSql<number>(async (c) => {
    const { rows } = await c.query(`SELECT count(*)::int n FROM "${schema}".${table} WHERE ${where}`, params as never[]);
    return rows[0].n as number;
  });
}

export async function queryRows<T = any>(sqlText: string, params: unknown[] = []): Promise<T[]> {
  return withSql<T[]>(async (c) => (await c.query(sqlText, params as never[])).rows as T[]);
}

// Conservación exacta: stock actual + retenido en reservas vivas + vendido en órdenes vivas = lo inicial
export async function assertConservation(schema: string, productId: string, initial: number): Promise<void> {
  const [{ available }] = await queryRows(`SELECT COALESCE(SUM(stock),0)::int available FROM "${schema}".product_inventories WHERE "productId"=$1`, [productId]);
  const [{ held }] = await queryRows(
    `SELECT COALESCE(SUM(quantity),0)::int held FROM "${schema}".stock_reservations WHERE "productId"=$1 AND status IN ('ACTIVE','CONSUMED')`,
    [productId],
  );
  const [{ aggregate }] = await queryRows(`SELECT stock::int aggregate FROM "${schema}".products WHERE id=$1`, [productId]);
  if (available + held !== initial) throw new Error(`Unidades no conservadas: disponibles ${available} + retenidas ${held} != ${initial}`);
  if (aggregate !== available) throw new Error(`Agregado desfasado: ${aggregate} != ${available}`);
  if (available < 0) throw new Error('Stock negativo');
}

export function tokenFor(app: INestApplication, userId: string, tenantId: string, permissions: string[] = []) {
  return app.get(JwtService, { strict: false }).sign(
    { sub: userId, email: `${userId}@test.local`, role: 'CLIENTE', permissions, tenantId },
    { secret: process.env.JWT_SECRET, expiresIn: 3600 },
  );
}

// Réplica real de la API en otro proceso: la corrección no puede depender de memoria compartida
export async function spawnReplica(port: number, extraEnv: Record<string, string> = {}): Promise<{ url: string; child: ChildProcess; stop(): Promise<void> }> {
  const main = join(__dirname, '..', '..', '..', 'src', 'main.js');
  const child = spawn(process.execPath, [main], {
    cwd: join(__dirname, '..', '..', '..', '..'),
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i += 1) {
    if (child.exitCode !== null) throw new Error(`La réplica terminó al arrancar: ${stderr.slice(-800)}`);
    const ok = await fetch(`${url}/api/v1`).then(() => true).catch(() => false);
    if (ok) break;
    if (i === 239) throw new Error(`La réplica no arrancó: ${stderr.slice(-800)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    url,
    child,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}
