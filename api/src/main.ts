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
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir peticiones sin Origin (como apps móviles, curl, o SSR)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes('*') ||
        origin.includes('azurecontainerapps.io') ||
        origin.includes('localhost')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma', 'Expires', 'X-Requested-With'],
  });

  // Deshabilitar caché del navegador/proxies para respuestas dinámicas (stock, precios, órdenes)
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
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
