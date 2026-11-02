// Netlify Function: asks Gemini for 3 jersey design concepts.
// The API key lives in a Netlify environment variable, never in the website code.
const PATTERNS = ["solid", "pinstripes", "hoops", "sash", "chevron", "split"];

const SYSTEM = `You are a sports jersey designer for youth teams. Reply with JSON only:
{"designs":[{"name":"short concept name","body":"#RRGGBB","trim":"#RRGGBB","pattern":"one of ${PATTERNS.join(", ")}","note":"one short sentence on the look"}]}
Rules: exactly 3 designs that are clearly different from each other. body is the main jersey color, trim is the accent color used for stripes, cuffs, collar and sides. Use 6-digit hex colors with good contrast between body and trim. If a current design and feedback are given, apply the feedback to the current design and keep the parts it did not mention similar.`;

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
      ? { responseMimeType: "application/json", temperature: 1 }
      : { temperature: 1 },
  };
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(500, { error: "Missing GEMINI_API_KEY" });
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

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

  try {
    let res = await callGemini(model, key, lines.join("\n"), true);
    if (res.status === 400) res = await callGemini(model, key, lines.join("\n"), false);
    if (!res.ok) return reply(502, { error: "Gemini error " + res.status });
    const data = await res.json();
    const raw = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return reply(200, { designs: parsed.designs || [] });
  } catch (e) {
    return reply(502, { error: "Could not generate designs" });
  }
};
