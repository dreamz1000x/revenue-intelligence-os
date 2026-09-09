import { AssistantConsole } from "@/components/assistant-console";
import { PageHeader } from "@/components/ui";

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        eyebrow="Deterministic command surface"
        title="Operations assistant"
        copy="Explicit RIOS API commands with bounded parsing. No natural-language inference, generated analysis, or browser-owned financial logic."
      />
      <AssistantConsole />
    </>
  );
}
