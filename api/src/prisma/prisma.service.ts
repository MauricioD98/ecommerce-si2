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
