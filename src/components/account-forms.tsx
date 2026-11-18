"use client";

import { useActionState } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { deleteAccount, logoutOtherDevices, type FormState } from "@/actions/auth";
import { SubmitButton } from "./confirm-button";

export function LogoutOthersForm({ otherSessions }: { otherSessions: number }) {
  const [state, action] = useActionState<FormState, FormData>(logoutOtherDevices, null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">
        {state?.ok ? state.message : `Đang đăng nhập trên ${otherSessions} thiết bị khác.`}
      </p>
      {!state?.ok && otherSessions > 0 && (
        <SubmitButton className="btn-secondary">
          <LogOut className="size-4" /> Đăng xuất thiết bị khác
        </SubmitButton>
      )}
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action] = useActionState(deleteAccount, null);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted">
        Xoá vĩnh viễn tài khoản cùng <b>toàn bộ</b> mặt hàng, ảnh/video, danh mục, vị trí và lịch sử. Không thể hoàn
        tác. Gõ <span className="font-mono text-foreground">{email}</span> để xác nhận.
      </p>
      <div className="flex flex-wrap gap-2">
        <input name="confirmEmail" className="input max-w-xs" placeholder={email} autoComplete="off" />
        <SubmitButton className="btn-danger">
          <Trash2 className="size-4" /> Xoá tài khoản
        </SubmitButton>
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}
