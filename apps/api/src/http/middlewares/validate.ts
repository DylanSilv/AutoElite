import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ValidationError } from '../../shared/errors.js';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function formatIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Valida el request en el borde. Ningún handler recibe datos sin validar, y los
 * valores parseados reemplazan a los crudos (con coerciones y defaults ya
 * aplicados).
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        // En Express 5 `req.query` es un getter sin setter.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new ValidationError('Datos inválidos', formatIssues(err)));
        return;
      }
      next(err);
    }
  };
}

/**
 * Lee la query ya validada con el tipo del esquema.
 *
 * `req.query` viene tipado como `ParsedQs` (todo string) porque Express no sabe
 * que `validate()` lo reemplazó por el resultado del parseo. Pasar el mismo
 * esquema acá evita que el tipo y la validación se desincronicen.
 */
export function validatedQuery<S extends ZodTypeAny>(req: Request, _schema: S): z.infer<S> {
  return req.query as unknown as z.infer<S>;
}

export type Validated<T extends ZodTypeAny> = z.infer<T>;
