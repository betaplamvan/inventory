import { appBaseUrl } from "@/lib/auth/constants";

/** Nội dung QR in trên nhãn: link ngắn (quét bằng camera thường cũng mở được), xem src/app/s/[kind]/[id] */
export const itemLabelUrl = (id: number) => `${appBaseUrl()}/s/i/${id}`;
export const locationLabelUrl = (id: number) => `${appBaseUrl()}/s/l/${id}`;

/** Số nhãn tối đa mỗi lần in */
export const MAX_LABELS = 300;
