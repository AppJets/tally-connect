// src/common/decorators/subscription.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Subscription } from '../../activation/entities/subscription.entity';
import { ApiCredential } from '../../activation/entities/api-credential.entity';

/** Pulls the authenticated subscription off the request (set by ApiKeyGuard) */
export const ActiveSubscription = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Subscription => {
    const req = ctx.switchToHttp().getRequest();
    return req.subscription;
  },
);

/** Pulls the authenticated credential off the request (set by ApiKeyGuard) */
export const ActiveCredential = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiCredential => {
    const req = ctx.switchToHttp().getRequest();
    return req.credential;
  },
);
