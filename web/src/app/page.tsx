import Link from "next/link";
import { auth0 } from "@/lib/auth0";

export default async function Home() {
  const session = await auth0.getSession();

  return (
    <main className="landing">
      <nav className="landingNav" aria-label="Primary navigation">
        <span className="wordmark">RIOS</span>
        {session ? <Link href="/dashboard">Open workspace ↗</Link> : <a href="/auth/login">Secure sign in ↗</a>}
      </nav>
      <section className="landingHero">
        <div className="heroCopy">
          <p className="eyebrow">Revenue Intelligence OS · 01</p>
          <h1>Financial operations with evidence.</h1>
          <p>Inspect contracts, trace payments and refunds, resolve reconciliation findings, and review the audit trail through one disciplined operational interface.</p>
          <div>{session ? <Link className="primaryLink" href="/dashboard">Open dashboard</Link> : <a className="primaryLink" href="/auth/login">Sign in with Auth0</a>}</div>
        </div>
        <aside className="heroAside" aria-label="Operating principle">
          <span className="heroIndex">Control surface / RIOS</span>
          <div>
            <blockquote>Every financial effect should be explainable.</blockquote>
            <p>Deterministic allocation, immutable records, and explicit operational evidence form the system’s foundation.</p>
          </div>
        </aside>
      </section>
      <section className="principles" aria-labelledby="principles-title">
        <p className="sectionLabel" id="principles-title">Operating principles</p>
        <div className="principleGrid">
          <article className="principle"><span>01</span><h2>Deterministic</h2><p>Every cent follows explicit allocation semantics.</p></article>
          <article className="principle"><span>02</span><h2>Auditable</h2><p>Financial effects and operator actions retain their history.</p></article>
          <article className="principle"><span>03</span><h2>Bounded</h2><p>Auth0 sessions stay server-side; the API remains authoritative.</p></article>
        </div>
      </section>
    </main>
  );
}
