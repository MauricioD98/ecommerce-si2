import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  // rawBody: true deja el Buffer crudo en req.rawBody (necesario para validar la firma del webhook de Stripe)
  const app = await NestFactory.create(AppModule, { rawBody: true });
  //Project description

  app.setGlobalPrefix('api/v1');

  //Set Global validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted:true,
      transform: true,
      transformOptions:{
        enableImplicitConversion:true,
      },
    }),
  );

  //Enable CORS
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',')??'http://localhost:3000',
    credentials:true,
    methods: ['GET','POST','PUT','DELETE', 'PATCH','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','Accept'],
  });

  //Enable Swagger
  const config = new DocumentBuilder()
  .setTitle('API Documentation')
  .setDescription('API documentation for the application')
  .setVersion('1.0')
  .addTag('auth', 'Authentication related endpoints')

  .addBearerAuth({
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  name: 'JWT',
  description: 'Enter JWT token',
  in: 'header',
},
'JWT-auth',
)

.addBearerAuth({
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  name: 'Refresh-JWT',
  description: 'Enter refresh JWT token',
  in: 'header',
},
'JWT-refresh',
)
.addServer('http://localhost:3001', 'Development server')
.build();

  const document = SwaggerModule.createDocument(app,config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions:{
      persistAuthorization:true,
      tagsSorter:'alpha',
      operationSorter:'alpha',
    },
    customSiteTitle: 'API Documentation',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: `
    .swagger-ui .topbar {display: none}
    .swagger-ui .info { margin: 50px 0; }
    .swagger-ui .info .title {color: #4A90E2;}
    `,
  });

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap().catch((error)=>{
  Logger.error('Error starting server', error);
  process.exit(1);
});
