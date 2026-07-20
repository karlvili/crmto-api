import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSION_KEY = 'requiredPermission';
export const RequirePermission = (perm: Permission) => SetMetadata(PERMISSION_KEY, perm);
