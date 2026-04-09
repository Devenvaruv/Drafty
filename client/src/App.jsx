import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

const API_BASE = "http://localhost:4001";

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [profile, setProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      setLoading(true);
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
  }

  function connectOutlook() {
    window.location.href = `${API_BASE}/auth/microsoft/start`;
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
                {selectedMessage.from?.emailAddress?.name} (
                {selectedMessage.from?.emailAddress?.address})
              </p>
              <div
                className="messageBody"
                dangerouslySetInnerHTML={{
                  __html: selectedMessage.body?.content || "",
                }}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;