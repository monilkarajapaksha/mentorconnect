import type { Admin } from '@calllog/shared';

export interface Env {
  DB: D1Database;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { admin: Admin; sessionId: string };
};
