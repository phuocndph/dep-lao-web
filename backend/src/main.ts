import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000', credentials: true })
  app.useWebSocketAdapter(new IoAdapter(app))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
  const port = Number(process.env['PORT'] ?? 3001)
  await app.listen(port)
  console.log(`[backend] Server listening on http://localhost:${port}`)
}

bootstrap().catch(console.error)
