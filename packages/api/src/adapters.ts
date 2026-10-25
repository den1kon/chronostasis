import type {IncomingMessage, ServerResponse} from 'node:http';
import type {VercelRequest, VercelResponse} from '@vercel/node';
import {apiError} from './handler.js';

export type VercelHandler = (
  request: VercelRequest,
  response: VercelResponse,
) => Promise<void>;
export type ApiHandler = (request: Request) => Promise<Response>;
const MAX_BODY_BYTES = 64 * 1024;
class BodyTooLarge extends Error {}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const length = request.headers['content-length'];
  if (length && Number(length) > MAX_BODY_BYTES) {
    request.resume();
    throw new BodyTooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  // Early exit must not destroy the socket before the 413 response is sent.
  const stream: AsyncIterable<unknown> = request.iterator({
    destroyOnReturn: false,
  });
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('Invalid body chunk');
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new BodyTooLarge();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
async function dispatch(
  request: IncomingMessage,
  handler: ApiHandler,
  origin: string,
): Promise<Response> {
  let body: Buffer;
  try {
    body = await readBody(request);
  } catch (error) {
    if (error instanceof BodyTooLarge)
      return apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64 KiB', {
        Connection: 'close',
      });
    return apiError(400, 'BAD_REQUEST', 'Invalid request');
  }
  let webRequest: Request;
  try {
    const headers = new Headers();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (name !== undefined && value !== undefined)
        headers.append(name, value);
    }
    webRequest = new Request(new URL(request.url ?? '/', origin), {
      method: request.method ?? 'GET',
      headers,
      ...(body.length > 0 ? {body: Uint8Array.from(body).buffer} : {}),
    });
  } catch {
    return apiError(400, 'BAD_REQUEST', 'Invalid request');
  }
  return handler(webRequest);
}
export function toNodeHandler(handler: ApiHandler, origin: string) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      const result = await dispatch(request, handler, origin);
      response.statusCode = result.status;
      result.headers.forEach((value, name) => {
        response.setHeader(name, value);
      });
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(
        '{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}',
      );
    }
  };
}
export function toVercelHandler(handler: ApiHandler): VercelHandler {
  return (request: VercelRequest, response: VercelResponse): Promise<void> => {
    const protocol =
      request.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https';
    return toNodeHandler(
      handler,
      `${protocol}://${request.headers.host ?? 'localhost'}`,
    )(request, response);
  };
}
