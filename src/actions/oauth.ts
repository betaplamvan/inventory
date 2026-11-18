"use server";

import { redirect } from "next/navigation";
import type { TokenScope } from "@/lib/auth/api-tokens";
import { buildRedirect, createAuthCode, getClient, issuer, redirectUriAllowed } from "@/lib/auth/oauth";
import { requireUser } from "@/lib/auth/session";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v ? v : null;
};

/** Kiểm tra lại toàn bộ yêu cầu (form có thể bị sửa) trước khi chuyển hướng về client */
async function validated(fd: FormData) {
  const me = await requireUser();
  const client = await getClient(str(fd, "client_id"));
  const redirectUri = str(fd, "redirect_uri");
  if (!client || !redirectUri || !redirectUriAllowed(client, redirectUri)) {
    throw new Error("Yêu cầu uỷ quyền không hợp lệ");
  }
  return { me, client, redirectUri, state: str(fd, "state") };
}

/** Người dùng bấm "Cho phép" → tạo authorization code và trả về redirect_uri của client */
export async function approveOAuth(fd: FormData) {
  const { me, client, redirectUri, state } = await validated(fd);
  const codeChallenge = str(fd, "code_challenge");
  if (!codeChallenge) throw new Error("Thiếu code_challenge (PKCE)");
  const scope: TokenScope = fd.get("scope") === "read" ? "read" : "write";
  const code = await createAuthCode({ clientId: client.id, userId: me.id, redirectUri, codeChallenge, scope });
  redirect(buildRedirect(redirectUri, { code, state, iss: issuer() }));
}

export async function denyOAuth(fd: FormData) {
  const { redirectUri, state } = await validated(fd);
  redirect(buildRedirect(redirectUri, { error: "access_denied", error_description: "Người dùng từ chối", state, iss: issuer() }));
}
