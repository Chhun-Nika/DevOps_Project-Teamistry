import type { Request, Response } from 'express';
import { z } from 'zod';

import { sendError } from './http-error';

const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number);
const pagination = z.object({
  page: positiveInteger.pipe(z.number().int().max(21_474_837)).optional().default(1),
  limit: positiveInteger.pipe(z.number().int().max(100)).optional().default(20),
});

export function readPage(request: Request, response: Response): z.infer<typeof pagination> | undefined {
  const parsed = pagination.safeParse(request.query);
  if (parsed.success) return parsed.data;
  sendError(response, 400, 'INVALID_INPUT', 'Provide a valid page number and a limit of 1 to 100.');
}

export function pageResult<T>(rows: T[], { page, limit }: z.infer<typeof pagination>) {
  return { items: rows.slice(0, limit), page, limit, hasMore: rows.length > limit };
}
