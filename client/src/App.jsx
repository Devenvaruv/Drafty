import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API_BASE = "http://localhost:4001";
const AI_API_BASE = "http://localhost:4000";

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "inquisitive", label: "Inquisitive" },
];

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

function getSender(message) {
  return {
    name: message?.from?.emailAddress?.name || "Unknown sender",
    address: message?.from?.emailAddress?.address || "",
  };
}

function getPreview(text) {
  if (!text) return "No preview available.";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
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
    async function checkAuth() {
      try {
        setLoading(true);
        setError("");

        const statusRes = await axios.get(`${API_BASE}/auth/microsoft/status`, {
          withCredentials: true,
        });

        setAuthenticated(statusRes.data.authenticated);

        if (statusRes.data.authenticated) {
          const [profileRes, messagesRes] = await Promise.all([
            axios.get(`${API_BASE}/me`, {
              withCredentials: true,
            }),
            axios.get(`${API_BASE}/outlook/messages`, {
              withCredentials: true,
            }),
          ]);

          setProfile(profileRes.data);
          setMessages(messagesRes.data);
        }
      } catch {
        setError("Failed to check auth status");
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, []);

  async function openMessage(id) {
    try {
      setLoadingMessage(true);
      setError("");
      setDraft("");

      const res = await axios.get(`${API_BASE}/outlook/messages/${id}`, {
        withCredentials: true,
      });

      setSelectedMessage(res.data);
    } catch {
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

  const selectedMessageId = selectedMessage?.id;
  const selectedSender = getSender(selectedMessage);
  const profileName = profile?.displayName || "Microsoft 365 account";
  const profileEmail = profile?.mail || profile?.userPrincipalName || "";

  if (loading) {
    return (
      <div className="page">
        <div className="centerShell">
          <div className="authCard">
            <p className="eyebrow">Preparing</p>
            <h1>Draft Assistant</h1>
            <p className="supportingText">Loading your workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="page">
        <div className="centerShell">
          <div className="authCard">
            <p className="eyebrow">Outlook drafts</p>
            <h1>Draft Assistant</h1>
            <p className="supportingText">
              Connect your Outlook or Microsoft 365 account to load your inbox
              and generate replies.
            </p>
            <button type="button" className="button buttonPrimary" onClick={connectOutlook}>
              Connect Outlook
            </button>
            {error && <div className="errorBanner">{error}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="appShell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Draft your Emails</p>
            <h1>Drafty AI</h1>
            
          </div>

          <div className="accountBlock">
            <span className="accountLabel">Connected as</span>
            <strong>{profileName}</strong>
            {profileEmail && <span className="accountEmail">{profileEmail}</span>}
            <button type="button" className="button buttonSecondary" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        {error && <div className="errorBanner">{error}</div>}

        <div className="layout">
          <aside className="panel sidebar">
            <div className="sectionHeader">
              <div>
                <h2>Inbox</h2>
                <p>{messages.length} message{messages.length === 1 ? "" : "s"}</p>
              </div>
            </div>

            <div className="messageList">
              {messages.length === 0 ? (
                <div className="emptyBox">No messages available.</div>
              ) : (
                messages.map((msg) => {
                  const sender = getSender(msg);
                  const isActive = selectedMessageId === msg.id;

                  return (
                    <button
                      key={msg.id}
                      type="button"
                      className={`messageItem${isActive ? " isActive" : ""}`}
                      onClick={() => openMessage(msg.id)}
                    >
                      <span className="messageSubject">
                        {msg.subject || "(No subject)"}
                      </span>
                      <span className="messageSender">{sender.name}</span>
                      <span className="messagePreview">
                        {getPreview(msg.bodyPreview)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <main className="main">
            {loadingMessage && (
              <div className="panel statePanel">
                <h2>Loading message</h2>
                <p>Fetching the full email thread...</p>
              </div>
            )}

            {!loadingMessage && !selectedMessage && (
              <div className="panel statePanel">
                <h2>Select an email</h2>
                <p></p>
              </div>
            )}

            {!loadingMessage && selectedMessage && (
              <div className="detailStack">
                <section className="panel detailCard">
                  <div className="detailHeader">
                    <div>
                      <p className="eyebrow">Message</p>
                      <h2>{selectedMessage.subject || "(No subject)"}</h2>
                    </div>

                    <div className="metaBlock">
                      <span className="accountLabel">From</span>
                      <strong>{selectedSender.name}</strong>
                      <span className="accountEmail">
                        {selectedSender.address || "No address"}
                      </span>
                    </div>
                  </div>

                  <div className="messageBodyWrap">
                    <div
                      className="messageBody"
                      dangerouslySetInnerHTML={{
                        __html: selectedMessage.body?.content || "",
                      }}
                    />
                  </div>
                </section>

                <section className="panel composerCard">
                  <div className="composerHeader">
                    <div>
                      <p className="eyebrow">Reply draft</p>
                      <h2>Compose response</h2>
                    </div>

                    <button
                      type="button"
                      className="button buttonPrimary"
                      onClick={generateDraft}
                      disabled={generating}
                    >
                      {generating ? "Generating..." : "Generate Draft"}
                    </button>
                  </div>

                  <div className="toneGroup" role="radiogroup" aria-label="Tone">
                    {TONE_OPTIONS.map((option) => {
                      const isActive = tone === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`toneChip${isActive ? " isActive" : ""}`}
                          onClick={() => setTone(option.value)}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>

                  <textarea
                    className="draftInput"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Generated draft will appear here..."
                  />
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
