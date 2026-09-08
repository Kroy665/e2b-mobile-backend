import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { sandboxIdParamSchema } from './sandboxes.schemas';
import { serverPortParamSchema, startServerSchema } from './servers.schemas';
import * as serversService from './servers.service';

export const serversRouter = Router({ mergeParams: true });

serversRouter.post(
  '/',
  validate({ params: sandboxIdParamSchema, body: startServerSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await serversService.startServer(req.user.id, id, req.body);
    res.status(StatusCodes.CREATED).json({ data: result });
  })
);

serversRouter.get(
  '/',
  validate({ params: sandboxIdParamSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await serversService.listServers(req.user.id, id);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

serversRouter.delete(
  '/:port',
  validate({ params: serverPortParamSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id, port } = req.params as unknown as { id: string; port: number };
    const result = await serversService.stopServer(req.user.id, id, port);
    res.status(StatusCodes.OK).json({ data: result });
  })
);
