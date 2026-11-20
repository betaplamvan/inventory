import { and, eq, isNull } from "drizzle-orm";
import { items } from "@/db/schema";

/** Mặt hàng chưa nằm trong thùng rác */
export const liveItem = isNull(items.deletedAt);

/** Mặt hàng của user và chưa nằm trong thùng rác — điều kiện mặc định cho mọi truy vấn / thao tác kho */
export const liveItemOf = (userId: string) => and(eq(items.userId, userId), liveItem)!;
