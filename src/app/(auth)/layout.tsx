import Link from "next/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2.5 text-lg font-bold tracking-tight">
        <Logo className="size-10" />
        Kho đồ
      </Link>
      <div className="card w-full max-w-sm p-6 shadow-sm">{children}</div>
    </div>
  );
}
