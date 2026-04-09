require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 4001;

app.use(express.json());

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, 
      sameSite: "lax",
    },
  })
);

function getScopes() {
  return [
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Mail.ReadWrite",
  ];
}

app.get("/auth/microsoft/start", (req, res) => {
  const scopes = [
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Mail.ReadWrite"
  ];

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
    response_mode: "query",
    scope: scopes.join(" ")
  });

  const authUrl = `${process.env.MICROSOFT_AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
  res.redirect(authUrl);
});

app.get("/test", (req, res) => {
  res.send("backend is working");
});

app.get("/auth/microsoft/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {

    const scopes = [
      "offline_access",
      "User.Read",
      "Mail.Read",
      "Mail.ReadWrite"
    ];
    
    const tokenParams = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
      scope: getScopes().join(" "),
    });

    const tokenResponse = await axios.post(
      `${process.env.MICROSOFT_AUTHORITY}/oauth2/v2.0/token`,
      tokenParams.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    req.session.microsoft = {
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token || null,
      expiresIn: tokenResponse.data.expires_in,
    };

    res.redirect(`${process.env.CLIENT_URL}/`);
  } catch (error) {
    console.error(
      "Token exchange failed:",
      error.response?.data || error.message
    );
    res.status(500).send("Microsoft auth failed");
  }
});

app.get("/auth/microsoft/status", (req, res) => {
  const authenticated = !!req.session?.microsoft?.accessToken;
  res.json({ authenticated });
});

app.get("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

async function getGraphMe(accessToken) {
  const response = await axios.get("https://graph.microsoft.com/v1.0/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.data;
}

app.get("/me", async (req, res) => {
  const accessToken = req.session?.microsoft?.accessToken;

  if (!accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const me = await getGraphMe(accessToken);
    res.json(me);
  } catch (error) {
    console.error("Graph /me failed:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.get("/outlook/messages", async (req, res) => {
  const accessToken = req.session?.microsoft?.accessToken;

  if (!accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const response = await axios.get(
      "https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=id,subject,from,receivedDateTime,bodyPreview",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    res.json(response.data.value);
  } catch (error) {
    console.error(
      "Graph messages failed:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.get("/outlook/messages/:id", async (req, res) => {
  const accessToken = req.session?.microsoft?.accessToken;

  if (!accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Graph message detail failed:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch message" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});