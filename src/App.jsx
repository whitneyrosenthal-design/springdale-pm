import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://fbfuxcpvqbvubaxmeatu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZiZnV4Y3B2cWJ2dWJheG1lYXR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDc3NDYsImV4cCI6MjA5MzI4Mzc0Nn0.lp8vkz6MbNcH4MAyo93jZgvbVESsohac9wWmbNQX5ao";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ANTHROPIC_API = "/.netlify/functions/chat";

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

GARDEN OFFICE SPEC:
- Size: 5m x 3m (15 sqm) — a proper home office, not a shed
- Must be insulated, electrified, and usable year-round
- Typical cost range for a quality insulated garden office this size in London: £18,000–£28,000
- Eco options: cross-laminated timber (CLT) construction, sheep's wool insulation, sedum/green roof, solar panel integration
- Planning: Likely permitted development (under 2.5m eaves — confirm for this specific plot)
- Must include power, lighting, data/ethernet, and infrared panel heater or small radiator
- Timeline: garden office groundworks and power trenching must happen in weeks 1-2 of the build

KEY STRUCTURAL DECISIONS (PROPOSED):
- Ground Floor Open Plan: Remove wall between Kitchen and Reception/Living
- Glass Transition: Stacking/sliding glass doors from Dining to extended balustrade/terrace
- Basement Reconfiguration: Possible bathroom extension + new membrane
- Heating: Vertical radiators + UFH in basement hallway and bathroom

STORAGE PRIORITIES (family of 4 with children aged 2 and 5):
- Bedroom 2 (Basement): Custom cubby storage
- Under-stair: Maximise hallway storage
- Entryway: Dedicated mudroom-style zone

IMMEDIATE ACTIONS NEEDED:
1. Dilapidation report before works start
2. Vendor tendering — interview 3+ contractors by mid-May (Charlie leads, Whitney signs off)
3. Permits — verify all consents for structural changes
4. Confirm garden office permitted development status

USER CONTEXT:
- Whitney: The project lead. Focused on budget, decisions, and being kept in the loop. She does NOT trust Charlie to communicate decisions proactively.
- Charlie: Doing the majority of research. A poor communicator who may not always flag decisions that need joint sign-off.

YOUR BEHAVIOUR:
- Always flag if Charlie mentions a decision that requires Whitney's sign-off (spend over £500, structural, aesthetic choices that are hard to reverse)
- Always suggest the most sustainable/eco option first before conventional alternatives
- Keep responses focused and actionable — no waffle
- Track budget implications of any decisions mentioned
- Proactively suggest next steps at the end of responses when helpful
- If Charlie is reporting research, acknowledge it clearly so there is a record
- If a user seems to be making a unilateral decision on something important, flag it diplomatically
- Use British English throughout
- Tailor tone: Whitney needs oversight and control, Charlie needs clear direction

FORMAT:
- Use clear sections with emoji headers when helpful
- Flag decisions with: JOINT DECISION NEEDED or NOTE FOR WHITNEY
- Flag eco options with a leaf emoji
- Flag timeline risks with: TIMELINE RISK
- Keep budget tracking visible when relevant`;

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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (user) {
      loadHistory();
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
        .limit(100);
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

  const saveMessage = async (role, content, userName) => {
    try {
      await supabase.from("messages").insert({
        role,
        content,
        user_name: userName || "RENO",
      });
    } catch (e) {
      console.error("Save error:", e);
    }
  };

  const buildApiMessages = (history, newMsg, currentUser) => {
    const recent = history.slice(-40);
    const apiMsgs = recent.map((m) => ({
      role: m.role,
      content: m.role === "user" ? `[${m.user}]: ${m.content}` : m.content,
    }));
    apiMsgs.push({ role: "user", content: `[${currentUser}]: ${newMsg}` });
    return apiMsgs;
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    const userMsg = { role: "user", content: text, user, timestamp: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    await saveMessage("user", text, user);

    try {
      const response = await fetch(ANTHROPIC_API, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    system: PROJECT_CONTEXT,
    messages: buildApiMessages(messages, text, user),
  }),
});
      const data = await response.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't generate a response.";
      const assistantMsg = { role: "assistant", content: reply, timestamp: new Date() };
      setMessages((prev) => [...prev, assistantMsg]);
      await saveMessage("assistant", reply, "RENO");
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
          <div style={{ background: `${userConf.color}18`, border: `1px solid ${userConf.color}44`, borderRadius: "20px", padding: "4px 12px 4px 7px", display: "flex", alignItems: "center", gap: "7px" }}>
            <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: userConf.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#1a1714" }}>{userConf.initial}</div>
            <span style={{ fontSize: "13px", color: userConf.accent }}>{user}</span>
          </div>
          <button className="switch-btn" onClick={() => { setUser(null); setMessages([]); }} style={{ background: "none", border: "none", color: "#4a4440", fontSize: "10px", letterSpacing: "0.12em", cursor: "pointer", fontFamily: "'Lato', sans-serif", padding: "4px 6px", transition: "opacity 0.15s" }}>
            SWITCH
          </button>
        </div>
      </div>

      <div style={{ padding: "7px 18px", borderBottom: "1px solid #252118", background: "#1b1814", display: "flex", gap: "0", overflowX: "auto" }}>
        {[
          { label: "Budget", val: "£100k" },
          { label: "Ownership", val: "26 Jun" },
          { label: "Target", val: "≤3 months" },
          { label: "Rent risk", val: "£4k/mo" },
          { label: "Phase", val: "Pre-start" },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <div style={{ padding: "0 14px 0 0" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#c4a882", lineHeight: 1 }}>{item.val}</div>
              <div style={{ fontSize: "9px", color: "#4a4440", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>{item.label}</div>
            </div>
            {i < arr.length - 1 && <div style={{ width: "1px", height: "22px", background: "#2a2622", marginRight: "14px" }} />}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 14px" }}>
        {loadingHistory && (
          <div style={{ textAlign: "center", padding: "20px", color: "#4a4440", fontSize: "12px" }}>Loading conversation history…</div>
        )}
        {!loadingHistory && messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 16px" }}>
            <div style={{ fontSize: "30px", marginBottom: "14px" }}>🏛</div>
            <p style={{ color: "#5a5248", fontFamily: "'Playfair Display', serif", fontSize: "16px", marginBottom: "6px" }}>Morning, {user}.</p>
            <p style={{ color: "#3a3530", fontSize: "13px", maxWidth: "300px", margin: "0 auto 24px", lineHeight: 1.65 }}>
              I have full context on the Springdale Road project. What do you need?
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", maxWidth: "380px", margin: "0 auto" }}>
              {[
                "What should we prioritise this week?",
                "Check budget status",
                "What needs joint sign-off?",
                "Eco options for the garden office",
                user === "Charlie" ? "Log today's research" : "Has Charlie flagged anything?",
              ].map((q) => (
                <button key={q} className="quick-btn" onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }} style={{ background: "none", border: "1px solid #2a2622", borderRadius: "20px", padding: "7px 14px", color: "#5a5248", fontSize: "12px", fontFamily: "'Lato', sans-serif", cursor: "pointer", transition: "all 0.15s" }}>
                  {q}
                </button>
              ))}
            </div>
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
        <div style={{ display: "flex", gap: "9px", alignItems: "flex-end", background: "#201e1a", border: "1px solid #2a2622", borderRadius: "8px", padding: "9px 11px" }}>
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
          <button className="send-btn" onClick={sendMessage} disabled={!input.trim() || loading} style={{ background: "#c4a882", border: "none", borderRadius: "6px", width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#1a1714", fontSize: "14px", flexShrink: 0, transition: "all 0.15s" }}>
            ↑
          </button>
        </div>
        <div style={{ textAlign: "center", marginTop: "6px", fontSize: "10px", color: "#2e2a26", letterSpacing: "0.08em" }}>
          Shared history · Whitney & Charlie · Enter to send
        </div>
      </div>
    </div>
  );
}
