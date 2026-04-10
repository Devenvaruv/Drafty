import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API_BASE = "http://localhost:4001";
const AI_API_BASE = "http://localhost:4000";

const REPLY_AGENT_SLUGS = {
  post_meeting: {
    professional: "post_meeting_professional",
    friendly: "post_meeting_friendly",
    inquisitive: "post_meeting_inquisitive",
  },
  follow_up: {
    professional: "follow_up_professional",
    friendly: "follow_up_friendly",
    inquisitive: "follow_up_inquisitive",
  },
  vague_request: {
    professional: "vague_request_professional",
    friendly: "vague_request_friendly",
    inquisitive: "vague_request_inquisitive",
  },
};

const VALID_REPLY_TYPES = new Set([
  "vague_request",
  "follow_up",
  "post_meeting",
]);

function parseResultObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getClassifierType(result) {
  const directType = typeof result?.type === "string" ? result.type : "";
  if (VALID_REPLY_TYPES.has(directType)) return directType;

  const wrappedType =
    typeof result?.result?.type === "string" ? result.result.type : "";
  if (VALID_REPLY_TYPES.has(wrappedType)) return wrappedType;

  const outputType =
    typeof result?.output?.type === "string" ? result.output.type : "";
  if (VALID_REPLY_TYPES.has(outputType)) return outputType;

  const nestedType =
    typeof result?.output?.result?.type === "string"
      ? result.output.result.type
      : "";
  if (VALID_REPLY_TYPES.has(nestedType)) return nestedType;

  const parsed =
    parseResultObject(result?.reply) ||
    parseResultObject(result?.message) ||
    parseResultObject(result?.output?.text) ||
    parseResultObject(result?.text);

  if (VALID_REPLY_TYPES.has(parsed?.type)) return parsed.type;

  return "vague_request";
}

function getGeneratedReply(result) {
  if (typeof result?.reply === "string" && result.reply.trim()) {
    return result.reply;
  }

  if (typeof result?.result?.reply === "string" && result.result.reply.trim()) {
    return result.result.reply;
  }

  if (typeof result?.output?.reply === "string" && result.output.reply.trim()) {
    return result.output.reply;
  }

  if (
    typeof result?.output?.result?.reply === "string" &&
    result.output.result.reply.trim()
  ) {
    return result.output.result.reply;
  }

  const parsed =
    parseResultObject(result?.message) ||
    parseResultObject(result?.output?.text) ||
    parseResultObject(result?.text);

  if (typeof parsed?.reply === "string" && parsed.reply.trim()) {
    return parsed.reply;
  }

  if (typeof result?.draft === "string" && result.draft.trim()) {
    return result.draft;
  }

  if (typeof result?.message === "string" && result.message.trim()) {
    return result.message;
  }

  if (typeof result?.output?.text === "string" && result.output.text.trim()) {
    return result.output.text;
  }

  return "Hi,\n\nThis is a placeholder generated reply.\n\nBest,";
}

function stripHtml(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.innerText.trim();
}

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [profile, setProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [error, setError] = useState("");
  const [tone, setTone] = useState("professional");
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      setLoading(true);
      setError("");

      const statusRes = await axios.get(`${API_BASE}/auth/microsoft/status`, {
        withCredentials: true,
      });

      setAuthenticated(statusRes.data.authenticated);

      if (statusRes.data.authenticated) {
        await Promise.all([loadProfile(), loadMessages()]);
      }
    } catch (err) {
      setError("Failed to check auth status");
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile() {
    const res = await axios.get(`${API_BASE}/me`, {
      withCredentials: true,
    });
    setProfile(res.data);
  }

  async function loadMessages() {
    const res = await axios.get(`${API_BASE}/outlook/messages`, {
      withCredentials: true,
    });
    setMessages(res.data);
  }

  async function openMessage(id) {
    try {
      setLoadingMessage(true);
      setError("");
      setDraft("");

      const res = await axios.get(`${API_BASE}/outlook/messages/${id}`, {
        withCredentials: true,
      });

      setSelectedMessage(res.data);
    } catch (err) {
      setError("Failed to load message");
    } finally {
      setLoadingMessage(false);
    }
  }

  async function logout() {
    await axios.get(`${API_BASE}/auth/logout`, {
      withCredentials: true,
    });

    setAuthenticated(false);
    setProfile(null);
    setMessages([]);
    setSelectedMessage(null);
    setDraft("");
    setError("");
  }

  function connectOutlook() {
    window.location.href = `${API_BASE}/auth/microsoft/start`;
  }

  async function callAgent(agentSlug, message) {
    const res = await axios.post(`${AI_API_BASE}/chat`, {
      agentSlug,
      message,
    });

    return res.data;
  }

  async function generateDraft() {
    if (!selectedMessage) return;

    try {
      setGenerating(true);
      setError("");

      const subject = selectedMessage.subject || "";
      const fromName = selectedMessage.from?.emailAddress?.name || "";
      const fromAddress = selectedMessage.from?.emailAddress?.address || "";
      const bodyHtml = selectedMessage.body?.content || "";
      const bodyText = stripHtml(bodyHtml);

      const emailChainText = [
        subject ? `Subject: ${subject}` : "",
        fromName || fromAddress
          ? `From: ${fromName}${fromAddress ? ` <${fromAddress}>` : ""}`
          : "",
        "",
        bodyText,
      ]
        .filter(Boolean)
        .join("\n");

      const classifierResult = await callAgent("email_classifier", emailChainText);
      const replyType = getClassifierType(classifierResult);
      const replyAgentSlug =
        REPLY_AGENT_SLUGS[replyType]?.[tone] || "vague_request_professional";

      const result = await callAgent(replyAgentSlug, emailChainText);
      const generatedText = getGeneratedReply(result);

      setDraft(generatedText);
    } catch (err) {
      console.error("Generate draft failed:", err);
      setError("Failed to generate draft");
      setDraft("Hi,\n\nThis is a fallback reply because the API call failed.\n\nBest,");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <div className="page">Loading...</div>;
  }

  if (!authenticated) {
    return (
      <div className="page">
        <div className="card">
          <h1>Outlook Draft UI</h1>
          <p>Connect your Outlook / Microsoft 365 account to continue.</p>
          <button onClick={connectOutlook}>Connect Outlook</button>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h2>Outlook Draft UI</h2>
          {profile && (
            <p>
              Connected as <strong>{profile.displayName}</strong>
            </p>
          )}
        </div>
        <button onClick={logout}>Logout</button>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="layout">
        <aside className="sidebar">
          <h3>Inbox</h3>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="messageItem"
              onClick={() => openMessage(msg.id)}
            >
              <strong>{msg.subject || "(No subject)"}</strong>
              <p>{msg.from?.emailAddress?.name || "Unknown sender"}</p>
              <small>{msg.bodyPreview}</small>
            </div>
          ))}
        </aside>

        <main className="main">
          {loadingMessage && <p>Loading message...</p>}

          {!loadingMessage && !selectedMessage && (
            <p>Select an email from the inbox.</p>
          )}

          {!loadingMessage && selectedMessage && (
            <div className="card">
              <h3>{selectedMessage.subject || "(No subject)"}</h3>

              <p>
                <strong>From:</strong>{" "}
                {selectedMessage.from?.emailAddress?.name || "Unknown"} (
                {selectedMessage.from?.emailAddress?.address || "No address"})
              </p>

              <div
                className="messageBody"
                dangerouslySetInnerHTML={{
                  __html: selectedMessage.body?.content || "",
                }}
              />

              <div style={{ marginTop: "24px" }}>
                <h4>Generate Draft</h4>

                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "center",
                    marginBottom: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid #d1d5db",
                    }}
                  >
                    <option value="professional">Professional</option>
                    <option value="friendly">Friendly</option>
                    <option value="inquisitive">Inquisitive</option>
                  </select>

                  <button onClick={generateDraft} disabled={generating}>
                    {generating ? "Generating..." : "Generate Draft"}
                  </button>
                </div>

                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Generated draft will appear here..."
                  style={{
                    width: "100%",
                    minHeight: "220px",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid #d1d5db",
                    resize: "vertical",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    fontSize: "14px",
                    lineHeight: "1.5",
                  }}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;