import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data } = await supabase.auth.getUser();
    if (!data.user) return json({ error: "Unauthorized" }, 401);

    const apiKey = Deno.env.get("AI_API_KEY");
    if (!apiKey)
      return json(
        {
          error:
            "AI_API_KEY is not configured. Keep provider keys in Supabase secrets, never in Expo.",
        },
        503,
      );
    const baseUrl = (
      Deno.env.get("AI_BASE_URL") ??
      "https://generativelanguage.googleapis.com/v1beta/openai"
    ).replace(/\/$/, "");
    const model = Deno.env.get("AI_MODEL") ?? "gemini-2.5-flash-lite";
    const body = (await request.json()) as {
      mode?: "chat" | "nutrition";
      text?: string;
      imageBase64?: string;
      mimeType?: string;
      context?: Record<string, unknown>;
    };
    const nutrition = body.mode === "nutrition";
    const content = nutrition
      ? [
          {
            type: "text",
            text:
              "Estimate the visible meal and portion. Return ONLY JSON with foodName, calories, proteinG, carbsG, fatG, fiberG, sugarG, sodiumMg, confidence (low|medium|high). Use null when unknown. This is an estimate, not medical advice.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${body.mimeType ?? "image/jpeg"};base64,${body.imageBase64 ?? ""}`,
            },
          },
        ]
      : `You are MetRal AI, a concise fitness and personal-tracking assistant. Never diagnose or make medical claims. Give practical guidance and explain that app-changing commands must be confirmed by the user. User request: ${body.text ?? ""}\nAvailable context: ${JSON.stringify(body.context ?? {})}`;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: nutrition ? 0.1 : 0.5,
        messages: [{ role: "user", content }],
      }),
    });
    if (!response.ok)
      throw new Error(`AI provider returned ${response.status}`);
    const payload = await response.json();
    const text = String(payload.choices?.[0]?.message?.content ?? "");
    if (!nutrition) return json({ text });
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    return json({ nutrition: JSON.parse(cleaned) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
