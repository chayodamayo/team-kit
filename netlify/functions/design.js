// Netlify Function: asks Gemini for 3 jersey design concepts.
// The API key lives in a Netlify environment variable, never in the website code.
const PATTERNS = ["solid", "pinstripes", "hoops", "sash", "chevron", "split"];

const SYSTEM = `You are a sports jersey designer for youth teams. Reply with JSON only:
{"designs":[{"name":"short concept name","body":"#RRGGBB","trim":"#RRGGBB","pattern":"one of ${PATTERNS.join(", ")}","note":"one short sentence on the look"}]}
Rules:
- Exactly 3 designs that are clearly different from each other (different patterns and shades).
- body is the main jersey color. trim is the accent color for stripes, cuffs, collar and sides. Use 6-digit hex colors.
- FOLLOW THE COACH'S COLOR REQUESTS EXACTLY. If they ask for only red, every design must use red shades for both body and trim (for example a dark red body with a bright red trim) and must not introduce other colors. If they name two colors, use only those two.
- If a current design and a requested change are given, apply the change to the current design and keep the parts it did not mention similar.`;

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

async function callGemini(model, key, text, withMime) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: withMime
      ? { responseMimeType: "application/json", temperature: 0.9 }
      : { temperature: 0.9 },
  };
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
}

exports.handler = async (event) => {
  const key = process.env.GEMINI_API_KEY;
  // Visiting the function URL in a browser is a quick health check.
  if (event.httpMethod === "GET") return reply(200, { ok: true, keySet: !!key });
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only" });
  if (!key) return reply(500, { error: "GEMINI_API_KEY is not set in Netlify (add it, then redeploy)" });

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Bad request" }); }
  const clip = (v, n) => String(v || "").slice(0, n);
  const lines = [
    `Sport: ${clip(input.sport, 30)}`,
    `Team name: ${clip(input.team, 20)}`,
    `What the coach wants: ${clip(input.vibe, 300) || "surprise me"}`,
  ];
  if (input.current && input.feedback) {
    lines.push(`Current design: ${clip(JSON.stringify(input.current), 300)}`);
    lines.push(`Change requested: ${clip(input.feedback, 300)}`);
  }
  const prompt = lines.join("\n");

  const models = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"].filter(Boolean);
  let lastError = "Unknown error";
  for (const model of models) {
    try {
      let res = await callGemini(model, key, prompt, true);
      if (res.status === 400) res = await callGemini(model, key, prompt, false);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = `Gemini ${res.status} on ${model}: ${String(data.error?.message || "").slice(0, 140)}`;
        if (res.status === 404) continue;            // model name not available, try the next one
        return reply(502, { error: lastError });      // key problems, rate limits, etc.
      }
      const raw = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (!parsed.designs?.length) { lastError = "Gemini returned no designs"; continue; }
      return reply(200, { designs: parsed.designs, model });
    } catch (e) {
      lastError = "Could not read Gemini's answer on " + model;
    }
  }
  return reply(502, { error: lastError });
};

