import {UserResponseSchema, type PublicUser} from '@chronostasis/contracts';

export interface ApiDependencies {
  authenticate(request: Request): Promise<{clerkUserId: string} | null>;
  ensureUser(clerkUserId: string): Promise<PublicUser>;
  findUser(clerkUserId: string): Promise<PublicUser | null>;
  probe(): Promise<void>;
}
export function apiError(
  status: number,
  code: string,
  message: string,
  headers?: Readonly<Record<string, string>>,
): Response {
  return Response.json(
    {error: {code, message}},
    {status, headers: {'Cache-Control': 'no-store', ...headers}},
  );
}
export function createApiHandler(deps: ApiDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path !== '/api/health' && path !== '/api/me')
        return apiError(404, 'NOT_FOUND', 'Not found');
      const allowed = path === '/api/health' ? ['GET'] : ['GET', 'POST'];
      if (!allowed.includes(request.method))
        return apiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', {
          Allow: allowed.join(', '),
        });
      if (path === '/api/health') {
        try {
          await deps.probe();
        } catch {
          return apiError(503, 'UNAVAILABLE', 'Service unavailable');
        }
        return Response.json(
          {status: 'ok'},
          {headers: {'Cache-Control': 'no-store'}},
        );
      }
      const identity = await deps.authenticate(request);
      if (!identity)
        return apiError(401, 'UNAUTHORIZED', 'Authentication required');
      const user =
        request.method === 'POST'
          ? await deps.ensureUser(identity.clerkUserId)
          : await deps.findUser(identity.clerkUserId);
      if (!user) return apiError(404, 'NOT_FOUND', 'Not found');
      return Response.json(UserResponseSchema.parse({user}), {
        headers: {'Cache-Control': 'no-store'},
      });
    } catch {
      return apiError(500, 'INTERNAL_ERROR', 'Internal server error');
    }
  };
}
