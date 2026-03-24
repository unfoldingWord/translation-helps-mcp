import { useCallback, useEffect, useState } from "react";
import "./App.css";

const DEFAULT_MCP =
  import.meta.env.VITE_MCP_URL ?? "https://tc-helps.mcp.servant.bible/api/mcp";

type ChatRow = { role: "user" | "assistant"; text: string };

type HealthPayload = {
  openaiKeyConfigured: boolean;
  mcpDefaultUrl: string;
  mcpUrlChecked: string;
  mcpReachable: boolean;
  mcpError?: string;
  model: string;
};

async function fetchHealth(mcpUrl: string): Promise<HealthPayload | null> {
  const q = new URLSearchParams();
  if (mcpUrl.trim()) q.set("mcpUrl", mcpUrl.trim());
  const r = await fetch(`/api/health?${q.toString()}`);
  if (!r.ok) return null;
  return (await r.json()) as HealthPayload;
}

export function App() {
  const [mcpUrl, setMcpUrl] = useState(DEFAULT_MCP);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshHealth = useCallback(async () => {
    setHealthError(null);
    try {
      const h = await fetchHealth(mcpUrl);
      if (!h) {
        setHealth(null);
        setHealthError(
          "Could not reach /api/health. Is the dev server running?",
        );
        return;
      }
      setHealth(h);
    } catch (e) {
      setHealth(null);
      setHealthError(e instanceof Error ? e.message : String(e));
    }
  }, [mcpUrl]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    if (!health?.openaiKeyConfigured) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "OPENAI_API_KEY is not configured on the API server. Add it to the repo root `.env` (see root `.env.example`) and restart `npm run dev`.",
        },
      ]);
      return;
    }

    setBusy(true);
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);

    const prior = messages.map((row) => ({
      role: row.role,
      content: row.text,
    }));

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          mcpUrl: mcpUrl.trim(),
          messages: prior,
        }),
      });
      const data = (await r.json()) as { reply?: string; error?: string };
      if (!r.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: data.error ?? `HTTP ${r.status}` },
        ]);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", text: data.reply ?? "" }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const openaiOk = health?.openaiKeyConfigured === true;
  const mcpOk = health?.mcpReachable === true;

  return (
    <div className="app">
      <header className="header">
        <h1>OpenAI + Translation Helps MCP</h1>
        <p className="subtitle">
          Chat via local API (<code>/api/chat</code>) · MCP on the server with
          plain <code>fetch</code> (no browser SDK)
        </p>
      </header>

      <section className="panel">
        <label className="label">
          MCP URL
          <input
            className="input"
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void refreshHealth()}
        >
          Check MCP
        </button>
        <span className={`pill ${openaiOk ? "ai-ready" : "ai-unavailable"}`}>
          OpenAI key: {openaiOk ? "configured" : "missing"}
        </span>
        <span className={`pill mcp-${mcpOk ? "ready" : "error"}`}>
          MCP:{" "}
          {healthError
            ? healthError
            : mcpOk
              ? "reachable"
              : (health?.mcpError ?? "unchecked")}
        </span>
        {health && (
          <span className="pill">
            Model: <code>{health.model}</code>
          </span>
        )}
      </section>

      <div className="chat">
        {messages.length === 0 && (
          <p className="hint">
            Try: &quot;What does JHN 3:16 say in English?&quot; or &quot;List
            translation notes for TIT 1:1 in Spanish.&quot;
          </p>
        )}
        {messages.map((row, i) => (
          <div key={i} className={`msg ${row.role}`}>
            <span className="role">
              {row.role === "user" ? "You" : "Assistant"}
            </span>
            <pre className="body">{row.text}</pre>
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          className="textarea"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message…"
          disabled={busy}
        />
        <button
          type="button"
          className="btn primary"
          onClick={() => void send()}
          disabled={busy}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
