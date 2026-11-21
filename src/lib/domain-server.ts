import "server-only";
import { cookies } from "next/headers";
import { DOMAIN_COOKIE, toDomain, type Domain } from "./domains";

/** Kho đang chọn trên web (cookie). Gọi trong Server Component / Action / Route Handler. */
export async function currentDomain(): Promise<Domain> {
  return toDomain((await cookies()).get(DOMAIN_COOKIE)?.value);
}
