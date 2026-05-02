import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { messages, system } = await req.json();

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
      if (stateData.completed_tasks) memoryBlock += `Completed tasks:\n${stateData.
