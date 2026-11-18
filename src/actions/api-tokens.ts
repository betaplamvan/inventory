"use server";

import { revalidatePath } from "next/cache";
import { createApiToken, revokeApiToken, type TokenScope } from "@/lib/auth/api-tokens";
import { requireUser } from "@/lib/auth/session";

export type CreateTokenState = { ok?: boolean; error?: string; token?: string; name?: string; scope?: TokenScope } | null;

export async function createToken(_prev: CreateTokenState, fd: FormData): Promise<CreateTokenState> {
  const me = await requireUser();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Đặt tên để nhận ra token, ví dụ \"Claude Code laptop\"" };
  const scope: TokenScope = fd.get("scope") === "read" ? "read" : "write";
  const days = Number(fd.get("expires"));
  const { token } = await createApiToken(me.id, name, scope, Number.isFinite(days) && days > 0 ? days : null);
  revalidatePath("/account");
  return { ok: true, token, name, scope };
}

export async function revokeToken(id: string) {
  const me = await requireUser();
  await revokeApiToken(me.id, id);
  revalidatePath("/account");
}
