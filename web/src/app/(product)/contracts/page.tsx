import { createContract } from "@/app/actions";
import { Empty, Lookup, PageHeader, RecordView } from "@/components/ui";
import { getPrincipal, riosFetch } from "@/lib/api";
import { hasRole } from "@/lib/roles";

export default async function Contracts({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams; const principal = await getPrincipal();
  const contract = id ? await riosFetch<Record<string, unknown>>(`/contracts/${encodeURIComponent(id)}`) : null;
  return <><PageHeader eyebrow="Contracts" title="Contract financial schedule" copy="Inspect immutable terms and the ordered installment projection owned by the backend."/><Lookup label="Contract ID"/>{contract?<RecordView data={contract}/>:<Empty>Enter a Contract ID to inspect its schedule.</Empty>}{hasRole(principal.roles,"operator")&&<section className="panel"><h2>Create financed contract</h2><form action={createContract} className="formGrid"><label>Customer ID<input name="customerId" type="number" min="1" required/></label><label>Total cents<input name="totalAmountCents" type="number" min="1" required/></label><label>Installments<input name="installmentCount" type="number" min="1" required/></label><label>First due date<input name="firstDueDate" type="date" required/></label><button>Create contract</button></form></section>}</>;
}
