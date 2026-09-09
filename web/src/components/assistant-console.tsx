"use client";

import { useState, useTransition } from "react";
import { executeAssistantCommand, type AssistantResult } from "@/app/(product)/assistant/actions";
import { DataTable, RecordView } from "@/components/ui";

export function AssistantConsole() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<AssistantResult[]>([]);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = input;
    startTransition(async () => {
      const result = await executeAssistantCommand(command);
      setHistory((current) => [result, ...current].slice(0, 20));
      setInput("");
    });
  }

  return (
    <section className="assistantConsole" aria-labelledby="assistant-command-label">
      <form className="assistantPrompt" onSubmit={submit}>
        <label id="assistant-command-label" htmlFor="assistant-command">RIOS command</label>
        <div>
          <span aria-hidden="true">›</span>
          <input id="assistant-command" value={input} onChange={(event) => setInput(event.target.value)} placeholder="/help" autoComplete="off" spellCheck={false} disabled={pending} />
          <button type="submit" disabled={pending || input.trim().length === 0}>{pending ? "Running…" : "Execute"}</button>
        </div>
      </form>
      <p className="assistantBoundary">Deterministic operations assistant backed by explicit RIOS API commands.</p>
      <div className="assistantHistory" aria-live="polite">
        {history.length === 0 && <div className="empty">Enter <code>/help</code> to inspect the command boundary.</div>}
        {history.map((result, index) => (
          <article className="assistantResult" key={`${result.command}-${history.length - index}`}>
            <header><code>{result.command || "—"}</code><span className={`status status-${result.status === "ok" ? "ready" : "failed"}`}>{result.status}</span></header>
            <h2>{result.title}</h2>
            {result.message && <p className="assistantMessage">{result.message}</p>}
            {result.lines && <ul>{result.lines.map((line) => <li key={line}><code>{line}</code></li>)}</ul>}
            {Array.isArray(result.data)
              ? <DataTable rows={result.data as Record<string, unknown>[]} />
              : result.data
                ? <RecordView data={result.data as Record<string, unknown>} />
                : null}
          </article>
        ))}
      </div>
    </section>
  );
}
