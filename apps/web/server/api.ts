import { createProductionApi, toVercelHandler, type VercelHandler } from '@chronostasis/api';

let api: ReturnType<typeof createProductionApi> | undefined;
const handler: VercelHandler = toVercelHandler(async (request) => {
  api ??= createProductionApi(process.env);
  return api.handler(request);
});

export default handler;
