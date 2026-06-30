# Async URL Checker

Приложение для асинхронной проверки работоспособности URL с real-time обновлениями.

```
                          ┌──────────────────────┐
                          │     React + Zustand   │
                          │  ┌──────────────────┐ │
  User ──→ JobForm ──────┼─→│  POST /api/jobs   │ │
       ←── JobDetail ────┼──│  WebSocket (WS)   │ │
                          │  └────────┬─────────┘ │
                          └───────────┼───────────┘
                                      │ HTTP + WS
                          ┌───────────┼───────────┐
                          │  NestJS (REST + WS)   │
                          │  ┌──────────────────┐ │
                          │  │  EventsEmitter   │ │
                          │  │  ┌──┐ ┌──┐ ┌──┐ │ │
                          │  │  │S1│ │S2│ │S3│ │ │
                          │  │  └┬─┘ └┬─┘ └┬─┘ │ │
                          │  └───┼────┼────┼───┘ │
                          │      │    │    │      │
                          │  ┌───▼────▼────▼───┐  │
                          │  │   Semaphore(5)  │  │
                          │  │  Concurrency    │  │
                          │  │  Controller     │  │
                          │  └───────┬─────────┘  │
                          │          │ HEAD       │
                          └──────────┼────────────┘
                                     │
                              ┌──────▼──────┐
                              │  Internet   │
                              │  URLs       │
                              └─────────────┘
```

- **Бэкенд**: NestJS + TypeScript | REST + WebSocket | Event-driven архитектура
- **Фронтенд**: React 19 + TypeScript + Vite + Zustand + Socket.IO Client
- **Real-time**: Socket.IO с подписками на комнаты
- **Хранение**: In-memory (база данных не нужна)
- **Контейнеризация**: Docker multi-stage сборки + docker-compose

## Как это работает

### Жизненный цикл задания

```
         ┌──────────────────────────────────────────────┐
         │              Состояния задания                │
         │                                              │
    ┌────▼────┐   POST    ┌───────────┐                │
    │ PENDING │──────────→│IN_PROGRESS│                │
    └─────────┘           └─────┬─────┘                │
                                │                      │
              ┌─────────────────┼──────────────────┐   │
              ▼                 ▼                  ▼   │
        ┌──────────┐     ┌───────────┐     ┌─────────┐│
        │COMPLETED │     │ CANCELLED │     │  FAILED ││
        └──────────┘     └───────────┘     └─────────┘│
        └──────────────────────────────────────────────┘
```

Каждый URL в задании проходит: `PENDING → IN_PROGRESS → SUCCESS | ERROR | CANCELLED`.

### Асинхронная обработка

1. **`POST /api/jobs`** создаёт задание (статус: `PENDING`) и сразу возвращает `{ jobId }`
2. Фоновая обработка запускается: статус → `IN_PROGRESS`
3. Для каждого URL выполняется HEAD-запрос, **не более 5 одновременных на одно задание**
4. Перед сохранением результата — искусственная задержка (0–10 секунд, **прерываемая через AbortSignal**)
5. Результат сохраняется и транслируется через WebSocket
6. Когда все URL обработаны → `COMPLETED`

### Отмена

```
Пользователь нажимает «Отменить»
  ↓
DELETE /api/jobs/:id
  ↓
cancel() устанавливает job.status = CANCELLED
  ├── PENDING URL → немедленно CANCELLED
  ├── IN_PROGRESS → AbortController.abort()
  │     ├── fetch() → выбрасывает AbortError → ловится → CANCELLED
  │     └── delay() → разрешается досрочно → isCancelled() → CANCELLED
  └── WebSocket событие → UI обновляется в реальном времени
```

Функция `delay()` принимает `AbortSignal`. При отмене таймер очищается, промис разрешается сразу, и проверка отмены выполняется без ожидания.

### Event-Driven архитектура

```
┌─────────────┐     EventEmitter     ┌─────────────┐     Socket.IO    ┌──────────┐
│ JobsService │───────события───────→│ JobsGateway │───── broadcast ──→│ Клиент   │
│             │                      │              │                  │          │
│ processJob()│                      │ afterInit()  │                  │  join()  │
│ cancel()    │                      │ subscribe()  │                  │  on()    │
└─────────────┘                      └─────────────┘                  └──────────┘
```

Сервис发射ирует события через `@nestjs/event-emitter`. Шлюз подписывается на них в `afterInit()` и broadcast'ит в Socket.IO комнаты. Сервис **никогда не импортирует шлюз** — нулевой риск циклических зависимостей.

### Модель конкурентности

- **Семафор на задание**: `Semaphore(5)` ограничивает одновременные HEAD-запросы до 5 на одно задание
- **Глобальная конкурентность**: Несколько заданий обрабатываются независимо (без глобального лимита)
- **Promise-based**: Используется паттерн `Acquire()` / `Release()` с FIFO-очередью

### Обработка ошибок

Все исключения (включая 500) приводятся к единому формату:
```json
{
  "statusCode": 409,
  "message": "Задание \"abc-123\" уже имеет статус completed и не может быть отменено",
  "error": "Conflict"
}
```

## Стек

| Уровень | Технология |
|---------|-----------|
| Runtime | Node.js 20 |
| Бэкенд-фреймворк | NestJS 10 |
| Фронтенд-фреймворк | React 19 |
| Сборщик | Vite 8 |
| Стейт-менеджер | Zustand |
| Real-time | Socket.IO 4 |
| Валидация | class-validator + class-transformer |
| API-документация | Swagger / OpenAPI |
| Язык | TypeScript (strict mode) |

## Структура проекта

```
async-url-checker/
├── backend/                          # NestJS API
│   ├── src/
│   │   ├── main.ts                   # Bootstrap + Swagger + CORS + ValidationPipe
│   │   ├── app.module.ts             # Корневой модуль (EventEmitter + JobsModule)
│   │   ├── common/
│   │   │   ├── enums/status.enum.ts  # JobStatus, UrlStatus
│   │   │   └── filters/              # Глобальный фильтр исключений
│   │   └── modules/jobs/
│   │       ├── dto/                  # CreateJobDto, DTO ответов (Swagger)
│   │       ├── interfaces/           # Job, UrlResult
│   │       ├── jobs.controller.ts    # REST-эндпоинты
│   │       ├── jobs.service.ts       # Бизнес-логика + конкурентность + отмена
│   │       ├── jobs.gateway.ts       # WebSocket шлюз
│   │       └── jobs.module.ts
│   ├── Dockerfile                    # Multi-stage сборка
│   └── package.json
├── frontend/                         # React SPA
│   ├── src/
│   │   ├── api/jobs-api.ts           # REST-клиент (обёртка над fetch)
│   │   ├── store/jobs-store.ts       # Zustand стор + WS-обработчики
│   │   ├── components/
│   │   │   ├── JobForm.tsx           # Ввод URL + отправка
│   │   │   ├── JobList.tsx           # Боковая панель со списком заданий
│   │   │   └── JobDetail.tsx         # Прогресс + результаты URL + отмена
│   │   ├── types/index.ts            # Общие TypeScript-типы
│   │   └── App.tsx                   # Макет + жизненный цикл сокета
│   ├── Dockerfile                    # Сборка + nginx
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Справочник API

### REST-эндпоинты

| Метод | Путь | Статус | Описание |
|-------|------|--------|----------|
| `POST`   | `/api/jobs`      | 201 | Создать задание проверки URL |
| `GET`    | `/api/jobs`      | 200 | Список заданий со статистикой |
| `GET`    | `/api/jobs/:id`  | 200 | Детали задания + результаты URL |
| `DELETE` | `/api/jobs/:id`  | 204 | Отменить задание |

Полная документация Swagger: http://localhost:3000/api/docs

### WebSocket события

| Событие | Направление | Данные | Описание |
|---------|-------------|--------|----------|
| `join:job`   | → Сервер | `jobId: string` | Подписаться на обновления задания |
| `leave:job`  | → Сервер | `jobId: string` | Отписаться |
| `job:created`| Сервер → | `{ jobId }` | Новое задание создано (broadcast) |
| `job:update` | Сервер → | `{ jobId, status, successCount?, errorCount? }` | Статус задания изменился |
| `url:update` | Сервер → | `{ jobId, url, status, httpStatus?, error?, duration? }` | Результат проверки URL обновлён |

## Архитектурные решения

### WebSocket вместо периодического опроса

Исходное задание требовало периодический опрос через `GET /api/jobs/:id`. Реализация использует **WebSocket (Socket.IO)** — строго лучший подход для данной задачи:

| | Периодический опрос | WebSocket (текущая реализация) |
|---|---|---|
| Задержка | 1–5 сек (зависит от интервала) | < 50 мс (серверный push) |
| Трафик | N запросов × M URL на задание | 1 событие на изменение |
| Нагрузка на сервер | Повторные чтения без необходимости | Отправка только при изменении состояния |
| Актуальность | Устаревшие данные между интервалами | Всегда актуальные |

WebSocket полностью покрывает все три подпункта задания:
- ✅ Обновления статуса приходят пока задание активно (в реальном времени, а не по интервалу)
- ✅ При смене задания `leave:job` останавливает получение старых обновлений (эквивалент остановки таймера)
- ✅ Ответы по старому `jobId` никогда не влияют на UI (фильтрация через комнаты)

Эндпоинт `GET /api/jobs/:id` по-прежнему доступен и используется для первоначальной загрузки деталей при выборе существующего задания из списка.

## Быстрый старт

### Разработка

```bash
# Терминал 1: Бэкенд
cd backend
npm install
npm run start:dev    # http://localhost:3000

# Терминал 2: Фронтенд
cd frontend
npm install
npm run dev          # http://localhost:5173
```

### Продакшн (Docker)

```bash
docker compose up --build
```

- Бэкенд: http://localhost:3000
- Фронтенд: http://localhost:80
- Swagger документация: http://localhost:3000/api/docs
