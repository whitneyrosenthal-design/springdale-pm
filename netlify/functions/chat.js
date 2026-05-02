const { createClient } = require("@supabase/supabase-js");

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

const TAG_INSTRUCTION = `

=== DECISION LOGGING (CRITICAL) ===
You MUST detect when decisions, commitments, contractor choices, quotes, or material/spec selections are made in the conversation. When you detect one, you MUST append a structured tag to the END of your response on its own line.

EXACT FORMAT (copy precisely):
[LOG_DECISION] category="<category>" cost="<number or empty>" signoff="<true or false>" decision="<short description>"

Categories: structural | finishes | budget | contractor | timeline | sustainability | quote | other
Set signoff="true" if the decision is over £500, structural, or aesthetically hard to reverse.
You may emit multiple tags (one per line) if multiple decisions occurred.
Emit the tag for ANY clear decision, even tentative ones — Whitney and Charlie need a paper trail.

EXAMPLES of when to emit:
- "Let's go with sheep's wool insulation, £800" → emit a tag
- "I've booked J. Murphy as the surveyor for £450" → emit a tag
- "Confirmed we want the open-plan layout" → emit a tag

DO NOT emit tags for general advice, suggestions you're proposing, or questions.
=== END DECISION LOGGING ===
`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const debug = { supabase_configured: !!supabase };

  try {
    const { messages, system } = JSON.parse(event.body);

    let memoryBlock = "";

    if (supabase) {
      try {
        const { data: stateData, error: stateErr } = await supabase
          .from("project_state").select("*").eq("id", 1).single();
        const { data: decisionsData, error: decErr } = await supabase
          .from("decisions").select("*")
          .order("created_at", { ascending: false }).limit(50);

        debug.state_error = stateErr?.message || null;
        debug.decisions_error = decErr?.message || null;
        debug.decisions_count = decisionsData?.length || 0;

        memoryBlock = "\n\n=== PROJECT MEMORY (always current) ===\n";
        if (stateData) {
          memoryBlock += `\nPROJECT STATE: ${stateData.summary || "(not yet set)"}\n`;
          if (stateData.budget_spent) memoryBlock += `Budget spent: £${stateData.budget_spent}\n`;
          if (stateData.active_quotes) memoryBlock += `Active quotes:\n${stateData.active_quotes}\n`;
          if (stateData.open_questions) memoryBlock += `Open questions:\n${stateData.open_questions}\n`;
          if (stateData.completed_tasks) memoryBlock += `Completed tasks:\n${stateData.completed_tasks}\n`;
          if (stateData.contractor_list) memoryBlock += `Contractors:\n${stateData.contractor_list}\n`;
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

    const fullSystem = system + memoryBlock + TAG_INSTRUCTION;

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
