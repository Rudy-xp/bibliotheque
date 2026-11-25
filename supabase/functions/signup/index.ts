// Inscription ouverte à tous, sans lien de confirmation par email.
// Crée un compte déjà confirmé ; l'app se connecte ensuite avec email + mot de passe.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);
  let email = "", password = "";
  try { const b = await req.json(); email = String(b.email || "").trim().toLowerCase(); password = String(b.password || ""); }
  catch { return json({ error: "Requête invalide" }, 400); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json({ error: "Email invalide" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "Mot de passe : 8 caractères minimum" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return json({ error: "exists" }, 409);
    return json({ error: "Création impossible pour le moment" }, 500);
  }
  return json({ ok: true });
});
