import Link from "next/link";
import type { Principal } from "@/lib/api";
import { hasRole } from "@/lib/roles";

const links = [
  ["Overview", "/dashboard"], ["Customers", "/customers"], ["Contracts", "/contracts"],
  ["Payments", "/payments"], ["Refunds", "/refunds"], ["Reconciliation", "/reconciliation"],
  ["Operations", "/operations"],
] as const;

export function Shell({ principal, children }: { principal: Principal; children: React.ReactNode }) {
  return <div className="appShell"><aside><Link href="/dashboard" className="brand"><span>RIOS</span><small>Revenue Intelligence OS</small></Link><nav>{links.map(([name, href]) => <Link key={href} href={href}>{name}</Link>)}{hasRole(principal.roles, "admin") && <Link href="/audit">Audit</Link>}</nav><footer><span className="role">{principal.roles.join(" · ")}</span><a href="/auth/logout">Sign out</a></footer></aside><main>{children}</main></div>;
}
