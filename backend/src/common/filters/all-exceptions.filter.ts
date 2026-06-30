import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

/**
 * Глобальный фильтр исключений.
 * Любое необработанное исключение (включая 500) приводится
 * к единому формату: { statusCode, message, error }.
 *
 * NestJS HttpException:
 *   - getResponse() может быть строкой или объектом { message, error }
 * Обычные Error:
 *   - возвращаются как 500 Internal Server Error
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Внутренняя ошибка сервера';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        error = exception.name.replace('Exception', '');
      } else if (typeof res === 'object') {
        const body = res as ErrorBody;
        message = body.message ?? exception.message;
        error = body.error ?? exception.name.replace('Exception', '');
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = 'Внутренняя ошибка сервера';
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
    });
  }
}
