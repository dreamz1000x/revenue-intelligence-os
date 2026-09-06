"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <section className="errorState"><p className="eyebrow">Request interrupted</p><h1>RIOS data could not be loaded.</h1><p>The API may be unavailable or your role may not permit this operation. No financial mutation was retried.</p><button onClick={reset}>Try again</button></section>; }
