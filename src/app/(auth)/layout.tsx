import Link from "next/link";
import { Cpu } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="grid size-9 place-items-center rounded-lg bg-accent text-white dark:text-black">
          <Cpu className="size-5" />
        </span>
        Kho linh kiện
      </Link>
      <div className="card w-full max-w-sm p-6 shadow-sm">{children}</div>
    </div>
  );
}
