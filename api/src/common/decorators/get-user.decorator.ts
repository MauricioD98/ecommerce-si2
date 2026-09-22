import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import request from 'supertest';

export const GetUser = createParamDecorator(
    (data: string| undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user;

        return data ? user?.[data] :user;
    },
)