"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAdmin, signOut } = useAuth();

  const navigation = [
    {
      href: "/chat",
      label: "Chat",
      icon: MessageSquareText,
      visible: true,
    },
    {
      href: "/admin",
      label: "Admin",
      icon: LayoutDashboard,
      visible: isAdmin,
    },
  ].filter((item) => item.visible);

  async function handleSignOut() {
    try {
      await signOut();
      toast.success("Sesión cerrada");
      router.replace("/login");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo cerrar la sesión",
      );
    }
  }

  return (
    <aside className="surface-panel mx-4 mt-4 flex flex-col rounded-[2rem] p-5 lg:sticky lg:top-4 lg:mx-0 lg:my-4 lg:min-h-[calc(100vh-2rem)]">
      <div>
        <div className="section-kicker eyebrow-dot">Atlas Knowledge</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Console
        </h1>
        <p className="text-muted mt-3 max-w-xs text-sm leading-6">
          Chat autenticado, fuentes visibles y control administrativo sobre el
          backend Express.
        </p>
      </div>

      <nav aria-label="Navegación principal" className="mt-8 space-y-2">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center justify-between rounded-2xl px-4 py-3 text-sm transition-colors",
                active
                  ? "surface-highlight text-white"
                  : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {label}
              </span>
              {active ? <Badge variant="accent">Activo</Badge> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-4 pt-8">
        <div className="surface-soft rounded-[1.75rem] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">
                {user?.email || "Sesión activa"}
              </p>
              <p className="text-muted mt-1 text-xs">
                {isAdmin ? "Rol administrador" : "Rol operador"}
              </p>
            </div>
            <Badge variant={isAdmin ? "accent" : "default"}>
              {isAdmin ? "Admin" : "User"}
            </Badge>
          </div>
        </div>

        <Button
          className="w-full justify-between"
          variant="secondary"
          onClick={handleSignOut}
        >
          Salir
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}
