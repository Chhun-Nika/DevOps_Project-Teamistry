import { randomUUID } from 'node:crypto';

import type { Response } from 'express';

export function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message }, requestId: randomUUID() });
}
