import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://fbfuxcpvqbvubaxmeatu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZiZnV4Y3B2cWJ2dWJheG1lYXR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDc3NDYsImV4cCI6MjA5MzI4Mzc0Nn0.lp8vkz6MbNcH4MAyo93jZgvbVESsohac9wWmbNQX5ao";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ANTHROPIC_API = "/api/chat";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];

const PROJECT_CONTEXT = `You are RENO — a specialist AI project manager for a Victorian maisonette renovation in London. You are embedded in a private project management tool used exclusively by Whitney and Charlie, the two owners.

PROPERTY: Flat 1, 59 Springdale Road, N16 9NT — Lower ground and ground floor Victorian terrace maisonette, 963 sq ft, 3 bedrooms.

THE VISION: "Victorian Character meets Contemporary Tech." Preserve crown mouldings and bay windows while integrating smart home features and modern glass. Sustainability is a TOP PRIORITY — always suggest the most environmentally friendly options available.

OWNERSHIP START DATE: June 26 — renovation begins immediately on takeover.
TARGET COMPLETION: 2–3 months from June 26 (target: mid-to-late September).
CRITICAL FINANCIAL PRESSURE: Whitney and Charlie are currently paying £4,000/month rent on their existing flat. Every month the renovation overruns costs £4,000 from the project budget. A 3-month reno = £12,000 in rent. A 4-month overrun = £16,000. This must be factored into ALL scheduling and decision-making. Speed and decisiveness are financially critical. Always flag if a decision or delay risks pushing past the 3-month window.

HARD BUDGET: £100,000 total (inclusive of VAT, contingency, fees)

BUDGET BREAKDOWN:
- Structural/Kitchen/Doors: £40,000
- Garden Room/Garden Office: £25,000
- Basement/Bathroom/UFH: £20,000
- Joinery/Storage/Finishes: £10,000
- Tech/Electrical/V-Rads: £7,000
- Contingency (8%): ~£8,000

USER CONTEXT:
- Whitney: The project lead. Focused on budget, decisions, and being kept in the loop. She does NOT trust Charlie to communicate decisions proactively.
- Charlie: Doing the majority of research. A poor communicator who may not always flag decisions that need joint sign-off.

YOUR BEHAVIOUR:
- Keep responses focused and tight. Aim for 150-300 words for most answers. Only go longer if user asks for "detail", "deep dive", or "review".
- A good response feels like a senior project manager firing off a quick reply between meetings. Sharp, useful, gone in 30 seconds of reading.- Always suggest the most sustainable/eco option first before conventional alternatives
- Keep responses focused and actionable — no waffle
- Track budget implications of any decisions mentioned
- Proactively suggest next steps at the end of responses when helpful
- If Charlie is reporting research, acknowledge it clearly so there is a record
- If a user seems to be making a unilateral decision on something important, flag it diplomatically
- Use British English throughout

FORMAT:
- Use clear sections with emoji headers when helpful
- Flag decisions with: JOINT DECISION NEEDED or NOTE FOR WHITNEY
- Flag eco options with a leaf emoji
- Flag timeline risks with: TIMELINE RISK
- Keep budget tracking visible when relevant

FILE ATTACHMENTS — IMPORTANT:
When a user attaches an image or PDF to their message, you must ALWAYS write a thorough description of what's in the file at the START of your response, even if they didn't explicitly ask for one. This description becomes the permanent record — the file itself is NOT saved.

For images (photos, screenshots, samples):
- Describe what's shown in detail (e.g. "tile sample: matte-finish dark grey porcelain hexagons, ~150mm wide, with subtle texture")
- Note any text, prices, dimensions, brand names visible
- Note the lighting conditions if relevant for colour judgements
- Then proceed to whatever the user asked

For PDFs (quotes, surveys, plans):
- Identify what kind of document it is (quote, survey, drawing, contract, etc.)
- Extract key data: prices, dates, dimensions, vendor name, key clauses
- Summarise the main points in 3-5 bullet points
- Flag anything unusual or risky
- Then proceed to whatever the user asked

Format the description as a clear "📎 FILE NOTED:" section at the top of your reply so it's easy to find later.`;

const USERS = {
  Whitney: { color: "#c4a882", initial: "W", accent: "#e8d5b7" },
  Charlie: { color: "#7a9e87", initial: "C", accent: "#b8d4bf" },
};

export default function App() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showDecisions, setShowDecisions] = useState(false);
  const [decisions, setDecisions] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]); // [{name, mimeType, base64, size}]
  const [pendingDriveSave, setPendingDriveSave] = useState(null); // {messageId, files}
  const [pendingDecisions, setPendingDecisions] = useState([]);
  const [showPending, setShowPending] = useState(false);
  const [respondingToPending, setRespondingToPending] = useState(null); // {id, action}
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (user) {
      loadHistory();
      loadDecisions();
      loadPendingDecisions();
      inputRef.current?.focus();
    }
  }, [user]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(200);
      if (!error && data) {
        const loaded = data.map((row) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          user: row.user_name,
          timestamp: new Date(row.created_at),
        }));
        setMessages(loaded);
      }
    } catch (e) {
      console.error("History load error:", e);
    }
    setLoadingHistory(false);
  };

  const loadDecisions = async () => {
    try {
      const { data, error } = await supabase
        .from("decisions").select("*")
        .order("created_at", { ascending: false }).limit(100);
      if (!error && data) setDecisions(data);
    } catch (e) {
      console.error("Decisions load error:", e);
    }
  };

  const loadPendingDecisions = async () => {
    try {
      const res = await fetch(ANTHROPIC_API + "?action=list_pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.pending) setPendingDecisions(data.pending);
    } catch (e) {
      console.error("Pending load error:", e);
    }
  };

  const respondToPending = async (id, status, note) => {
    setRespondingToPending({ id, action: status });
    try {
      const res = await fetch(ANTHROPIC_API + "?action=respond_to_pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, user, status, note }),
      });
      const data = await res.json();
      if (data.ok) {
        await loadPendingDecisions();
        await loadDecisions();
        if (data.finalized) {
          const confirmMsg = {
            role: "assistant",
            content: `✅ Both approved — decision logged: "${data.item.decision}"`,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, confirmMsg]);
          await saveMessage("assistant", confirmMsg.content, "RENO");
        }
      }
    } catch (e) {
      console.error("Respond error:", e);
    }
    setRespondingToPending(null);
  };

  const saveMessage = async (role, content, userName) => {
    try {
      await supabase.from("messages").insert({ role, content, user_name: userName || "RENO" });
    } catch (e) {
      console.error("Save error:", e);
    }
  };

const fetchBriefing = async () => {
    setLoading(true);
    try {
      const res = await fetch(ANTHROPIC_API + "?action=brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user }),
      });
      const data = await res.json();
      const briefingText = data.briefing || "Could not generate briefing.";
      const briefingMsg = {
        role: "assistant",
        content: briefingText,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, briefingMsg]);
      await saveMessage("assistant", briefingText, "RENO");
    } catch (e) {
      console.error("Briefing error:", e);
    }
    setLoading(false);
  };
  
  const saveDecision = async ({ category, decision, cost_impact, needs_signoff, source, logged_by }) => {
    try {
      const { data, error } = await supabase.from("decisions").insert({
        category: category || "other",
        decision,
        cost_impact: cost_impact || null,
        needs_signoff: !!needs_signoff,
        source: source || "auto",
        logged_by: logged_by || user,
      }).select();
      if (error) return { error };
      loadDecisions();
      return { data };
    } catch (e) {
      return { error: e };
    }
  };

  const extractDecisions = (text) => {
    const decisionRegex = /\[LOG_DECISION\][^\[]*?category="([^"]*)"[^\[]*?cost="([^"]*)"[^\[]*?signoff="([^"]*)"[^\[]*?decision="((?:[^"\\]|\\.)*)"/g;
    const lineItemRegex = /\[LOG_LINE_ITEM\][^\[]*?category="([^"]*)"[^\[]*?room="([^"]*)"[^\[]*?item="((?:[^"\\]|\\.)*)"[^\[]*?vendor="((?:[^"\\]|\\.)*)"[^\[]*?status="([^"]*)"[^\[]*?estimate="([^"]*)"[^\[]*?quote="([^"]*)"[^\[]*?actual="([^"]*)"[^\[]*?decided_by="([^"]*)"[^\[]*?notes="((?:[^"\\]|\\.)*)"/g;
    const pendingRegex = /\[LOG_PENDING\][^\[]*?proposed_by="([^"]*)"[^\[]*?category="([^"]*)"[^\[]*?cost="([^"]*)"[^\[]*?reasoning="((?:[^"\\]|\\.)*)"[^\[]*?deadline="([^"]*)"[^\[]*?decision="((?:[^"\\]|\\.)*)"/g;
    const decisions = [];
    const lineItems = [];
    const pendings = [];
    let match;
    while ((match = decisionRegex.exec(text)) !== null) {
      decisions.push({
        category: match[1],
        cost_impact: match[2] ? parseFloat(match[2]) : null,
        needs_signoff: match[3] === "true",
        decision: match[4],
        source: "auto",
      });
    }
    while ((match = lineItemRegex.exec(text)) !== null) {
      lineItems.push({
        category: match[1], room: match[2], item: match[3], vendor: match[4],
        status: match[5], estimate: match[6], quote: match[7], actual: match[8],
        decided_by: match[9], notes: match[10],
      });
    }
    while ((match = pendingRegex.exec(text)) !== null) {
      pendings.push({
        proposed_by: match[1],
        category: match[2],
        cost_impact: match[3] ? parseFloat(match[3]) : null,
        reasoning: match[4],
        deadline: match[5] || null,
        decision: match[6],
      });
    }
    const cleanText = text
      .replace(decisionRegex, "")
      .replace(lineItemRegex, "")
      .replace(pendingRegex, "")
      .trim();
    return { cleanText, decisions, lineItems, pendings };
  };

  const buildApiMessages = (history, newMsg, currentUser) => {
    const recent = history.slice(-30);
    const apiMsgs = recent.map((m) => ({
      role: m.role,
      content: m.role === "user" ? `[${m.user}]: ${m.content}` : m.content,
    }));
    apiMsgs.push({ role: "user", content: `[${currentUser}]: ${newMsg}` });
    return apiMsgs;
  };

  // File handling
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    const validFiles = [];

    for (const file of files) {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        alert(`${file.name}: unsupported type. Use PNG, JPG, GIF, WEBP, or PDF.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name}: too large (${Math.round(file.size / 1024 / 1024)}MB). 5MB max.`);
        continue;
      }
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          resolve(result.split(",")[1]); // strip data: prefix
        };
        reader.readAsDataURL(file);
      });
      validFiles.push({
        name: file.name,
        mimeType: file.type,
        base64,
        size: file.size,
        isPdf: file.type === "application/pdf",
      });
    }

    if (pendingFiles.length + validFiles.length > 2) {
      alert("Max 2 files per message.");
      const allowed = 2 - pendingFiles.length;
      validFiles.splice(allowed);
    }

    setPendingFiles([...pendingFiles, ...validFiles]);
    e.target.value = ""; // reset so same file can be picked again later
  };

  const removePendingFile = (idx) => {
    setPendingFiles(pendingFiles.filter((_, i) => i !== idx));
  };

  const saveFilesToDrive = async (files) => {
    const results = [];
    for (const file of files) {
      try {
        const res = await fetch(ANTHROPIC_API + "?action=upload_to_drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.mimeType,
            base64: file.base64,
          }),
        });
        const data = await res.json();
        results.push(data);
      } catch (e) {
        results.push({ error: e.message });
      }
    }
    return results;
  };

  const handleSaveToDrive = async () => {
    if (!pendingDriveSave) return;
    const filesToSave = pendingDriveSave.files;
    setPendingDriveSave(null);
    const confirmMsg = {
      role: "assistant",
      content: `📁 Saving ${filesToSave.length} file${filesToSave.length > 1 ? "s" : ""} to Drive...`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, confirmMsg]);
    const results = await saveFilesToDrive(filesToSave);
    const succeeded = results.filter((r) => r.ok);
    const finalMsg = {
      role: "assistant",
      content: succeeded.length === filesToSave.length
        ? `✅ Saved ${succeeded.length} file${succeeded.length > 1 ? "s" : ""} to Drive folder.`
        : `⚠️ Saved ${succeeded.length} of ${filesToSave.length} files. Some failed.`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev.slice(0, -1), finalMsg]);
    await saveMessage("assistant", finalMsg.content, "RENO");
  };

  const handleManualLog = async (text) => {
    const decisionText = text.replace(/^\/log\s+/i, "").trim();
    if (!decisionText) return false;
    await saveDecision({ category: "manual", decision: decisionText, source: "manual", logged_by: user });
    fetch(ANTHROPIC_API + "?action=write_decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: decisionText, logged_by: user, cost_impact: null, needs_signoff: false }),
    }).catch(() => {});
    const confirmMsg = {
      role: "assistant",
      content: `📌 Logged to decision register: "${decisionText}"`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, confirmMsg]);
    await saveMessage("assistant", confirmMsg.content, "RENO");
    return true;
  };

  const sendMessage = async () => {
    if ((!input.trim() && pendingFiles.length === 0) || loading) return;
    const text = input.trim();
    const filesForThisMessage = [...pendingFiles];

    if (text.toLowerCase().startsWith("/log ")) {
      const userMsg = { role: "user", content: text, user, timestamp: new Date() };
      setMessages((prev) => [...prev, userMsg]);
      await saveMessage("user", text, user);
      setInput("");
      setPendingFiles([]);
      await handleManualLog(text);
      return;
    }

    const filesNote = filesForThisMessage.length > 0
      ? `\n📎 ${filesForThisMessage.map((f) => f.name).join(", ")}`
      : "";
    const userMsg = {
      role: "user",
      content: text + filesNote,
      user,
      timestamp: new Date(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setPendingFiles([]);
    setLoading(true);
    await saveMessage("user", text + filesNote, user);

    try {
      const response = await fetch(ANTHROPIC_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: PROJECT_CONTEXT,
          messages: buildApiMessages(messages, text || "(see attached file)", user),
          uploadedFiles: filesForThisMessage.map((f) => ({
            mimeType: f.mimeType,
            base64: f.base64,
            isPdf: f.isPdf,
          })),
        }),
      });
      const data = await response.json();
      const rawReply = data.content?.[0]?.text || "Sorry, I couldn't generate a response.";
      const { cleanText, decisions: autoDecisions, lineItems: autoLineItems, pendings: autoPendings } = extractDecisions(rawReply);

      for (const d of autoDecisions) {
        await saveDecision({ ...d, logged_by: user });
        fetch(ANTHROPIC_API + "?action=write_decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: d.decision, logged_by: user,
            cost_impact: d.cost_impact, needs_signoff: d.needs_signoff,
          }),
        }).catch(() => {});
      }
      for (const li of autoLineItems) {
        fetch(ANTHROPIC_API + "?action=write_line_item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(li),
        }).catch(() => {});
      }
      for (const p of autoPendings) {
        await fetch(ANTHROPIC_API + "?action=create_pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proposed_by: p.proposed_by || user,
            category: p.category,
            decision: p.decision,
            cost_impact: p.cost_impact,
            reasoning: p.reasoning,
            deadline: p.deadline,
          }),
        }).catch(() => {});
      }
      if (autoPendings.length > 0) loadPendingDecisions();

      const assistantMsg = { role: "assistant", content: cleanText, timestamp: new Date() };
      setMessages((prev) => [...prev, assistantMsg]);
      await saveMessage("assistant", cleanText, "RENO");

      
    } catch (err) {
      const errMsg = { role: "assistant", content: "Connection error — please try again.", timestamp: new Date() };
      setMessages((prev) => [...prev, errMsg]);
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const formatTime = (d) => {
    if (!d) return "";
    const date = new Date(d);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    if (isToday) return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " · " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };

  const renderContent = (text) => {
    return text.split("\n").map((line, i) => {
      const processed = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      if (line.startsWith("### ")) return <h4 key={i} style={{ margin: "10px 0 4px", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.6 }}>{line.slice(4)}</h4>;
      if (line.startsWith("## ")) return <h3 key={i} style={{ margin: "10px 0 5px", fontSize: "14px", fontWeight: 700, color: "#c4a882" }}>{line.slice(3)}</h3>;
      if (line.startsWith("# ")) return <h2 key={i} style={{ margin: "10px 0 5px", fontSize: "15px", fontWeight: 700 }}>{line.slice(2)}</h2>;
      if (line.startsWith("- ") || line.startsWith("• ")) return (
        <div key={i} style={{ paddingLeft: "14px", margin: "3px 0", display: "flex", gap: "8px" }}>
          <span style={{ opacity: 0.4, flexShrink: 0 }}>–</span>
          <span dangerouslySetInnerHTML={{ __html: processed.replace(/^[-•]\s/, "") }} />
        </div>
      );
      if (/^\d+\./.test(line)) return <div key={i} style={{ paddingLeft: "14px", margin: "3px 0" }} dangerouslySetInnerHTML={{ __html: processed }} />;
      if (line.trim() === "") return <div key={i} style={{ height: "7px" }} />;
      return <p key={i} style={{ margin: "3px 0", lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: processed }} />;
    });
  };

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", background: "#1a1714", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Georgia', serif", padding: "24px" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Lato:wght@300;400;700&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #1a1714; }
          .user-btn { transition: all 0.2s ease; cursor: pointer; border: none; }
          .user-btn:hover { transform: translateY(-3px); filter: brightness(1.15); }
        `}</style>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "40px", width: "100%", maxWidth: "360px" }}>
          <div style={{ flex: 1, height: "1px", background: "linear-gradient(to right, transparent, #c4a882)" }} />
          <span style={{ color: "#c4a882", fontSize: "20px" }}>⬡</span>
          <div style={{ flex: 1, height: "1px", background: "linear-gradient(to left, transparent, #c4a882)" }} />
        </div>
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div style={{ color: "#c4a882", fontFamily: "'Lato', sans-serif", fontSize: "11px", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "14px", opacity: 0.7 }}>
            59 Springdale Road · N16
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", color: "#f0e6d3", fontSize: "clamp(28px, 7vw, 42px)", fontWeight: 700, margin: "0 0 10px", lineHeight: 1.15 }}>
            Renovation<br />Project Manager
          </h1>
          <p style={{ color: "#7a6e62", fontFamily: "'Lato', sans-serif", fontSize: "14px", fontWeight: 300 }}>
            Your shared AI project partner
          </p>
        </div>
        <p style={{ color: "#5a5248", fontFamily: "'Lato', sans-serif", fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: "20px" }}>
          Who's speaking?
        </p>
        <div style={{ display: "flex", gap: "16px" }}>
          {Object.entries(USERS).map(([name, conf]) => (
            <button key={name} className="user-btn" onClick={() => setUser(name)} style={{ background: `linear-gradient(135deg, ${conf.color}18, ${conf.color}38)`, border: `1px solid ${conf.color}55`, borderRadius: "4px", padding: "20px 44px", color: conf.accent, fontFamily: "'Playfair Display', serif", fontSize: "20px", fontWeight: 600 }}>
              {name}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "56px", color: "#2e2a26", fontFamily: "'Lato', sans-serif", fontSize: "10px", letterSpacing: "0.12em" }}>
          RENO v1 · Powered by Claude
        </div>
      </div>
    );
  }

  const userConf = USERS[user];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#1a1714", color: "#e8ddd0", fontFamily: "'Lato', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Lato:wght@300;400;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #1a1714; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #3a3530; border-radius: 2px; }
        .msg-bubble { animation: fadeUp 0.2s ease forwards; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .send-btn:hover:not(:disabled) { background: #d4b892 !important; }
        .send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .quick-btn:hover { background: #2e2a26 !important; color: #c4a882 !important; border-color: #c4a882 !important; }
        .switch-btn:hover { opacity: 0.6; }
        .panel-btn:hover { color: #c4a882 !important; }
        .clip-btn:hover { color: #c4a882 !important; }
        .save-yes:hover { background: #d4b892 !important; }
        .save-no:hover { background: #2e2a26 !important; }
        textarea:focus { outline: none; }
        @keyframes pulse { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
      `}</style>

      <div style={{ padding: "12px 18px", borderBottom: "1px solid #2a2622", background: "#1d1a17", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
          <span style={{ fontSize: "18px", color: "#c4a882" }}>⬡</span>
          <div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "14px", fontWeight: 600, color: "#f0e6d3", lineHeight: 1 }}>59 Springdale Road</div>
            <div style={{ fontSize: "10px", color: "#5a5248", letterSpacing: "0.1em", marginTop: "2px" }}>RENOVATION PM · N16 9NT</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button className="panel-btn" onClick={fetchBriefing} disabled={loading} style={{ background: "none", border: "1px solid #2a2622", borderRadius: "20px", padding: "5px 11px", color: "#7a6e62", fontSize: "11px", letterSpacing: "0.08em", cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Lato', sans-serif", transition: "color 0.15s", opacity: loading ? 0.5 : 1 }}>
            📊 BRIEF
          </button>
          <button className="panel-btn" onClick={() => { setShowPending(true); loadPendingDecisions(); }} style={{ background: pendingDecisions.length > 0 ? "#c4a88218" : "none", border: `1px solid ${pendingDecisions.length > 0 ? "#c4a88266" : "#2a2622"}`, borderRadius: "20px", padding: "5px 11px", color: pendingDecisions.length > 0 ? "#c4a882" : "#7a6e62", fontSize: "11px", letterSpacing: "0.08em", cursor: "pointer", fontFamily: "'Lato', sans-serif", transition: "color 0.15s" }}>
            ⏳ PENDING ({pendingDecisions.length})
          </button>
          <button className="panel-btn" onClick={() => { setShowDecisions(true); loadDecisions(); }} style={{ background: "none", border: "1px solid #2a2622", borderRadius: "20px", padding: "5px 11px", color: "#7a6e62", fontSize: "11px", letterSpacing: "0.08em", cursor: "pointer", fontFamily: "'Lato', sans-serif", transition: "color 0.15s" }}>
            📋 LOG ({decisions.length})
          </button>
          <div style={{ background: `${userConf.color}18`, border: `1px solid ${userConf.color}44`, borderRadius: "20px", padding: "4px 12px 4px 7px", display: "flex", alignItems: "center", gap: "7px" }}>
            <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: userConf.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#1a1714" }}>{userConf.initial}</div>
            <span style={{ fontSize: "13px", color: userConf.accent }}>{user}</span>
          </div>
          <button className="switch-btn" onClick={() => { setUser(null); setMessages([]); }} style={{ background: "none", border: "none", color: "#4a4440", fontSize: "10px", letterSpacing: "0.12em", cursor: "pointer", fontFamily: "'Lato', sans-serif", padding: "4px 6px", transition: "opacity 0.15s" }}>
            SWITCH
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 14px" }}>
        {loadingHistory && (
          <div style={{ textAlign: "center", padding: "20px", color: "#4a4440", fontSize: "12px" }}>Loading conversation history…</div>
        )}
        {!loadingHistory && messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 16px" }}>
            <div style={{ fontSize: "30px", marginBottom: "14px" }}>🏛</div>
            <p style={{ color: "#5a5248", fontFamily: "'Playfair Display', serif", fontSize: "16px", marginBottom: "6px" }}>Morning, {user}.</p>
            <p style={{ color: "#3a3530", fontSize: "13px", maxWidth: "320px", margin: "0 auto 18px", lineHeight: 1.65 }}>
              I have full context on the Springdale Road project. Attach files with 📎, just type, or get a quick briefing on where things stand:
            </p>
            <button
              onClick={fetchBriefing}
              disabled={loading}
              className="quick-btn"
              style={{
                background: "#c4a88218",
                border: "1px solid #c4a88266",
                borderRadius: "20px",
                padding: "10px 22px",
                color: "#c4a882",
                fontSize: "13px",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "'Lato', sans-serif",
                transition: "all 0.15s",
                opacity: loading ? 0.5 : 1,
              }}
            >
              📊 Brief me on where we are
            </button>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === "user";
          const msgUserConf = isUser ? USERS[msg.user] : null;
          const showDateSep = i === 0 || (new Date(msg.timestamp).toDateString() !== new Date(messages[i - 1]?.timestamp).toDateString());
          return (
            <div key={msg.id || i}>
              {showDateSep && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "16px 0 12px" }}>
                  <div style={{ flex: 1, height: "1px", background: "#252118" }} />
                  <span style={{ fontSize: "10px", color: "#3a3530", letterSpacing: "0.1em" }}>
                    {new Date(msg.timestamp).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                  <div style={{ flex: 1, height: "1px", background: "#252118" }} />
                </div>
              )}
              <div className="msg-bubble" style={{ display: "flex", gap: "9px", marginBottom: "14px", flexDirection: isUser ? "row-reverse" : "row" }}>
                {isUser ? (
                  <div style={{ width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0, background: msgUserConf.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#1a1714", marginTop: "2px" }}>
                    {msgUserConf.initial}
                  </div>
                ) : (
                  <div style={{ width: "26px", height: "26px", borderRadius: "4px", flexShrink: 0, background: "#252118", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", marginTop: "2px", color: "#c4a882" }}>⬡</div>
                )}
                <div style={{ maxWidth: "84%" }}>
                  <div style={{ fontSize: "10px", color: "#3e3a36", marginBottom: "4px", textAlign: isUser ? "right" : "left" }}>
                    {isUser ? msg.user : "RENO"} · {formatTime(msg.timestamp)}
                  </div>
                  <div style={{ background: isUser ? `${msgUserConf.color}15` : "#201e1a", border: `1px solid ${isUser ? msgUserConf.color + "30" : "#2a2622"}`, borderRadius: isUser ? "12px 3px 12px 12px" : "3px 12px 12px 12px", padding: "11px 14px", fontSize: "13.5px", lineHeight: 1.6, color: "#ccc3b5" }}>
                    {isUser ? msg.content : renderContent(msg.content)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        

        {loading && (
          <div className="msg-bubble" style={{ display: "flex", gap: "9px", marginBottom: "14px" }}>
            <div style={{ width: "26px", height: "26px", borderRadius: "4px", background: "#252118", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: "#c4a882" }}>⬡</div>
            <div style={{ background: "#201e1a", border: "1px solid #2a2622", borderRadius: "3px 12px 12px 12px", padding: "14px 18px", display: "flex", gap: "5px", alignItems: "center" }}>
              {[0, 1, 2].map((j) => (
                <div key={j} style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#c4a882", animation: `pulse 1.2s ease-in-out ${j * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: "10px 14px 14px", borderTop: "1px solid #252118", background: "#1b1814" }}>
        {pendingFiles.length > 0 && (
          <>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
              {pendingFiles.map((f, idx) => (
                <div key={idx} style={{ background: "#252118", border: "1px solid #c4a88244", borderRadius: "6px", padding: "4px 8px 4px 10px", display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#c4a882" }}>
                  <span>{f.isPdf ? "📄" : "🖼"}</span>
                  <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <button onClick={() => removePendingFile(idx)} style={{ background: "none", border: "none", color: "#5a5248", cursor: "pointer", padding: "0 2px", fontSize: "14px", lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "10px", color: "#4a4440", marginBottom: "8px", paddingLeft: "2px", lineHeight: 1.4 }}>
              ℹ️ Files aren't saved — drag to Drive folder if you want a permanent copy
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: "9px", alignItems: "flex-end", background: "#201e1a", border: "1px solid #2a2622", borderRadius: "8px", padding: "9px 11px" }}>
          <button className="clip-btn" onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", color: "#7a6e62", fontSize: "16px", cursor: "pointer", padding: "0 4px", flexShrink: 0, transition: "color 0.15s" }}>
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            multiple
            onChange={handleFileSelect}
            style={{ display: "none" }}
          />
          <div style={{ width: "19px", height: "19px", borderRadius: "50%", flexShrink: 0, background: userConf.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, color: "#1a1714", marginBottom: "1px" }}>
            {userConf.initial}
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKey}
            placeholder={`Message as ${user}…`}
            rows={1}
            style={{ flex: 1, background: "none", border: "none", color: "#e0d5c5", fontSize: "14px", lineHeight: 1.5, fontFamily: "'Lato', sans-serif", fontWeight: 300, maxHeight: "120px", overflow: "auto" }}
          />
          <button className="send-btn" onClick={sendMessage} disabled={(!input.trim() && pendingFiles.length === 0) || loading} style={{ background: "#c4a882", border: "none", borderRadius: "6px", width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#1a1714", fontSize: "14px", flexShrink: 0, transition: "all 0.15s" }}>
            ↑
          </button>
        </div>
      </div>

      {showPending && (
        <div onClick={() => setShowPending(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px, 100%)", height: "100%", background: "#1d1a17", borderLeft: "1px solid #2a2622", display: "flex", flexDirection: "column", animation: "fadeUp 0.2s ease" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2622", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#f0e6d3", fontWeight: 600 }}>Pending Decisions</div>
                <div style={{ fontSize: "10px", color: "#5a5248", letterSpacing: "0.1em", marginTop: "2px" }}>{pendingDecisions.length} AWAITING SIGN-OFF</div>
              </div>
              <button onClick={() => setShowPending(false)} style={{ background: "none", border: "none", color: "#7a6e62", fontSize: "20px", cursor: "pointer", padding: "0 6px" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
              {pendingDecisions.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#4a4440", fontSize: "12px", lineHeight: 1.6 }}>
                  No pending decisions.<br /><br />When something needs joint sign-off, RENO will ask whether to log it as pending.
                </div>
              )}
              {pendingDecisions.map((p) => {
                const myStatusKey = user.toLowerCase() + "_status";
                const otherUser = user === "Whitney" ? "Charlie" : "Whitney";
                const otherStatusKey = otherUser.toLowerCase() + "_status";
                const myStatus = p[myStatusKey];
                const otherStatus = p[otherStatusKey];
                const myNote = p[user.toLowerCase() + "_note"];
                const otherNote = p[otherUser.toLowerCase() + "_note"];
                const isOverdue = p.deadline && new Date(p.deadline) < new Date();
                const isWaitingOnMe = myStatus === "pending";
                return (
                  <div key={p.id} style={{ background: "#201e1a", border: `1px solid ${isWaitingOnMe ? "#c4a88266" : "#2a2622"}`, borderRadius: "8px", padding: "12px 14px", marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "10px", color: "#c4a882", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{p.category || "other"}</span>
                      <div style={{ fontSize: "10px", color: "#4a4440", textAlign: "right" }}>
                        <div>proposed {new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                        {p.deadline && (
                          <div style={{ color: isOverdue ? "#d49a82" : "#5a5248", marginTop: "2px" }}>
                            {isOverdue ? "⚠️ overdue" : "due"} {new Date(p.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: "13px", color: "#ccc3b5", lineHeight: 1.5, marginBottom: "8px", fontWeight: 500 }}>{p.decision}</div>
                    {p.cost_impact && <div style={{ fontSize: "11px", color: "#c4a882", marginBottom: "6px" }}>💰 £{p.cost_impact}</div>}
                    {p.reasoning && <div style={{ fontSize: "11px", color: "#7a6e62", marginBottom: "8px", lineHeight: 1.5, fontStyle: "italic" }}>{p.reasoning}</div>}

                    <div style={{ display: "flex", gap: "10px", fontSize: "10px", color: "#5a5248", marginBottom: "10px", paddingTop: "8px", borderTop: "1px solid #252118" }}>
                      <div>
                        <div style={{ color: USERS[p.proposed_by]?.color, fontWeight: 700, marginBottom: "2px" }}>Proposed by {p.proposed_by}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: USERS.Whitney.color }}>Whitney: {p.whitney_status === "approved" ? "✅" : p.whitney_status === "rejected" ? "❌" : "⏳"} {p.whitney_status}</div>
                        <div style={{ color: USERS.Charlie.color }}>Charlie: {p.charlie_status === "approved" ? "✅" : p.charlie_status === "rejected" ? "❌" : "⏳"} {p.charlie_status}</div>
                      </div>
                    </div>

                    {(myNote || otherNote) && (
                      <div style={{ fontSize: "10px", color: "#5a5248", marginBottom: "8px", paddingTop: "6px", borderTop: "1px solid #252118" }}>
                        {myNote && <div style={{ marginBottom: "2px" }}>{user}: "{myNote}"</div>}
                        {otherNote && <div>{otherUser}: "{otherNote}"</div>}
                      </div>
                    )}

                    {isWaitingOnMe && (
                      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                        <button
                          onClick={() => respondToPending(p.id, "approved", null)}
                          disabled={respondingToPending?.id === p.id}
                          style={{ background: "#7a9e87", border: "none", borderRadius: "4px", padding: "6px 14px", color: "#1a1714", fontSize: "12px", fontWeight: 700, cursor: "pointer", opacity: respondingToPending?.id === p.id ? 0.5 : 1, fontFamily: "'Lato', sans-serif" }}>
                          ✓ Approve
                        </button>
                        <button
                          onClick={() => {
                            const note = prompt("Why are you rejecting? (this stays as a note for follow-up)");
                            if (note !== null) respondToPending(p.id, "rejected", note || "");
                          }}
                          disabled={respondingToPending?.id === p.id}
                          style={{ background: "none", border: "1px solid #d49a82", borderRadius: "4px", padding: "6px 14px", color: "#d49a82", fontSize: "12px", cursor: "pointer", opacity: respondingToPending?.id === p.id ? 0.5 : 1, fontFamily: "'Lato', sans-serif" }}>
                          ✗ Reject
                        </button>
                      </div>
                    )}
                    {!isWaitingOnMe && (
                      <div style={{ fontSize: "10px", color: "#4a4440", textAlign: "center", padding: "4px", fontStyle: "italic" }}>
                        {myStatus === "approved" ? "You've approved — waiting on " + otherUser : myStatus === "rejected" ? "You rejected — needs follow-up" : "Awaiting response"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      
      {showDecisions && (
        <div onClick={() => setShowDecisions(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", height: "100%", background: "#1d1a17", borderLeft: "1px solid #2a2622", display: "flex", flexDirection: "column", animation: "fadeUp 0.2s ease" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2622", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", color: "#f0e6d3", fontWeight: 600 }}>Decision Log</div>
                <div style={{ fontSize: "10px", color: "#5a5248", letterSpacing: "0.1em", marginTop: "2px" }}>{decisions.length} ENTRIES · ALL TIME</div>
              </div>
              <button onClick={() => setShowDecisions(false)} style={{ background: "none", border: "none", color: "#7a6e62", fontSize: "20px", cursor: "pointer", padding: "0 6px" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
              {decisions.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#4a4440", fontSize: "12px" }}>
                  No decisions logged yet.
                </div>
              )}
              {decisions.map((d) => (
                <div key={d.id} style={{ background: "#201e1a", border: "1px solid #2a2622", borderRadius: "6px", padding: "10px 12px", marginBottom: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "5px" }}>
                    <span style={{ fontSize: "10px", color: "#c4a882", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{d.category || "other"}</span>
                    <span style={{ fontSize: "10px", color: "#4a4440" }}>{new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                  <div style={{ fontSize: "13px", color: "#ccc3b5", lineHeight: 1.5, marginBottom: "6px" }}>{d.decision}</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "10px", color: "#5a5248" }}>
                    <span>by {d.logged_by}</span>
                    {d.cost_impact && <span style={{ color: "#c4a882" }}>· £{d.cost_impact}</span>}
                    {d.needs_signoff && <span style={{ color: "#d49a82" }}>· ⚠️ NEEDS SIGN-OFF</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
