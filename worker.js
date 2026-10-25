// Cloudflare Worker: hält den Gemini-Key geheim (als Secret) und
// akzeptiert nur zwei feste Aufgaben – kein freier Prompt von außen.
const ALLOWED_ORIGINS = [
  "https://DEIN-NAME.github.io",   // <- deine echte Seiten-URL (ohne Pfad)
  "http://localhost:8000",         // <- zum lokalen Testen, später entfernen
];
const MODEL = "gemini-2.5-flash";

const json = (o, s, h) => new Response(JSON.stringify(o), { status: s, headers: { ...h, "Content-Type": "application/json" } });
const cut = (v, n) => String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, n);

async function gemini(env, system, user, maxTokens) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "Gemini-Fehler");
  return (((d.candidates || [])[0] || {}).content?.parts || []).map(p => p.text || "").join("");
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const ok = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST" || !ok) return json({ error: "forbidden" }, 403, cors);

    let b;
    try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, cors); }

    try {
      if (b.type === "check") {
        const cat = cut(b.category, 30), letter = cut(b.letter, 1), ans = cut(b.answer, 60);
        if (!cat || !letter || !ans) return json({ error: "missing" }, 400, cors);
        const sys = "Du bist ein strenger Schiedsrichter für das Spiel Stadt-Land-Fluss. "
          + "Akzeptiere NUR echte, tatsächlich existierende Begriffe, die eindeutig in die genannte Kategorie gehören "
          + "und mit dem geforderten Buchstaben beginnen. Fantasiewörter, Buchstabensalat, Tippfehler, falsche Kategorie "
          + "oder erfundene Namen sind IMMER ungültig. Im Zweifel: ungültig. "
          + 'Antworte ausschließlich mit kompaktem JSON: {"valid": true} oder {"valid": false}. Kein Fließtext, kein Markdown.';
        const usr = `Kategorie: "${cat}"\nGeforderter Anfangsbuchstabe: "${letter}"\nAntwort des Spielers: "${ans}"\n\nIst "${ans}" ein echtes, existierendes Beispiel für die Kategorie "${cat}" und beginnt es mit "${letter}"?`;
        const text = await gemini(env, sys, usr, 40);
        const m = text.match(/\{[^}]*\}/);
        let valid = null;
        try { if (m) { const p = JSON.parse(m[0]); if (typeof p.valid === "boolean") valid = p.valid; } } catch {}
        return json({ valid }, 200, cors);
      }
      if (b.type === "comment") {
        const letter = cut(b.letter, 1), lines = cut(b.lines, 500);
        if (!letter || !lines) return json({ error: "missing" }, 400, cors);
        const sys = "Du bist ein launiger Spielleiter für Stadt-Land-Fluss. Antworte NUR mit einem einzigen kurzen, witzigen Satz auf Deutsch (max. 20 Wörter). Kein JSON, keine Anführungszeichen, kein Markdown.";
        const usr = `Buchstabe der Runde: ${letter}\nErgebnisse:\n${lines}\n\nSchreib einen kurzen, launigen Kommentar zu dieser Runde.`;
        return json({ comment: (await gemini(env, sys, usr, 60)).trim() }, 200, cors);
      }
      return json({ error: "unknown type" }, 400, cors);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502, cors);
    }
  },
};
