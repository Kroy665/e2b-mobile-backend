import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { Provider, providerParamSchema, setProviderKeySchema } from './ai-provider.schemas';
import * as aiProviderService from './ai-provider.service';

export const aiProviderRouter = Router();

aiProviderRouter.use(requireAuth);

aiProviderRouter.put(
  '/',
  validate({ body: setProviderKeySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    await aiProviderService.setProviderKey(req.user.id, req.body.provider, req.body.apiKey);
    res.status(StatusCodes.OK).json({ data: { message: 'Provider key saved' } });
  })
);

aiProviderRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const providers = await aiProviderService.listProviders(req.user.id);
    res.status(StatusCodes.OK).json({ data: providers });
  })
);

aiProviderRouter.delete(
  '/:provider',
  validate({ params: providerParamSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { provider } = req.params as unknown as { provider: Provider };
    await aiProviderService.deleteProviderKey(req.user.id, provider);
    res.status(StatusCodes.OK).json({ data: { message: 'Provider key removed' } });
  })
);
