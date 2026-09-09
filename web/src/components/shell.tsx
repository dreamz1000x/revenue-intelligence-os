import Link from "next/link";
import type { Principal } from "@/lib/api";
import { hasRole } from "@/lib/roles";
import { ShellNavigation } from "@/components/shell-navigation";

export function Shell({ principal, children }: { principal: Principal; children: React.ReactNode }) {
  return (
    <div className="appShell">
      <aside className="shellAside">
        <Link href="/dashboard" className="shellBrand">
          <span className="brandMark">RIOS</span>
          <small>Revenue Intelligence OS</small>
        </Link>
        <ShellNavigation canAudit={hasRole(principal.roles, "admin")} />
        <footer className="shellFooter">
          <p>{principal.roles.join(" · ")}</p>
          <a href="/auth/logout">Sign out</a>
        </footer>
      </aside>
      <main className="shellMain"><div className="page">{children}</div></main>
    </div>
  );
}
