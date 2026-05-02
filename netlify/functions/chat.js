const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

// Set up Google auth from the env JSON
let googleAuth = null;
try {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    googleAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
    });
  }
} catch (e) {
  console.error("Google auth setup error:", e.message);
}

// Cache doc/sheet content for 60 seconds to avoid hammering the API
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

const LIVE_DATA_INSTRUCTION = `

=== LIVE DATA ACCESS (IMPORTANT) ===
You have LIVE READ ACCESS to two Google files via this tool:
1. The master project document (injected above as "LIVE MASTER DOCUMENT")
2. The budget spreadsheet (injected above as "LIVE BUDGET SHEET")

Both documents are refreshed every ~60 seconds from Google Drive. When users ask about the master doc or budget sheet, READ THE INJECTED CONTENT ABOVE and reference it directly. You can quote from it, summarise sections, and answer specific questions about its contents.

DO NOT claim you cannot access these documents — you can. The content is right there in your context, between the "===" markers.

If a document section is missing or empty, say so honestly (e.g. "the budget sheet appears to be empty"). But do not say you have no integration when content is clearly present.
=== END LIVE DATA ACCESS ===
`;

const TAG_INSTRUCTION = `

=== DECISION LOGGING (CRITICAL) ===

const TAG_INSTRUCTION = `

=== DECISION LOGGING (CRITICAL) ===
You MUST detect when decisions, commitments, contractor choices, quotes, or material/spec selections are made in the conversation. When you detect one, you MUST append a structured tag to the END of your response on its own line.

EXACT FORMAT (copy precisely):
[LOG_DECISION] category="<category>" cost="<number or empty>" signoff="<true or false>" decision="<short description>"

Categories: structural | finishes | budget | contractor | timeline | sustainability | quote | other
Set signoff="true" if the decision is over £500, structural, or aesthetically hard to reverse.
You may emit multiple tags (one per line) if multiple decisions occurred.
Emit the tag for ANY clear decision, even tentative ones — Whitney and Charlie need a paper trail.

DO NOT emit tags for general advice, suggestions you're proposing, or questions.
=== END DECISION LOGGING ===
`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const debug = {
    supabase_configured: !!supabase,
    google_configured: !!googleAuth,
  };

  try {
    const { messages, system } = JSON.parse(event.body);

    // Fetch live Drive content (with simple 60s cache)
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
      debug.drive_refreshed = true;
    } else {
      debug.drive_cached = true;
    }

    if (cache.masterDoc) {
      driveBlock += `\n\n=== LIVE MASTER DOCUMENT (Google Doc, latest version) ===\n${cache.masterDoc}\n=== END MASTER DOCUMENT ===\n`;
      debug.master_doc_chars = cache.masterDoc.length;
    }
    if (cache.budgetSheet) {
      driveBlock += `\n\n=== LIVE BUDGET SHEET (Google Sheet, latest version) ===\n${cache.budgetSheet}\n=== END BUDGET SHEET ===\n`;
      debug.budget_sheet_chars = cache.budgetSheet.length;
    }

    // Fetch Supabase memory
    let memoryBlock = "";
    if (supabase) {
      try {
        const { data: stateData } = await supabase
          .from("project_state").select("*").eq("id", 1).single();
        const { data: decisionsData } = await supabase
          .from("decisions").select("*")
          .order("created_at", { ascending: false }).limit(50);

        debug.decisions_count = decisionsData?.length || 0;

        memoryBlock = "\n\n=== PROJECT MEMORY (decisions logged so far) ===\n";
        if (stateData?.summary) {
          memoryBlock += `\nSTATE: ${stateData.summary}\n`;
        }
        if (decisionsData && decisionsData.length > 0) {
          memoryBlock += `\nDECISION LOG (${decisionsData.length} entries, most recent first):\n`;
          decisionsData.forEach((d) => {
            const date = new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const cost = d.cost_impact ? ` [£${d.cost_impact}]` : "";
            const signoff = d.needs_signoff ? " ⚠️ NEEDS SIGN-OFF" : "";
            memoryBlock += `- ${date} (${d.logged_by})${cost}${signoff}: ${d.decision}\n`;
          });
        }
        memoryBlock += "\n=== END PROJECT MEMORY ===\n";
      } catch (e) {
        debug.supabase_error = e.message;
      }
    }

    const fullSystem = system + driveBlock + memoryBlock + LIVE_DATA_INSTRUCTION + TAG_INSTRUCTION;

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
