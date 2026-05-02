const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

let googleAuth = null;
try {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    googleAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });
  }
} catch (e) {
  console.error("Google auth setup error:", e.message);
}

const cache = { masterDoc: null, budgetSheet: null, ts: 0 };

const fetchMasterDoc = async () => {
  if (!googleAuth || !process.env.MASTER_DOC_ID) return null;
  try {
    const docs = google.docs({ version: "v1", auth: googleAuth });
    const res = await docs.documents.get({ documentId: process.env.MASTER_DOC_ID });
    const text = (res.data.body?.content || [])
      .map((el) => {
        if (!el.paragraph) return "";
        return (el.paragraph.elements || [])
          .map((e) => e.textRun?.content || "")
          .join("");
      })
      .join("");
    return text.trim();
  } catch (e) {
    console.error("Master doc fetch error:", e.message);
    return `[Error fetching master doc: ${e.message}]`;
  }
};

const fetchBudgetSheet = async () => {
  if (!googleAuth || !process.env.BUDGET_SHEET_ID) return null;
  try {
    const sheets = google.sheets({ version: "v4", auth: googleAuth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.BUDGET_SHEET_ID });
    const tabs = meta.data.sheets || [];
    const allTabs = [];
    for (const tab of tabs) {
      const tabName = tab.properties?.title || "Sheet";
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.BUDGET_SHEET_ID,
        range: tabName,
      });
      const rows = res.data.values || [];
      if (rows.length === 0) continue;
      const formatted = rows.map((r) => r.join(" | ")).join("\n");
      allTabs.push(`--- TAB: ${tabName} ---\n${formatted}`);
    }
    return allTabs.join("\n\n");
  } catch (e) {
    console.error("Budget sheet fetch error:", e.message);
    return `[Error fetching budget sheet: ${e.message}]`;
  }
};

const appendDecisionToDoc = async (decision, loggedBy, costImpact, needsSignoff) => {
  if (!googleAuth || !process.env.MASTER_DOC_ID) return { error: "no auth" };
  try {
    const docs = google.docs({ version: "v1", auth: googleAuth });
    const docMeta = await docs.documents.get({ documentId: process.env.MASTER_DOC_ID });
    const endIndex = docMeta.data.body.content[docMeta.data.body.content.length - 1].endIndex - 1;
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const cost = costImpact ? ` – £${costImpact}` : "";
    const flag = needsSignoff ? " ⚠️ NEEDS SIGN-OFF" : "";
    const entry = `\n[${date}] ${loggedBy}: ${decision}${cost}${flag}`;
    await docs.documents.batchUpdate({
      documentId: process.env.MASTER_DOC_ID,
      requestBody: {
        requests: [{ insertText: { location: { index: endIndex }, text: entry } }],
      },
    });
    return { ok: true };
  } catch (e) {
    console.error("Doc append error:", e.message);
    return { error: e.message };
  }
};

const appendLineItemToSheet = async ({ category, room, item, vendor, status, estimate, quote, actual, decided_by, notes }) => {
  if (!googleAuth || !process.env.BUDGET_SHEET_ID) return { error: "no auth" };
  try {
    const sheets = google.sheets({ version: "v4", auth: googleAuth });
    const date = new Date().toLocaleDateString("en-GB");
    const row = [
      date,
      category || "",
      room || "",
      item || "",
      vendor || "",
      status || "Estimating",
      estimate || "",
      quote || "",
      actual || "",
      20,
      "",
      decided_by || "",
      notes || "",
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.BUDGET_SHEET_ID,
      range: "Line Items!A:M",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
    return { ok: true };
  } catch (e) {
    console.error("Sheet append error:", e.message);
    return { error: e.message };
  }
};

// Generate or update the rolling summary
const generateSummary = async (existingSummary, messagesToFold) => {
  const summaryPrompt = `You are summarising a renovation project chat conversation between Whitney, Charlie, and RENO (an AI project manager). Produce a concise rolling summary that captures:

- Key topics discussed
- Decisions made (and by whom)
- Open questions / unresolved threads
- Contractors / vendors mentioned
- Tone and any tensions
- Anything that would matter for future conversations

Keep it under 400 words. Use bullet points. Do NOT repeat the entire decision log (it's stored separately) — focus on context, conversation threads, and unresolved items.

${existingSummary ? `\nEXISTING SUMMARY (extend/update with the new messages below):\n${existingSummary}\n` : ""}

NEW MESSAGES TO FOLD IN:
${messagesToFold.map((m) => `[${m.user_name}]: ${m.content}`).join("\n\n")}

Write the updated summary now.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: summaryPrompt }],
      }),
    });
    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch (e) {
    console.error("Summary generation error:", e.message);
    return null;
  }
};

const SUMMARY_THRESHOLD = 30; // Fold messages into summary every 30 new messages

const LIVE_DATA_INSTRUCTION = `

=== LIVE DATA ACCESS (IMPORTANT) ===
You have LIVE READ AND WRITE ACCESS to two Google files via this tool:
1. The master project document (injected above as "LIVE MASTER DOCUMENT")
2. The budget spreadsheet (injected above as "LIVE BUDGET SHEET")

Both documents are refreshed every ~60 seconds from Google Drive. When users ask about the master doc or budget sheet, READ THE INJECTED CONTENT ABOVE and reference it directly.

DO NOT claim you cannot access these documents — you can.
=== END LIVE DATA ACCESS ===
`;

const TAG_INSTRUCTION = `

=== DECISION & COST LOGGING (CRITICAL) ===
You MUST detect when decisions, commitments, contractor choices, quotes, or material/spec selections are made. When detected, append structured tags to the END of your response, each on its own line.

TAG 1 — DECISION TAG:
[LOG_DECISION] category="<category>" cost="<number or empty>" signoff="<true or false>" decision="<short description>"

Categories: structural | finishes | budget | contractor | timeline | sustainability | quote | other
Set signoff="true" if over £500, structural, or aesthetically hard to reverse.

TAG 2 — LINE ITEM TAG (only when a specific cost is being committed):
[LOG_LINE_ITEM] category="<one of the 7 budget categories>" room="<room>" item="<item description>" vendor="<vendor or empty>" status="<status>" estimate="<number or empty>" quote="<number or empty>" actual="<number or empty>" decided_by="<Whitney|Charlie|Joint|RENO suggested>" notes="<optional notes>"

Budget categories: Structural / Kitchen / Doors | Garden Office | Basement / Bathroom / UFH | Joinery / Storage / Finishes | Tech / Electrical / V-Rads | Contingency | Rent overrun buffer
Rooms: Ground Floor (Open Plan) | Kitchen | Basement | Bathroom | Bedroom 1 | Bedroom 2 | Bedroom 3 | Garden Office | Hallway / Storage | Whole property | External / Garden | Other
Status: Estimating | Awaiting quote | Quoted | Approved | In progress | Paid | Cancelled

DO NOT emit tags for general advice, suggestions, or questions.
=== END DECISION & COST LOGGING ===
`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (event.queryStringParameters?.action === "write_decision") {
    const body = JSON.parse(event.body);
    const result = await appendDecisionToDoc(body.decision, body.logged_by, body.cost_impact, body.needs_signoff);
    return { statusCode: 200, body: JSON.stringify(result) };
  }
  if (event.queryStringParameters?.action === "write_line_item") {
    const body = JSON.parse(event.body);
    const result = await appendLineItemToSheet(body);
    return { statusCode: 200, body: JSON.stringify(result) };
  }

  const debug = {
    supabase_configured: !!supabase,
    google_configured: !!googleAuth,
  };

  try {
    const { messages, system } = JSON.parse(event.body);

    // Drive content
    let driveBlock = "";
    const now = Date.now();
    if (googleAuth && (now - cache.ts > 60000 || !cache.masterDoc)) {
      const [docContent, sheetContent] = await Promise.all([
        fetchMasterDoc(),
        fetchBudgetSheet(),
      ]);
      cache.masterDoc = docContent;
      cache.budgetSheet = sheetContent;
      cache.ts = now;
    }
    if (cache.masterDoc) {
      driveBlock += `\n\n=== LIVE MASTER DOCUMENT ===\n${cache.masterDoc}\n=== END MASTER DOCUMENT ===\n`;
      debug.master_doc_chars = cache.masterDoc.length;
    }
    if (cache.budgetSheet) {
      driveBlock += `\n\n=== LIVE BUDGET SHEET ===\n${cache.budgetSheet}\n=== END BUDGET SHEET ===\n`;
      debug.budget_sheet_chars = cache.budgetSheet.length;
    }

    // Memory blocks
    let memoryBlock = "";
    let summaryBlock = "";
    if (supabase) {
      try {
        // Decisions
        const { data: decisionsData } = await supabase
          .from("decisions").select("*")
          .order("created_at", { ascending: false }).limit(50);
        debug.decisions_count = decisionsData?.length || 0;
        if (decisionsData && decisionsData.length > 0) {
          memoryBlock = "\n\n=== DECISION LOG (most recent first) ===\n";
          decisionsData.forEach((d) => {
            const date = new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const cost = d.cost_impact ? ` [£${d.cost_impact}]` : "";
            const signoff = d.needs_signoff ? " ⚠️ NEEDS SIGN-OFF" : "";
            memoryBlock += `- ${date} (${d.logged_by})${cost}${signoff}: ${d.decision}\n`;
          });
          memoryBlock += "=== END DECISION LOG ===\n";
        }

        // Latest summary
        const { data: summaryData } = await supabase
          .from("summaries").select("*")
          .order("created_at", { ascending: false }).limit(1);
        const latestSummary = summaryData?.[0];
        if (latestSummary?.summary_text) {
          summaryBlock = `\n\n=== ROLLING CONVERSATION SUMMARY (everything before the recent messages below) ===\n${latestSummary.summary_text}\n=== END SUMMARY ===\n`;
          debug.has_summary = true;
        }

        // Check if we should fold older messages into a new summary
        // Count messages since the last summary
        const sinceTimestamp = latestSummary?.last_message_at || "1970-01-01";
        const { count: newMessagesCount } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .gt("created_at", sinceTimestamp);
        debug.messages_since_summary = newMessagesCount || 0;

        if ((newMessagesCount || 0) >= SUMMARY_THRESHOLD) {
          // Fold the older messages into a new summary
          // We summarise everything except the last 10 messages (which stay live in the recent window)
          const { data: messagesToFold } = await supabase
            .from("messages")
            .select("*")
            .gt("created_at", sinceTimestamp)
            .order("created_at", { ascending: true });

          if (messagesToFold && messagesToFold.length > 10) {
            const foldThese = messagesToFold.slice(0, messagesToFold.length - 10);
            const newSummaryText = await generateSummary(latestSummary?.summary_text || null, foldThese);
            if (newSummaryText) {
              const lastFoldedMsg = foldThese[foldThese.length - 1];
              await supabase.from("summaries").insert({
                summary_text: newSummaryText,
                messages_covered: (latestSummary?.messages_covered || 0) + foldThese.length,
                last_message_at: lastFoldedMsg.created_at,
              });
              summaryBlock = `\n\n=== ROLLING CONVERSATION SUMMARY ===\n${newSummaryText}\n=== END SUMMARY ===\n`;
              debug.summary_regenerated = true;
            }
          }
        }
      } catch (e) {
        debug.supabase_error = e.message;
      }
    }

    const fullSystem = system + driveBlock + summaryBlock + memoryBlock + LIVE_DATA_INSTRUCTION + TAG_INSTRUCTION;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: fullSystem,
        messages,
      }),
    });

    const data = await response.json();
    data._debug = debug;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message, debug }),
    };
  }
};
