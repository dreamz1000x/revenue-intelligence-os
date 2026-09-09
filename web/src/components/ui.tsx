import Link from "next/link";
import { formatEuro, formatUtc } from "@/lib/format";

export function PageHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className="pageHeader"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></header>;
}

export function Lookup({ label = "Record ID" }: { label?: string }) {
  return <form className="lookup"><label>{label}<input name="id" inputMode="numeric" pattern="[1-9][0-9]*" required /></label><button type="submit">Inspect</button></form>;
}

export function Empty({ children }: { children: React.ReactNode }) { return <div className="empty" role="status">{children}</div>; }

export function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value.replaceAll("_", " ")}</span>; }

function Value({ name, value }: { name: string; value: unknown }) {
  if (typeof value === "number" && /Cents$/.test(name)) return <>{formatEuro(value)}</>;
  if (typeof value === "string" && /(At|Date|cutoff|asOf)$/i.test(name)) return <>{formatUtc(value)}</>;
  if (value === null || value === undefined) return <>—</>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  return <>{String(value)}</>;
}

export function RecordView({ data }: { data: Record<string, unknown> }) {
  const scalars = Object.entries(data).filter(([, value]) => !Array.isArray(value) && (typeof value !== "object" || value === null));
  const arrays = Object.entries(data).filter(([, value]) => Array.isArray(value)) as [string, Record<string, unknown>[]][];
  return <article className="record"><dl>{scalars.map(([name, value]) => <div key={name}><dt>{label(name)}</dt><dd>{name === "status" && typeof value === "string" ? <Status value={value} /> : <Value name={name} value={value} />}</dd></div>)}</dl>{arrays.map(([name, rows]) => <section key={name}><h2>{label(name)}</h2>{rows.length ? <DataTable rows={rows} /> : <Empty>No {label(name).toLowerCase()} recorded.</Empty>}</section>)}</article>;
}

export function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <Empty>No records found.</Empty>;
  const keys = Object.keys(rows[0] ?? {}).filter((key) => !["deduplicationKey", "fingerprint", "runFingerprint", "rawPayload"].includes(key));
  return <div className="tableWrap"><table><thead><tr>{keys.map((key) => <th key={key}>{label(key)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{keys.map((key) => <td key={key}>{key === "status" && typeof row[key] === "string" ? <Status value={row[key]} /> : typeof row[key] === "object" && row[key] !== null ? JSON.stringify(row[key]) : <Value name={key} value={row[key]} />}</td>)}</tr>)}</tbody></table></div>;
}

export function Metric({ label: text, cents, value }: { label: string; cents?: number; value?: number | string }) { return <article className="metric"><p className="metricLabel">{text}</p><strong className="metricValue">{cents === undefined ? value : formatEuro(cents)}</strong></article>; }
export function BackLink() { return <Link className="backLink" href="/dashboard">← Overview</Link>; }
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (match) => match.toUpperCase());
