// import { createParamDecorator, ExecutionContext } from '@nestjs/common';
// import { UserPayload } from '../../modules/auth/interfaces/auth.interface';

// export const CurrentUser = createParamDecorator(
//   (data: keyof UserPayload | 'id' | unknown, ctx: ExecutionContext) => {
//     const request = ctx.switchToHttp().getRequest();
//     const user = request.user as UserPayload;
//     if (!user) return null;

//     if (data === 'id') {
//       return user._id ?? (user as any).sub ?? (user as any).userId ?? (user as any).id;
//     }

//     return data ? user[data as keyof UserPayload] : user;
//   },
// );
