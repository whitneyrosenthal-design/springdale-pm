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

const CACHE_TTL_MS = 5 * 60 * 1000;
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
    const tabPromises = tabs.map(async (tab) => {
      const tabName = tab.properties?.title || "Sheet";
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.BUDGET_SHEET_ID,
        range: tabName,
      });
      const rows = res.data.values || [];
      if (rows.length === 0) return null;
      return `--- TAB: ${tabName} ---\n${rows.map((r) => r.join(" | ")).join("\n")}`;
    });
    const results = await Promise.all(tabPromises);
    return results.filter(Boolean).join("\n\n");
  } catch (e) {
    console.error("Budget sheet fetch error:", e.message);
    return `[Error fetching budget sheet: ${e.message}]`;
  }
};

const extractDriveFileIds = (text) => {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g,
    /docs\.google\.com\/[^/]+\/d\/([a-zA-Z0-9_-]+)/g,
  ];
  const ids = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      ids.add(match[1]);
    }
  }
  return Array.from(ids);
};

const fetchDriveFile = async (fileId) => {
  if (!googleAuth) return null;
  try {
    const drive = google.drive({ version: "v3", auth: googleAuth });
    const meta = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size",
    });
    const { name, mimeType, size } = meta.data;
    const supportedImage = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType);
    const isPdf = mimeType === "application/pdf";
    if (!supportedImage && !isPdf) {
      return { name, mimeType, error: `Unsupported type: ${mimeType}` };
    }
    if (size && parseInt(size) > 5 * 1024 * 1024) {
      return { name, mimeType, error: `File too large (${Math.round(size / 1024 / 1024)}MB, limit 5MB).` };
    }
    const fileRes = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    const base64 = Buffer.from(fileRes.data).toString("base64");
    return { name, mimeType, base64, isPdf };
  } catch (e) {
    console.error("Drive file fetch error:", e.message);
    return { error: e.message };
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
      date, category || "", room || "", item || "", vendor || "",
      status || "Estimating", estimate || "", quote || "", actual || "",
      20, "", decided_by || "", notes || "",
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

const triggerSummaryRegenInBackground = (latestSummaryText, foldThese, lastFoldedMsg, latestSummaryCovered) => {
  (async () => {
    try {
      const summaryPrompt = `You are summarising a renovation project chat between Whitney, Charlie, and RENO. Produce a concise rolling summary (under 400 words, bullet points) capturing key topics, decisions, open questions, contractors mentioned, and any tensions. Do NOT repeat the decision log — focus on context and unresolved items.

${latestSummaryText ? `\nEXISTING SUMMARY (extend with the new messages below):\n${latestSummaryText}\n` : ""}

NEW MESSAGES:
${foldThese.map((m) => `[${m.user_name}]: ${m.content}`).join("\n\n")}

Write the updated summary now.`;

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
      const newSummaryText = data.content?.[0]?.text;
      if (newSummaryText) {
        await supabase.from("summaries").insert({
          summary_text: newSummaryText,
          messages_covered: (latestSummaryCovered || 0) + foldThese.length,
          last_message_at: lastFoldedMsg.created_at,
        });
      }
    } catch (e) {
      console.error("Background summary error:", e.message);
    }
  })();
};

const SUMMARY_THRESHOLD = 30;

const LIVE_DATA_INSTRUCTION = `

=== LIVE DATA ACCESS (IMPORTANT) ===
You have LIVE READ AND WRITE ACCESS to two Google files:
1. The master project document (injected as "LIVE MASTER DOCUMENT")
2. The budget spreadsheet (injected as "LIVE BUDGET SHEET")

You can ALSO read files from Google Drive when their URL is shared — they will be attached as content blocks for you to actually see.

DO NOT claim you cannot access these documents — you can. The content is right there.
=== END LIVE DATA ACCESS ===
`;

const TAG_INSTRUCTION = `

=== DECISION & COST LOGGING (CRITICAL) ===
You MUST detect when decisions, commitments, contractor choices, quotes, or material/spec selections are made. Append structured tags to the END of your response, each on its own line.

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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.query?.action;
  if (action === "write_decision") {
    const result = await appendDecisionToDoc(
      req.body.decision, req.body.logged_by, req.body.cost_impact, req.body.needs_signoff
    );
    return res.status(200).json(result);
  }
  if (action === "write_line_item") {
    const result = await appendLineItemToSheet(req.body);
    return res.status(200).json(result);
  }

  const debug = {
    supabase_configured: !!supabase,
    google_configured: !!googleAuth,
  };
  const startTime = Date.now();

  try {
    const { messages, system } = req.body;

    let detectedFileIds = [];
    if (googleAuth && messages.length > 0) {
      const latestMsg = messages[messages.length - 1];
      const latestContent = typeof latestMsg.content === "string" ? latestMsg.content : "";
      detectedFileIds = extractDriveFileIds(latestContent).slice(0, 2);
    }
    debug.detected_drive_urls = detectedFileIds.length;

    const driveContentPromise = (googleAuth && (Date.now() - cache.ts > CACHE_TTL_MS || !cache.masterDoc))
      ? Promise.all([fetchMasterDoc(), fetchBudgetSheet()]).then(([d, s]) => {
          cache.masterDoc = d;
          cache.budgetSheet = s;
          cache.ts = Date.now();
          return [d, s];
        })
      : Promise.resolve([cache.masterDoc, cache.budgetSheet]);

    const supabasePromise = supabase
      ? Promise.all([
          supabase.from("decisions").select("*").order("created_at", { ascending: false }).limit(30),
          supabase.from("summaries").select("*").order("created_at", { ascending: false }).limit(1),
        ])
      : Promise.resolve([{ data: [] }, { data: [] }]);

    const filesPromise = detectedFileIds.length > 0
      ? Promise.all(detectedFileIds.map(fetchDriveFile))
      : Promise.resolve([]);

    const [[masterDocContent, budgetSheetContent], [decisionsRes, summaryRes], fetchedFiles] =
      await Promise.all([driveContentPromise, supabasePromise, filesPromise]);

    debug.parallel_fetch_ms = Date.now() - startTime;

    let driveBlock = "";
    if (masterDocContent) {
      driveBlock += `\n\n=== LIVE MASTER DOCUMENT ===\n${masterDocContent}\n=== END MASTER DOCUMENT ===\n`;
      debug.master_doc_chars = masterDocContent.length;
    }
    if (budgetSheetContent) {
      driveBlock += `\n\n=== LIVE BUDGET SHEET ===\n${budgetSheetContent}\n=== END BUDGET SHEET ===\n`;
      debug.budget_sheet_chars = budgetSheetContent.length;
    }

    let memoryBlock = "";
    let summaryBlock = "";
    const decisionsData = decisionsRes.data || [];
    debug.decisions_count = decisionsData.length;
    if (decisionsData.length > 0) {
      memoryBlock = "\n\n=== DECISION LOG (most recent first) ===\n";
      decisionsData.forEach((d) => {
        const date = new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        const cost = d.cost_impact ? ` [£${d.cost_impact}]` : "";
        const signoff = d.needs_signoff ? " ⚠️ NEEDS SIGN-OFF" : "";
        memoryBlock += `- ${date} (${d.logged_by})${cost}${signoff}: ${d.decision}\n`;
      });
      memoryBlock += "=== END DECISION LOG ===\n";
    }

    const latestSummary = summaryRes.data?.[0];
    if (latestSummary?.summary_text) {
      summaryBlock = `\n\n=== ROLLING CONVERSATION SUMMARY ===\n${latestSummary.summary_text}\n=== END SUMMARY ===\n`;
      debug.has_summary = true;
    }

    if (supabase) {
      try {
        const sinceTimestamp = latestSummary?.last_message_at || "1970-01-01";
        const { count: newMessagesCount } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .gt("created_at", sinceTimestamp);
        debug.messages_since_summary = newMessagesCount || 0;

        if ((newMessagesCount || 0) >= SUMMARY_THRESHOLD) {
          const { data: messagesToFold } = await supabase
            .from("messages").select("*")
            .gt("created_at", sinceTimestamp)
            .order("created_at", { ascending: true });

          if (messagesToFold && messagesToFold.length > 10) {
            const foldThese = messagesToFold.slice(0, messagesToFold.length - 10);
            triggerSummaryRegenInBackground(
              latestSummary?.summary_text || null,
              foldThese,
              foldThese[foldThese.length - 1],
              latestSummary?.messages_covered || 0
            );
            debug.summary_regen_triggered = true;
          }
        }
      } catch (e) {
        debug.summary_check_error = e.message;
      }
    }

    const attachedFiles = fetchedFiles.filter((f) => f && !f.error);
    const fileErrors = fetchedFiles.filter((f) => f?.error);
    debug.files_attached = attachedFiles.length;
    if (fileErrors.length > 0) debug.file_fetch_errors = fileErrors.map((f) => f.error);

    // ===== Cache structure (the actual cached call) =====
    const stableSystem = system + driveBlock + LIVE_DATA_INSTRUCTION + TAG_INSTRUCTION;
    const dynamicSystem = memoryBlock + summaryBlock;
    debug.stable_system_length = stableSystem.length;
    debug.dynamic_system_length = dynamicSystem.length;

    const apiMessages = messages.map((m, i) => {
      if (i === messages.length - 1 && attachedFiles.length > 0 && m.role === "user") {
        const contentBlocks = [];
        for (const file of attachedFiles) {
          if (file.isPdf) {
            contentBlocks.push({
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: file.base64 },
            });
          } else {
            contentBlocks.push({
              type: "image",
              source: { type: "base64", media_type: file.mimeType, data: file.base64 },
            });
          }
        }
        let textContent = m.content;
        if (fileErrors.length > 0) {
          textContent += `\n\n[Note: ${fileErrors.length} file(s) could not be loaded.]`;
        }
        contentBlocks.push({ type: "text", text: textContent });
        return { role: m.role, content: contentBlocks };
      }
      return m;
    });

    debug.pre_anthropic_ms = Date.now() - startTime;

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
        system: [
          {
            type: "text",
            text: stableSystem,
            cache_control: { type: "ephemeral" },
          },
          ...(dynamicSystem ? [{ type: "text", text: dynamicSystem }] : []),
        ],
        messages: apiMessages,
      }),
    });

    const data = await response.json();
    debug.total_ms = Date.now() - startTime;
    data._debug = debug;

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message, debug });
  }
};
