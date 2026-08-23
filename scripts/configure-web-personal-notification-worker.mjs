const required = (name, alternatives = []) => {
  for (const candidate of [name, ...alternatives]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new Error(`${[name, ...alternatives].join(" or ")} is required`);
};

const supabaseUrl = required("EXPO_PUBLIC_SUPABASE_URL", ["SUPABASE_URL"])
  .replace(/\/+$/, "");
const secret = required("PERSONAL_NOTIFICATION_WORKER_SECRET");
if (secret.length < 32 || /\s/.test(secret))
  throw new Error("PERSONAL_NOTIFICATION_WORKER_SECRET must be at least 32 characters without whitespace");

const endpoint = new URL(`${supabaseUrl}/functions/v1/web-personal-notifications`);
if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".supabase.co"))
  throw new Error("Use the canonical HTTPS Supabase project URL");

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "configure" }),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok || payload?.configured !== true)
  throw new Error(
    `Web personal notification worker configuration failed (${response.status})`,
  );
console.log("Configured and verified the closed-PWA personal reminder worker.");
