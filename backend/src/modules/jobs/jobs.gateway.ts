import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Типы данных, передаваемые через EventEmitter.
 * Gateway подписывается на события из сервиса и транслирует их в Socket.IO комнаты.
 */
interface JobUpdatePayload {
  jobId: string;
  status: string;
  successCount?: number;
  errorCount?: number;
}

interface UrlUpdatePayload {
  jobId: string;
  url: string;
  status: string;
  httpStatus?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
}

/**
 * WebSocket-шлюз для real-time уведомлений.
 *
 * Архитектура:
 *   JobsService → EventEmitter → JobsGateway → Socket.IO → Клиент
 *
 * Сервис не зависит от шлюза — он только эмитит события.
 * Шлюз подписывается на события в afterInit() и транслирует их
 * в соответствующие Socket.IO комнаты.
 *
 * Клиенты присоединяются/покидают комнаты через сообщения:
 *   «join:job» {jobId}  — подписаться на обновления задания
 *   «leave:job» {jobId} — отписаться
 *
 * Это гарантирует, что ответы по старому jobId не меняют состояние интерфейса
 * при переключении между заданиями.
 */
@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:4173'],
    credentials: true,
  },
  namespace: '/',
})
export class JobsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * После инициализации шлюза подписываемся на события сервиса.
   * Используем EventEmitter (не прямой вызов из сервиса), чтобы
   * избежать циклических зависимостей и сохранить слабую связанность.
   */
  afterInit(): void {
    // Новое задание создано — оповещаем всех клиентов (broadcast)
    this.eventEmitter.on('job.created', (payload: { jobId: string }) => {
      this.server.emit('job:created', payload);
    });

    // Статус задания изменился — оповещаем только подписчиков комнаты
    this.eventEmitter.on('job.updated', (payload: JobUpdatePayload) => {
      this.server.to(payload.jobId).emit('job:update', payload);
    });

    // Результат проверки URL — оповещаем подписчиков комнаты
    this.eventEmitter.on('job.url.updated', (payload: UrlUpdatePayload) => {
      this.server.to(payload.jobId).emit('url:update', payload);
    });
  }

  handleConnection(client: Socket): void {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    console.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Клиент подписывается на обновления конкретного задания.
   * Socket.IO добавляет клиента в комнату с именем jobId.
   * Все последующие сообщения для этого jobId приходят только участникам комнаты.
   */
  @SubscribeMessage('join:job')
  handleJoinJob(client: Socket, jobId: string): void {
    client.join(jobId);
    console.log(`Client ${client.id} joined job room: ${jobId}`);
  }

  /**
   * Клиент отписывается от обновлений.
   * Важно: при переключении на другое задание фронтенд отправляет leave:job
   * для старого, чтобы ответы по нему не обновляли интерфейс.
   */
  @SubscribeMessage('leave:job')
  handleLeaveJob(client: Socket, jobId: string): void {
    client.leave(jobId);
    console.log(`Client ${client.id} left job room: ${jobId}`);
  }
}
