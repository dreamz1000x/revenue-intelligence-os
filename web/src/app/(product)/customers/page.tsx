import { createCustomer } from "@/app/actions";
import { Empty, Lookup, PageHeader, RecordView } from "@/components/ui";
import { getPrincipal, riosFetch } from "@/lib/api";
import { hasRole } from "@/lib/roles";

export default async function Customers({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams; const principal = await getPrincipal();
  const customer = id ? await riosFetch<Record<string, unknown>>(`/customers/${encodeURIComponent(id)}`) : null;
  return <><PageHeader eyebrow="Customers" title="Customer inspector" copy="Look up a customer by its durable RIOS identifier. Operators can create a new customer without expanding the API into broad CRUD."/><Lookup label="Customer ID"/>{customer ? <RecordView data={customer}/> : <Empty>Enter a Customer ID to inspect a record.</Empty>}{hasRole(principal.roles,"operator")&&<section className="panel"><h2>Create customer</h2><form action={createCustomer} className="formGrid"><label>Display name<input name="displayName" maxLength={200} required/></label><button type="submit">Create customer</button></form></section>}</>;
}
