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
         model: "claude-sonnet-4-6",
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

=== DECISION LOGGING — CONFIRMATION-DRIVEN ===

CRITICAL BEHAVIOUR CHANGE: Do NOT silently log decisions. Always ASK the user first.

When you detect that a user has expressed something that might be a decision, a quote, a contractor choice, a spec preference, or a commitment — DO NOT emit a logging tag immediately. Instead, ASK them which type of log they want:

EXAMPLE — Whitney says: "I think we should go with the wooden interior doors instead of crittall — saves us about £2k"
You should respond with the answer to her question/comment AS NORMAL, then add at the end:
"📋 **Should I log this?** Options:
- Add as a **final decision** (already settled)
- Add as a **pending decision** (needs the other person's sign-off)
- Just note it (don't add to any log)"

When the user replies with their choice (e.g. "yes pending", "log as final", "yes pending, deadline next Friday"):
- For "final decision" → emit [LOG_DECISION] tag (existing behaviour)
- For "pending decision" → emit [LOG_PENDING] tag (new — see below)
- For "just note" → emit no tag

WHEN TO PROACTIVELY ASK:
- Specific costs/quotes mentioned (£X for Y)
- Contractor or vendor names mentioned as choices ("going with X")
- Material/spec preferences ("we want X over Y")
- Statements like "decided", "confirmed", "going with", "let's do"
- ESPECIALLY when only ONE user is in the conversation but the decision affects both

WHEN NOT TO ASK:
- Obvious facts or questions (no decision being made)
- Casual discussion or research updates
- Things the user is just thinking out loud about

NEW TAG — PENDING DECISION:
[LOG_PENDING] proposed_by="<Whitney|Charlie>" category="<category>" cost="<number or empty>" reasoning="<why>" deadline="<YYYY-MM-DD or empty>" decision="<short description>"

EXISTING TAG — FINAL DECISION (only when explicitly confirmed):
[LOG_DECISION] category="<category>" cost="<number or empty>" signoff="<true or false>" decision="<short description>"

EXISTING TAG — LINE ITEM (only when committing to a budget cost):
[LOG_LINE_ITEM] category="<budget category>" room="<room>" item="<description>" vendor="<vendor>" status="<status>" estimate="<number>" quote="<number>" actual="<number>" decided_by="<Whitney|Charlie|Joint>" notes="<notes>"

Categories: structural | finishes | budget | contractor | timeline | sustainability | quote | other
Budget categories (for line items): Structural / Kitchen / Doors | Garden Office | Basement / Bathroom / UFH | Joinery / Storage / Finishes | Tech / Electrical / V-Rads | Contingency | Rent overrun buffer
Rooms: Ground Floor (Open Plan) | Kitchen | Basement | Bathroom | Bedroom 1 | Bedroom 2 | Bedroom 3 | Garden Office | Hallway / Storage | Whole property | External / Garden | Other
Status: Estimating | Awaiting quote | Quoted | Approved | In progress | Paid | Cancelled

DEADLINE SUGGESTIONS for pending decisions:
- If user doesn't specify, suggest one based on context: "I'd suggest a deadline of [date] given [reason]. Sound right?"
- Project timeline pressures: ownership June 26, target completion mid-September, school starts Sept 7
- Use ISO format YYYY-MM-DD when emitting the tag

PENDING DECISIONS REFERENCE:
You have access to the live PENDING DECISIONS list in your context. When the user asks about pending items or asks "what needs to be decided?", reference that list directly. Surface items where the current user hasn't responded yet, and overdue items.

DO NOT emit tags for general advice, suggestions, or questions.
=== END DECISION LOGGING ===
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

  if (action === "upload_to_drive") {
    if (!googleAuth) return res.status(500).json({ error: "Drive not configured" });
    try {
      const { filename, mimeType, base64 } = req.body;
      const drive = google.drive({ version: "v3", auth: googleAuth });
      const buffer = Buffer.from(base64, "base64");
      const { Readable } = require("stream");
      const result = await drive.files.create({
        requestBody: {
          name: filename,
          parents: process.env.DRIVE_FOLDER_ID ? [process.env.DRIVE_FOLDER_ID] : undefined,
        },
        media: {
          mimeType,
          body: Readable.from(buffer),
        },
        fields: "id, name, webViewLink",
      });
      return res.status(200).json({ ok: true, file: result.data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === "create_pending") {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    try {
      const { proposed_by, category, decision, cost_impact, reasoning, deadline } = req.body;
      // The proposer auto-approves their own proposal
      const initialState = proposed_by === "Whitney"
        ? { whitney_status: "approved", whitney_responded_at: new Date().toISOString() }
        : { charlie_status: "approved", charlie_responded_at: new Date().toISOString() };
      const { data, error } = await supabase.from("pending_decisions").insert({
        proposed_by,
        category: category || "other",
        decision,
        cost_impact: cost_impact || null,
        reasoning: reasoning || null,
        deadline: deadline || null,
        ...initialState,
      }).select();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, pending: data?.[0] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === "respond_to_pending") {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    try {
      const { id, user, status, note } = req.body;
      // status is "approved" or "rejected"
      const updates = {
        [`${user.toLowerCase()}_status`]: status,
        [`${user.toLowerCase()}_responded_at`]: new Date().toISOString(),
        [`${user.toLowerCase()}_note`]: note || null,
      };
      // Update the row
      const { data: updated, error } = await supabase
        .from("pending_decisions").update(updates)
        .eq("id", id).select();
      if (error) return res.status(500).json({ error: error.message });
      const item = updated?.[0];
      if (!item) return res.status(404).json({ error: "Not found" });

      // Check if both approved → move to final decisions log
      if (item.whitney_status === "approved" && item.charlie_status === "approved") {
        await supabase.from("pending_decisions").update({ final_status: "both_approved" }).eq("id", id);
        // Insert into final decisions log
        await supabase.from("decisions").insert({
          category: item.category,
          decision: item.decision + " (jointly approved)",
          cost_impact: item.cost_impact,
          needs_signoff: false,
          source: "pending_approved",
          logged_by: "Whitney + Charlie",
        });
        // Append to master doc as well
        if (googleAuth && process.env.MASTER_DOC_ID) {
          await appendDecisionToDoc(
            item.decision + " (jointly approved)",
            "Whitney + Charlie",
            item.cost_impact,
            false
          );
        }
        return res.status(200).json({ ok: true, finalized: true, item });
      }
      return res.status(200).json({ ok: true, finalized: false, item });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === "list_pending") {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    try {
      const { data, error } = await supabase
        .from("pending_decisions").select("*")
        .neq("final_status", "both_approved")
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ pending: data || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === "brief") {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    try {
      const targetUser = req.body.user;

      // Get last 7 days of decisions
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentDecisions } = await supabase
        .from("decisions").select("*")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false });

      // Get last 30 messages from chat history
      const { data: recentMessages } = await supabase
        .from("messages").select("*")
        .order("created_at", { ascending: false })
        .limit(30);

      // Build the briefing prompt
      const decisionsBlock = recentDecisions && recentDecisions.length > 0
        ? recentDecisions.map(d => {
            const date = new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const cost = d.cost_impact ? ` (£${d.cost_impact})` : "";
            const signoff = d.needs_signoff ? " ⚠️ NEEDS SIGN-OFF" : "";
            return `- [${date}] ${d.logged_by}${cost}${signoff}: ${d.decision}`;
          }).join("\n")
        : "(no decisions logged in the last 7 days)";

      const messagesBlock = recentMessages && recentMessages.length > 0
        ? recentMessages.reverse().map(m => `[${m.user_name}]: ${m.content}`).join("\n\n")
        : "(no recent messages)";

      const briefingPrompt = `You are RENO. Generate a personalised briefing for ${targetUser} (one of two project owners — Whitney and Charlie).

The briefing should be SHORT and FOCUSED. Format:

**Welcome back, ${targetUser}.**

📋 **What's been decided** (last 7 days)
[Bullet list of 3-7 most relevant recent decisions. Skip if none.]

🔄 **Open threads waiting on you**
[Things ${targetUser} should respond to or take action on, based on chat history. Look for: questions directed at them, decisions that need their sign-off, things the OTHER person flagged or asked about that ${targetUser} hasn't responded to.]

📝 **You should give an update on**
[Things ${targetUser} previously committed to or is researching, based on chat history. Examples: contractor quotes they were getting, surveys they were booking, decisions they said they'd think about.]

Keep it tight. Maximum 200 words total. If a section has nothing, skip it entirely. Don't repeat decisions in multiple sections.

=== RECENT DECISIONS ===
${decisionsBlock}

=== RECENT CHAT HISTORY ===
${messagesBlock}

Generate the briefing now for ${targetUser}.`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 700,
          messages: [{ role: "user", content: briefingPrompt }],
        }),
      });
      const data = await response.json();
      const briefing = data.content?.[0]?.text || "Couldn't generate briefing.";
      return res.status(200).json({ briefing });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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

    // Also fetch pending decisions for context
        const { data: pendingData } = await supabase
          .from("pending_decisions").select("*")
          .neq("final_status", "both_approved")
          .order("created_at", { ascending: false }).limit(20);
        debug.pending_count = pendingData?.length || 0;
        if (pendingData && pendingData.length > 0) {
          memoryBlock += "\n\n=== PENDING DECISIONS (awaiting joint sign-off) ===\n";
          pendingData.forEach((p) => {
            const date = new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const cost = p.cost_impact ? ` [£${p.cost_impact}]` : "";
            const deadline = p.deadline ? ` [due ${p.deadline}]` : "";
            const status = `Whitney: ${p.whitney_status}, Charlie: ${p.charlie_status}`;
            memoryBlock += `- ${date} (proposed by ${p.proposed_by})${cost}${deadline}: ${p.decision} — ${status}\n`;
          });
          memoryBlock += "=== END PENDING DECISIONS ===\n";
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

// Accept files passed directly from the app (in addition to Drive URLs)
    const directlyUploadedFiles = req.body.uploadedFiles || [];
    const allAttachedFiles = [...attachedFiles, ...directlyUploadedFiles];
    debug.directly_uploaded = directlyUploadedFiles.length;
    
    const apiMessages = messages.map((m, i) => {
      if (i === messages.length - 1 && allAttachedFiles.length > 0 && m.role === "user") {
        const contentBlocks = [];
        for (const file of allAttachedFiles) {
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
        model: "claude-haiku-4-5-20251001",
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
