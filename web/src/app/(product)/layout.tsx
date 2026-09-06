import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/api";
import { auth0 } from "@/lib/auth0";
import { Shell } from "@/components/shell";

export default async function ProductLayout({ children }: { children: React.ReactNode }) {
  if (!(await auth0.getSession())) redirect("/auth/login");
  const principal = await getPrincipal();
  return <Shell principal={principal}>{children}</Shell>;
}
