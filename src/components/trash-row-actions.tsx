"use client";

import { useActionState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { purgeItem, restoreItem, type RestoreResult } from "@/actions/trash";
import { ConfirmButton, SubmitButton } from "./confirm-button";

export function TrashRowActions({ id, name }: { id: number; name: string }) {
  // Khôi phục thành công thì server action chuyển thẳng sang trang mặt hàng; ở đây chỉ hiện lỗi
  const [state, restore] = useActionState<RestoreResult | null>(restoreItem.bind(null, id), null);

  return (
    <div className="flex flex-col gap-1 pl-15 sm:items-end sm:pl-0">
      <div className="flex gap-2">
        <form action={restore}>
          <SubmitButton className="btn-secondary btn-sm">
            <RotateCcw className="size-3.5" /> Khôi phục
          </SubmitButton>
        </form>
        <form action={purgeItem.bind(null, id)}>
          <ConfirmButton
            className="btn-ghost btn-sm hover:text-danger"
            title="Xoá hẳn"
            message={`Xoá hẳn "${name}" cùng toàn bộ ảnh / video và lịch sử? Không thể hoàn tác.`}
          >
            <Trash2 className="size-3.5" /> Xoá hẳn
          </ConfirmButton>
        </form>
      </div>
      {state && !state.ok && <p className="text-xs text-danger">{state.error}</p>}
    </div>
  );
}
