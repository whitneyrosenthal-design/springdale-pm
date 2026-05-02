const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const { messages, system } = JSON.parse(event.body);

    // Fetch the project state and recent decisions to inject as context
    const { data: stateData } = await supabase
      .from("project_state")
      .select("*")
      .eq("id", 1)
      .single();

    const { data: decisionsData } = await supabase
      .from("decisions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    // Build memory context block
    let memoryBlock = "\n\n=== PROJECT MEMORY (always current) ===\n";

    if (stateData) {
      memoryBlock += `\nPROJECT STATE SUMMARY:\n${stateData.summary || "(not yet set)"}\n`;
      if (stateData.budget_spent) memoryBlock += `Budget spent so far: £${stateData.budget_spent}\n`;
      if (stateData.active_quotes) memoryBlock += `Active quotes:\n${stateData.active_quotes}\n`;
      if (stateData.open_questions) memoryBlock += `Open questions:\n${stateData.open_questions}\n`;
      if (stateData.completed_tasks) memoryBlock += `Completed tasks:\n${stateData.completed_tasks}\n`;
      if (stateData.contractor_list) memoryBlock += `Contractors:\n${stateData.contractor_list}\n`;
    }

    if (decisionsData && decisionsData.length > 0) {
      memoryBlock += `\nDECISION LOG (most recent first, ${decisionsData.length} entries):\n`;
      decisionsData.forEach((d) => {
        const date = new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        const cost = d.cost_impact ? ` [£${d.cost_impact}]` : "";
        const signoff = d.needs_signoff ? " ⚠️ NEEDS SIGN-OFF" : "";
        memoryBlock += `- ${date} (${d.logged_by})${cost}${signoff}: ${d.decision}\n`;
      });
    }

    memoryBlock += `\n=== END PROJECT MEMORY ===\n\nIMPORTANT: When you detect that a decision, quote, contractor choice, or commitment has been made in the conversation, append a structured tag to the END of your response on its own line, in this exact format:\n[LOG_DECISION] category="<category>" cost="<number or empty>" signoff="<true or false>" decision="<short description>"\n\nCategories: structural | finishes | budget | contractor | timeline | sustainability | quote | other\nMark signoff="true" if the decision is over £500, structural, or aesthetically irreversible.\nOnly emit this tag for genuine new decisions or commitments — not for general advice or suggestions.\nYou may emit multiple tags if multiple decisions occurred in one message.`;

    const fullSystem = system + memoryBlock;

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
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
