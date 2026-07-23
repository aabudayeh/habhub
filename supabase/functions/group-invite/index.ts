const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

Deno.serve((request) => {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9-]{3,32}$/.test(code))
    return new Response("Invalid MetricRally invite.", { status: 400, headers });
  const safeCode = escapeHtml(code);
  const deepLink = `paceboard://join?code=${encodeURIComponent(code)}`;
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join MetricRally</title><style>body{font-family:system-ui;background:#f4f7f2;color:#172019;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:white;border-radius:24px;padding:32px;max-width:420px;text-align:center;box-shadow:0 12px 40px #0002}a{display:block;background:#276749;color:white;text-decoration:none;padding:14px;border-radius:14px;font-weight:700;margin:22px 0}.code{font-size:24px;letter-spacing:3px;font-weight:800}</style></head><body><main class="card"><h1>Join MetricRally</h1><p>You have been invited to a group.</p><div class="code">${safeCode}</div><a href="${deepLink}">Open MetricRally</a><small>If the app does not open, install it and use invite code ${safeCode}.</small></main><script>setTimeout(()=>location.href=${JSON.stringify(deepLink)},350)</script></body></html>`, { headers });
});
