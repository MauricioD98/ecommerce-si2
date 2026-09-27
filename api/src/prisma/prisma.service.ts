import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {

    constructor() {
        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL,
        });

        super({
           adapter,
           // El default de Prisma es timeout 5s / maxWait 2s, y la base es remota (Neon): cada ida y
           // vuelta cuesta cientos de ms, así que una venta de POS de 5 líneas se pasaba de 5000 ms
           // dentro de la transacción y Prisma la abortaba con P2028 → el cliente veía un 500 pelado.
           // Subirlo es la red de seguridad; el arreglo de verdad es hacer menos queries adentro
           // (ver PosService.checkout e InventoryService.syncGlobalStockMany).
           transactionOptions: {
             maxWait: 10000,
             timeout: 20000,
           },
           log:
            process.env.NODE_ENV === 'development'
                ? ['query', 'error', 'warn']
                : ['error'],
        });
     
    }

    async onModuleInit() {
        await this.$connect();
        console.log('Connected to the database successfully!');
    }

    async onModuleDestroy() {
        await this.$disconnect();
        console.log('Disconnected from the database successfully!');
    }

    async cleanDatabase() {
        if (process.env.NODE_ENV === 'production') {
             throw new Error('Cannot clean database in production mode');
            }
        const models =Reflect.ownKeys(this).filter(
            (key) => typeof key === 'string' && !key.startsWith('_'),
        );

        return Promise.all(
            models.map((modelkey) =>{
                if(typeof modelkey === 'string'){
                    return this[modelkey].deleteMany();
                }
            }),
        );
    }
} 
