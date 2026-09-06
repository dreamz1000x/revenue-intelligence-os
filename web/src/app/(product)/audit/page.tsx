import { notFound } from "next/navigation";
import { DataTable, PageHeader } from "@/components/ui";
import { getPrincipal, riosFetch } from "@/lib/api";
import { hasRole } from "@/lib/roles";
export default async function Audit(){const principal=await getPrincipal();if(!hasRole(principal.roles,"admin"))notFound();const events=await riosFetch<Record<string,unknown>[]>("/audit/events?limit=100");return <><PageHeader eyebrow="Admin only" title="Authenticated audit trail" copy="Successful authenticated mutation commands. Opaque deduplication identities are deliberately omitted from presentation."/><DataTable rows={events}/></>}
