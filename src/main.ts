import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import { AppModule } from './app.module.js'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  app.useWebSocketAdapter(new IoAdapter(app))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
  const port = Number(process.env['PORT'] ?? 3000)
  await app.listen(port)
  console.log(`Server listening on port ${port}`)
}

bootstrap().catch(console.error)
