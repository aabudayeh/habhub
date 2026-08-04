const headers = {
  "cache-control": "no-store",
};

Deno.serve((request) => {
  const code =
    new URL(request.url).searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9-]{3,32}$/.test(code))
    return new Response("Invalid HabHub invite.", {
      status: 400,
      headers,
    });

  // Supabase deliberately rewrites HTML Edge Function responses to plain text.
  // A direct HTTPS -> app-scheme redirect opens the installed app without
  // exposing raw HTML or requiring the recipient to copy the invite code.
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: `paceboard://join?code=${encodeURIComponent(code)}`,
    },
  });
});
