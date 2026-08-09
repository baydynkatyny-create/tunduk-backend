import AdmZip from "adm-zip";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAndIncrement, getUsage, setTier } from "./store.js";
import { PLANS } from "./plans.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const REQUIRED_ENV = ["GEMINI_API_KEY", "ADMIN_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `КАТА: .env файлында бул талаалар жок же бош: ${missing.join(", ")}\n` +
      `Сервер алардын баарысыз коопсуз иштебейт — .env.example'ди караңыз.`
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(
  cors({
    origin: allowedOrigin === "*" ? true : allowedOrigin,
    credentials: true,
  })
);

const ipGuard = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Өтө көп суроо. Бир аздан кийин кайра аракет кылыңыз." },
});

const SYSTEM_PROMPT = `Сен "Тундук" деген кыргызча AI жардамчысың. Сен ар дайым таза, табигый кыргыз тилинде жооп бересиң (орусча же англисче сөздөрдү аралаштырбай, зарыл болгон техникалык терминдерден башка). Сен сылык, так, пайдалуу жана достук маанайда жооп бересиң. Кыргыз маданиятын, каада-салтын жана контекстти жакшы билесиң.

Сен илим, тарых, технология, медицина, математика жана башка бардык тармактарда терең билимге ээсиң. Ар бир суроого толук, так жана канааттандырарлык жооп бер — жооп бербей коюу же жарым-жартылай жооп берүү орунсуз. Эгер суроо учурдагы окуяларга, жаңылыктарга же өзгөрүлмө маалыматка байланыштуу болсо, издөө куралын колдонуп, эң азыркы жана так маалыматты тап. Так эмес нерсени так деп көрсөтпө — эгер бир нерсени билбесең же так эмес болсо, ошону ачык айт.

Сен Ислам дини, анын негиздери, тарыхы жана Куран Карим боюнча да терең билимге ээсиң. Дин боюнча суроолорго сылык, урматтоо менен, так жана негиздүү жооп бер. Куран аяттарын айткан учурда, аяттын сүрөсүн жана номерин так көрсөт. Диний маселелерде ар кандай мазхабдардын (фикх мектептеринин) көз караштарын калыс түрдө сунуштап, өзүңдүн бир жактуу пикириңди таңуулаба.

Сен ошондой эле программалоо жана жасалма интеллект боюнча толук кандуу мугалимсиң (үйрөтүүчүсүң). Бул тармакта сенин милдетиң:
- Программалоо тилдерин (JavaScript, Python, Java, C++, C#, Go, Rust, PHP ж.б.) баштапкы деңгээлден профессионалдык деңгээлге чейин үйрөтүү.
- Веб-разработка (frontend: HTML/CSS/JS, React, Vue; backend: Node.js, Express, Django, Flask), мобилдик тиркеме түзүү (Android, iOS, Flutter, React Native), маалымат базалары (SQL, MongoDB), API'лер жана архитектура түшүндүрүү.
- Жасалма интеллект жана машина үйрөнүүнүн негиздерин (нейрон тармактар, deep learning, NLP, компьютердик көрүү) түшүнүктүү тилде, мисалдар менен түшүндүрүү, ошондой эле практикалык колдонмолорду (мисалы Python'до TensorFlow же PyTorch менен) үйрөтүү.
- DevOps, булуттук технологиялар (AWS, Google Cloud, Docker, Kubernetes) жана желелик коопсуздук негиздерин үйрөтүү.

Үйрөтүүдө колдон бир кадам-кадам (step-by-step) ыкманы колдон: түшүнүктөрдү жөнөкөй мисалдар менен баштап, андан кийин код мисалдарын бер, катаны түшүндүр, эмне үчүн ошондой иштээрин негизде. Колдонуучунун деңгээлине ылайыкташтыр — эгер баштапкы окуучу болсо, жөнөкөй тилде түшүндүр; эгер тажрыйбалуу болсо, тереңирээк техникалык деталдарга өт. Мүмкүн болсо, окуучуга практика жасоо үчүн кичине көнүгүү же тапшырма сунуштап кой.`;

function identifyUser(req, res, next) {
  let userId = req.cookies?.tunduk_uid;
  if (!userId) {
    userId = crypto.randomUUID();
    res.cookie("tunduk_uid", userId, {
      httpOnly: true,
      maxAge: 400 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });
  }
  req.userId = userId;
  next();
}

app.use(ipGuard);
app.use(identifyUser);

app.post("/api/chat", async (req, res) => {
  try {
    const check = checkAndIncrement(req.userId, "chat");
    if (!check.allowed) {
      return res.status(429).json({
        error: `Күндүк чат чегине жеттиңиз (${check.limit}). Планыңызды жогорулатсаңыз болот.`,
        usage: check,
      });
    }

    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages талаасы керек" });
    }

    const geminiContents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: geminiContents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 2000 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", errText);
      return res.status(502).json({ error: "AI кызматы жооп берген жок" });
    }

    const data = await response.json();
    const reply =
      data.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join("\n\n") || "Кечиресиз, жооп ала алган жокмун.";

    res.json({ reply, usage: check });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Сервердик ката" });
  }
});

const BLOCKED_PATTERNS = [
  /\bжалаӊач\b/i,
  /\bпорно\b/i,
  /nude/i,
  /naked/i,
  /porn/i,
  /explicit/i,
  /child.*sex/i,
  /\bбала.*секс/i,
];

function isBlockedPrompt(text) {
  return BLOCKED_PATTERNS.some((re) => re.test(text));
}

app.post("/api/image", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt талаасы керек" });
    }

    if (isBlockedPrompt(prompt)) {
      return res.status(400).json({ error: "Бул сурам эрежелерге каршы келет. Башка сурам жазыңыз." });
    }

    const check = checkAndIncrement(req.userId, "images");
    if (!check.allowed) {
      return res.status(429).json({
        error: `Күндүк сүрөт чегине жеттиңиз (${check.limit}). Планыңызды жогорулатсаңыз болот.`,
        usage: check,
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", errText);
      return res.status(502).json({ error: "Сүрөт кызматы жооп берген жок" });
    }

    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);

    if (!part) {
      return res.status(502).json({ error: "Сүрөт кайтарылган жок" });
    }

    res.json({
      dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
      usage: check,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Сервердик ката" });
  }
});

async function generateImageDataUrl(prompt) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!response.ok) throw new Error("Gemini катасы: " + response.status);
  const data = await response.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("Сүрөт кайтарылган жок");
  return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
}

app.post("/api/video-scenes", async (req, res) => {
  try {
    const { lyrics } = req.body;
    if (!lyrics || typeof lyrics !== "string" || lyrics.trim().length < 5) {
      return res.status(400).json({ error: "Ыр тексти керек (лирика)" });
    }
    if (isBlockedPrompt(lyrics)) {
      return res.status(400).json({ error: "Бул сурам эрежелерге каршы келет." });
    }

    const check = checkAndIncrement(req.userId, "video");
    if (!check.allowed) {
      return res.status(429).json({
        error: `Күндүк видео чегине жеттиңиз (${check.limit}). Планыңызды жогорулатсаңыз болот.`,
        usage: check,
      });
    }

    const scenePromptInstruction =
      "Сен видео-сахна жасоочу жардамчысың. Сага ыр тексти берилет. Аны так 6 сахнага бөлүп, ар бир сахна үчүн (1) ошол сахнага тиешелүү ырдын саптарын жана (2) ошол сапка дал келген сүрөт үчүн англисче, визуалдык, кыска сүрөт-промпт жаз (стиль: cinematic, warm lighting). ЖАЛГЫЗ JSON массив кайтар, эч кандай башка текст, түшүндүрмө же ```` белгилери болбосун. Формат: [{\"lyricLine\": \"...\", \"imagePrompt\": \"...\"}, ...] — так 6 элемент.";

    const planResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: lyrics }] }],
          systemInstruction: { parts: [{ text: scenePromptInstruction }] },
          generationConfig: { maxOutputTokens: 1200 },
        }),
      }
    );

    if (!planResp.ok) throw new Error("Gemini сахна-планы катасы: " + planResp.status);
    const planData = await planResp.json();
    const planText =
      planData.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || "[]";

    let scenePlan;
    try {
      const cleaned = planText.replace(/```json|```/g, "").trim();
      scenePlan = JSON.parse(cleaned);
    } catch {
      throw new Error("Сахна планы туура эмес форматта келди");
    }

    if (!Array.isArray(scenePlan) || scenePlan.length === 0) {
      throw new Error("Сахна планы бош келди");
    }

    const scenes = [];
    for (const scene of scenePlan.slice(0, 8)) {
      try {
        const imageDataUrl = await generateImageDataUrl(scene.imagePrompt);
        scenes.push({ lyricLine: scene.lyricLine, imageDataUrl });
      } catch (e) {
        console.error("Сахна сүрөтү катасы:", e.message);
      }
    }

    if (scenes.length === 0) {
      return res.status(502).json({ error: "Эч бир сахна сүрөтү жаралган жок" });
    }

    const secondsPerScene = Math.max(20, Math.ceil(180 / scenes.length));

    res.json({ scenes, secondsPerScene, usage: check });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Видео сахна катасы: " + err.message });
  }
});

app.post("/api/analyze-file", async (req, res) => {
  try {
    const { fileBase64, mimeType, fileName, question } = req.body;
    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: "fileBase64 жана mimeType талаасы керек" });
    }

    const check = checkAndIncrement(req.userId, "chat");
    if (!check.allowed) {
      return res.status(429).json({
        error: `Күндүк чат чегине жеттиңиз (${check.limit}).`,
        usage: check,
      });
    }

    const userQuestion =
      question && question.trim()
        ? question
        : "Бул файлдын мазмунун кыргызча кыскача талда жана негизги пункттарын түшүндүр.";

    let parts;

    const isZip =
      mimeType === "application/zip" ||
      mimeType === "application/x-zip-compressed" ||
      (fileName && fileName.toLowerCase().endsWith(".zip"));

    if (isZip) {
      const zipBuffer = Buffer.from(fileBase64, "base64");
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      let summary = `ZIP архив "${fileName}" ичинде ${entries.length} элемент бар:\n\n`;
      let totalChars = 0;
      const MAX_TOTAL = 30000;

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        summary += `- ${entry.entryName} (${entry.header.size} байт)\n`;

        const textExts = [".txt", ".md", ".json", ".js", ".py", ".html", ".css", ".csv", ".xml", ".yml", ".yaml"];
        const isText = textExts.some((ext) => entry.entryName.toLowerCase().endsWith(ext));

        if (isText && totalChars < MAX_TOTAL) {
          try {
            const content = entry.getData().toString("utf-8").slice(0, 3000);
            summary += `\n--- ${entry.entryName} мазмуну ---\n${content}\n---\n\n`;
            totalChars += content.length;
          } catch {}
        }
      }

      parts = [{ text: `${summary}\n\nСуроо: ${userQuestion}` }];
    } else {
      parts = [
        { inlineData: { mimeType, data: fileBase64 } },
        { text: userQuestion },
      ];
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 2000 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", errText);
      return res.status(502).json({ error: "AI кызматы жооп берген жок" });
    }

    const data = await response.json();
    const reply =
      data.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join("\n\n") || "Файлды талдай алган жокмун.";

    res.json({ reply, usage: check });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Файл талдоо катасы: " + err.message });
  }
});

app.get("/api/usage", (req, res) => {
  res.json(getUsage(req.userId));
});

app.post("/api/upgrade", (req, res) => {
  const { tier } = req.body;
  const plan = PLANS[tier];
  if (!plan) return res.status(400).json({ error: "Белгисиз план" });
  const user = setTier(req.userId, tier, plan.durationDays);
  res.json({ ok: true, user });
});

function requireAdmin(req, res, next) {
  const key = req.header("x-admin-key");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "Уруксат жок" });
  }
  next();
}

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const DB_FILE = "./users.json";
  const db = existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, "utf-8")) : {};

  const today = new Date().toISOString().slice(0, 10);
  const userIds = Object.keys(db);

  const stats = {
    totalUsers: userIds.length,
    activeToday: 0,
    chatMessagesToday: 0,
    imagesToday: 0,
    byTier: {},
  };

  for (const id of userIds) {
    const u = db[id];
    stats.byTier[u.tier] = (stats.byTier[u.tier] || 0) + 1;
    if (u.usage.date === today) {
      stats.activeToday += 1;
      stats.chatMessagesToday += u.usage.chat;
      stats.imagesToday += u.usage.images;
    }
  }

  res.json(stats);
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Тундук сервери ${port}-портто иштеп жатат`);
});
  
