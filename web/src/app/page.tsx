import Link from "next/link";
import { auth0 } from "@/lib/auth0";

export default async function Home() {
  const session = await auth0.getSession();
  return <main className="landing"><nav><span className="wordmark">RIOS</span>{session ? <Link href="/dashboard">Open workspace</Link> : <a href="/auth/login">Sign in</a>}</nav><section className="hero"><p className="eyebrow">Revenue Intelligence OS</p><h1>Financial operations with evidence, not guesswork.</h1><p>Inspect contracts, trace payments and refunds, resolve reconciliation findings, and review the audit trail through one disciplined operational interface.</p>{session ? <Link className="primary" href="/dashboard">Open dashboard</Link> : <a className="primary" href="/auth/login">Sign in with Auth0</a>}</section><section className="principles"><article><b>Deterministic</b><span>Every cent follows explicit allocation semantics.</span></article><article><b>Auditable</b><span>Financial effects and operator actions retain their history.</span></article><article><b>Bounded</b><span>Auth0 sessions stay server-side; the API remains authoritative.</span></article></section></main>;
}
