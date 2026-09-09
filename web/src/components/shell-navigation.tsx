"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links: readonly (readonly [string, string])[] = [
  ["Overview", "/dashboard"],
  ["Customers", "/customers"],
  ["Contracts", "/contracts"],
  ["Payments", "/payments"],
  ["Refunds", "/refunds"],
  ["Reconciliation", "/reconciliation"],
  ["Operations", "/operations"],
  ["Assistant", "/assistant"],
];

export function ShellNavigation({ canAudit }: { canAudit: boolean }) {
  const pathname = usePathname();
  const items: readonly (readonly [string, string])[] = canAudit ? [...links, ["Audit", "/audit"]] : links;

  return (
    <details className="navMenu" open>
      <summary>Navigation</summary>
      <nav className="shellNav" aria-label="Workspace navigation">
        {items.map(([name, href]) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined}>{name}</Link>;
        })}
      </nav>
    </details>
  );
}
