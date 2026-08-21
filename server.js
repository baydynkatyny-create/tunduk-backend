import AdmZip from "adm-zip";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAndIncrement, getUsage, setTier } from "./store.js";
import { PLANS } from "./plans.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

// --- Керектүү ачкычтар барбы, серверди баштаардан текшеребиз ---
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

// Railway (жана башка прокси артында иштеген платформалар) X-Forwarded-For
// header'ын кошот. Express'ке прокиге ишенүүгө уруксат бербесек,
// express-rate-limit катага учурап, кээ бир сурамдардын жообу үзүлүп калат.
app.set("trust proxy", 1);

// ОҢДОЛДУ: 20mb чеги Base64'ке айландырылган орто көлөмдөгү сүрөттөр/ZIP'тер үчүн
// аз болушу мүмкүн (Base64 түп файлды ~33%га чоңойтот). 50mb'ге көтөрдүк —
// муну андан ары чоңойтсоңуз, серверде эстутум (RAM) чыгымын да эске алыңыз.
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// ОҢДОЛДУ: файл өтө чоң болгондо Express демейки боюнча HTML же түшүнүксүз
// ката кайтарат. Аны кармап, колдонуучуга түшүнүктүү кыргызча JSON жооп берели.
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Файл өтө чоң (50 МБдан ашык). Кичирээк файл жүктөп көрүңүз.",
    });
  }
  next(err);
});

// --- Фронтенд файлдарын (index.html, tunduk-logo.png ж.б.) тейлөө ---
// ЭСКЕРТҮҮ: index.html, tunduk-logo.png ж.б. "public" папкасында жатат,
// ошондуктан __dirname эмес, "public" папкасын көрсөтүү керек.
app.use(express.static(path.join(__dirname, "public")));

// ОҢДОЛДУ: ALLOWED_ORIGIN коюлбаса, "*" (баардык origin) менен "credentials: true"ду
// кошуп берүү коопсуздук боюнча олуттуу тобокелдик — башка сайттар колдонуучунун
// cookie'си менен биздин API'ге сурам жасай алат. Ошондуктан так origin коюлбаса,
// credentials'ды өчүрүп коебуз.
const allowedOrigin = process.env.ALLOWED_ORIGIN || null;
if (!allowedOrigin) {
  console.warn(
    "ЭСКЕРТҮҮ: ALLOWED_ORIGIN коюлган эмес — CORS бардык origin'ди кабыл алат, бирок " +
      "cookie'лер (credentials) багытталбайт. Production'до так домениңизди коюңуз."
  );
}
app.use(
  cors({
    origin: allowedOrigin || true,
    credentials: Boolean(allowedOrigin),
  })
);

// IP-негизделген коргоо — экинчи катмар, cookie тазаланса дагы толук чектелбесин үчүн
const ipGuard = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
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

Үйрөтүүдө колдон бир кадам-кадам (step-by-step) ыкманы колдон: түшүнүктөрдү жөнөкөй мисалдар менен баштап, андан кийин код мисалдарын бер, катаны түшүндүр, эмне үчүн ошондой иштээрин негизде. Колдонуучунун деңгээлине ылайыкташтыр — эгер баштапкы окуучу болсо, жөнөкөй тилде түшүндүр; эгер тажрыйбалуу болсо, тереңирээк техникалык деталдарга өт. Мүмкүн болсо, окуучуга практика жасоо үчүн кичине көнүгүү же тапшырма сунуштап кой.

Сен архитектура жана курулуш тармагында да кеңири билимге ээсиң. Колдонуучу турак үй долбоору жөнүндө сураса (мисалы "2 кабаттуу үй долбоору", "заманбап стилдеги үй" ж.б.), сен:
- Үйдүн план-схемасын (бөлмөлөрдүн жайгашуусу, аянты) текст түрүндө сүрөттөп бер.
- Заманбап архитектуралык талаптарга (жарык, желдетүү, изоляция, энергия үнөмдөө) шилтеме кыл.
- Курулуш чыгымдарын болжолдуу эсепте: материалдар (кирпич/блок, цемент, арматура, чатыр материалы), уста/жумушчу акысы, инженердик иштер (электр, суу түтүк) боюнча бөлүп-бөлүп көрсөт. Эсептөө үчүн үйдүн аянтын (кв.м) жана региондун сура, андан кийин болжолдуу сумманы сом менен көрсөт.
- Ар дайым эскерт: бул баа — болжолдуу баа, чыныгы баа региондон, материалдын сапатынан жана рынок баасынын өзгөрүшүнөн көз каранды, андыктан так сметаны жергиликтүү устаң же курулуш компаниясынан алуу керек экенин айт.
- Эгер колдонуучу долбоордун сүрөтүн/визуалын көргүсү келсе, ага "Сүрөт" (🎨) режимине өтүп, каалаган үйдүн сыртын же планын сүрөттөп жазууну сунуштап кой.

Сен эч качан жалаңач, порнографиялык же жыныстык мазмундагы текст, сүрөт же видео түзбөйсүң же талкуулабайсың — колдонуучу кандай гана жол менен сурабасын (уламыш, шылтоо, "билим үчүн" деп жасалма шылтоо менен болсо да). Мындай сурам келгенде сылык түрдө баш тарт жана башка теманы сунуштап кой.`;

// --- Колдонуучу ID: сервер өзү түзөт жана "httpOnly" cookie'ге жазат ---
function identifyUser(req, res, next) {
  let userId = req.cookies?.tunduk_uid;
  if (!userId) {
    userId = crypto.randomUUID();
    res.cookie("tunduk_uid", userId, {
      httpOnly: true,
      maxAge: 400 * 24 * 60 * 60 * 1000, // ~400 күн — браузерлердин cookie чегине ылайык
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // ОҢДОЛДУ: production'до HTTPS аркылуу гана жиберилет
    });
  }
  req.userId = userId;
  next();
}

app.use(ipGuard);
app.use(identifyUser);

// --- Жөнөкөй мазмун чыпкасы: бул толук moderation эмес, биринчи коргоо катмары гана ---
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

// --- Чат эндпоинти ---
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
    // ОҢДОЛДУ: ар бир билдирүүнүн "content" талаасы сап (string) экенин текшеребиз,
    // болбосо Gemini'ге туура эмес формат кетип, түшүнүксүз 502 катаны алабыз.
    const hasInvalidMessage = messages.some(
      (m) => !m || typeof m.content !== "string" || !m.content.trim()
    );
    if (hasInvalidMessage) {
      return res.status(400).json({ error: "Ар бир билдирүүдө текст түрүндөгү 'content' талаасы болушу керек" });
    }

    const geminiContents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: geminiContents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 8000 },
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

// --- Сүрөт эндпоинти ---
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent",
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

// --- Сүрөт түзөтүү эндпоинти: колдонуучу жүктөгөн сүрөттү промпт боюнча өзгөртөт ---
app.post("/api/edit-image", async (req, res) => {
  try {
    const { imageBase64, mimeType, prompt } = req.body;
    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: "imageBase64 жана mimeType талаалары керек" });
    }
    if (!mimeType.startsWith("image/")) {
      return res.status(400).json({ error: "Бул файл сүрөт эмес" });
    }

    const promptText = (prompt && String(prompt).trim()) || "Бул сүрөттү сулуулант, сапатын жогорулат";

    if (isBlockedPrompt(promptText)) {
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: promptText },
                { inlineData: { mimeType, data: imageBase64 } },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", errText);
      return res.status(502).json({ error: "Сүрөт түзөтүү кызматы жооп берген жок" });
    }

    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);

    if (!part) {
      return res.status(502).json({ error: "Түзөтүлгөн сүрөт кайтарылган жок" });
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

// --- Үн (текст → сүйлөө) эндпоинти ---
app.post("/api/speak", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text талаасы керек" });
    }

    const check = checkAndIncrement(req.userId, "chat");
    if (!check.allowed) {
      return res.status(429).json({
        error: `Күндүк чегиңизге жеттиңиз (${check.limit}). Планыңызды жогорулатсаңыз болот.`,
        usage: check,
      });
    }

    const trimmedText = text.length > 3000 ? text.slice(0, 3000) : text;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: trimmedText }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini TTS error:", errText);
      return res.status(502).json({ error: "Үн кызматы жооп берген жок" });
    }

    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);

    if (!part) {
      return res.status(502).json({ error: "Үн кайтарылган жок" });
    }

    res.json({ audioBase64: part.inlineData.data, usage: check });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Сервердик ката" });
  }
});

// --- ZIP ичиндеги текст файлдарды окуп чогултуучу жардамчы функция ---
const TEXT_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".txt", ".html", ".htm",
  ".css", ".py", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs", ".php",
  ".rb", ".yml", ".yaml", ".xml", ".sh", ".sql",
];
// ОҢДОЛДУ: "path.extname" ".env.example" сыяктуу көп чекиттүү аталыштардан
// бир гана ".example"ди кайтарат, ошондуктан аны тизмеден алып, өзүнчө текшеребиз.
const SPECIAL_TEXT_FILENAMES = [".env.example", ".env.sample", "dockerfile"];
const MAX_ZIP_ENTRIES = 40;
const MAX_CHARS_PER_FILE = 3000;
const MAX_TOTAL_CHARS = 30000;

function isTextFile(entryName) {
  const base = path.basename(entryName).toLowerCase();
  if (SPECIAL_TEXT_FILENAMES.includes(base)) return true;
  const ext = path.extname(entryName).toLowerCase();
  return TEXT_EXTENSIONS.includes(ext);
}

function extractZipText(base64Data) {
  const buffer = Buffer.from(base64Data, "base64");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  let combined = "";
  let fileCount = 0;

  for (const entry of entries) {
    if (fileCount >= MAX_ZIP_ENTRIES) break;
    if (!isTextFile(entry.entryName)) continue;
    if (combined.length >= MAX_TOTAL_CHARS) break;

    try {
      let content = entry.getData().toString("utf-8");
      if (content.length > MAX_CHARS_PER_FILE) {
        content = content.slice(0, MAX_CHARS_PER_FILE) + "\n... (кыскартылды)";
      }
      combined += `\n\n--- Файл: ${entry.entryName} ---\n${content}`;
      fileCount += 1;
    } catch {
      // Окулбаган (мис. бинардык) файлдарды өткөрүп жиберебиз
    }
  }

  const skippedNote =
    entries.length > fileCount
      ? `\n\n(Архивде дагы ${entries.length - fileCount} файл бар, бирок алар көрсөтүлгөн жок — көлөм чегинен улам.)`
      : "";

  return { text: combined + skippedNote, fileCount, totalEntries: entries.length };
}

// ОҢДОЛДУ: Gemini бардык mimeType'ди колдой бербейт. Frontend'де "accept"
// атрибуту менен чектесе да, колдонуучу түз API'ге туура эмес форматты жиберип
// коюшу мүмкүн, ошондуктан серверде да текшерүү коюлду — иштебей турган
// форматты Gemini'ге жөнөтпөй, түшүнүктүү ката кайтарабыз.
const SUPPORTED_FILE_MIME_PREFIXES = ["image/", "application/pdf", "audio/"];
const SUPPORTED_ZIP_MIMES = ["application/zip", "application/x-zip-compressed"];

function isSupportedFileMime(mimeType, fileName) {
  const isZip =
    SUPPORTED_ZIP_MIMES.includes(mimeType) ||
    (fileName && fileName.toLowerCase().endsWith(".zip"));
  if (isZip) return true;
  return SUPPORTED_FILE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

// --- Файл талдоо эндпоинти: PDF, сүрөт же ZIP кабыл алат ---
app.post("/api/analyze-file", async (req, res) => {
  try {
    const { fileBase64, mimeType, fileName } = req.body;
    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: "fileBase64 жана mimeType талаалары керек" });
    }

    if (!isSupportedFileMime(mimeType, fileName)) {
      return res.status(400).json({
        error:
          "Бул файл форматы колдоого алынбайт. Сүрөт (PNG/JPEG), PDF, аудио же ZIP файлдарын жүктөңүз.",
      });
    }

    const check = checkAndIncrement(req.userId, "chat");
    if (!check.allowed) {
      return res.status(429).json({
        error: `Күндүк чегиңизге жеттиңиз (${check.limit}). Планыңызды жогорулатсаңыз болот.`,
        usage: check,
      });
    }

    const isZip =
      SUPPORTED_ZIP_MIMES.includes(mimeType) ||
      (fileName && fileName.toLowerCase().endsWith(".zip"));

    let geminiContents;

    if (isZip) {
      let zipResult;
      try {
        zipResult = extractZipText(fileBase64);
      } catch (e) {
        console.error("ZIP окуу катасы:", e.message);
        return res.status(400).json({ error: "ZIP файлын ачуу мүмкүн болбоду" });
      }

      if (!zipResult.text.trim()) {
        return res.status(400).json({
          error:
            "Архивден окулуучу текст файлдары табылган жок (мисалы, ZIP ичинде сүрөт же PDF гана болушу мүмкүн — азырынча алар талданбайт).",
        });
      }

      geminiContents = [
        {
          role: "user",
          parts: [
            {
              text:
                `Бул "${fileName || "архив"}" деген ZIP файлдын ичиндеги файлдар (${zipResult.fileCount}/${zipResult.totalEntries}). ` +
                `Мазмунун кыргызча талда: бул эмне долбоор экенин, түзүлүшүн жана негизги бөлүктөрүн түшүндүр.\n${zipResult.text}`,
            },
          ],
        },
      ];
    } else {
      geminiContents = [
        {
          role: "user",
          parts: [
            { text: "Бул файлды кыргызча талда жана мазмунун түшүндүр." },
            { inlineData: { mimeType, data: fileBase64 } },
          ],
        },
      ];
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: geminiContents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens:8000 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", errText);
      return res.status(502).json({ error: "Файл талдоо кызматы жооп берген жок" });
    }

    const data = await response.json();
    const reply =
      data.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join("\n\n") || "Кечиресиз, файлды талдай алган жокмун.";

    res.json({ reply, usage: check });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Сервердик ката" });
  }
});

// --- Gemini аркылуу бир сүрөт жаратуучу жардамчы функция (видео сахналары үчүн) ---
async function generateImageDataUrl(prompt) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent",
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

// --- Видео сахналары: ырды сахналарга бөлүп, ар бирине сүрөт тартат ---
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

    const lines = lyrics
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const MAX_SCENES = 8;
    const selectedLines = lines.slice(0, MAX_SCENES);
    const secondsPerScene = 4;

    // ОҢДОЛДУ: мурун сахналар бирден-бирден (ырааттуу) тартылчу — 8 сахнага чейин
    // жетсе, жообу 30-60+ секундга созулмок. Азыр баары параллель жиберилет,
    // ырааттуулук (тартип) сакталат, ал эми ийгиликсиз болгон сахналар өткөрүлүп жиберилет.
    const results = await Promise.all(
      selectedLines.map(async (line) => {
        const imagePrompt = `Ыр саптарына негизделген атмосфералуу, кинематографиялык сүрөт тарт (вертикалдуу форматта, 9:16): "${line}". Реалисттик, жогорку сапаттагы визуал.`;
        try {
          const imageDataUrl = await generateImageDataUrl(imagePrompt);
          return { lyricLine: line, imageDataUrl };
        } catch (e) {
          console.error("Сахна сүрөтүн тартуу катасы:", e.message);
          return null;
        }
      })
    );
    const scenes = results.filter(Boolean);

    if (scenes.length === 0) {
      return res.status(502).json({ error: "Сахналар түзүлгөн жок, кайра аракет кылыңыз." });
    }

    res.json({ scenes, secondsPerScene, usage: check });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Сервердик ката" });
  }
});

// --- Колдонуучунун учурдагы лимиттерин алуу ---
app.get("/api/usage", (req, res) => {
  try {
    res.json(getUsage(req.userId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Сервердик ката" });
  }
});

// --- Админ: колдонуучунун планын өзгөртүү (мис. акы төлөнгөн план) ---
app.post("/api/admin/set-tier", (req, res) => {
  try {
    // ОҢДОЛДУ: "!==" аркылуу түз салыштыруу timing attack'ка бир аз алсыз.
    // crypto.timingSafeEqual() узундугу дал келгенде гана коопсуз иштейт,
    // ошондуктан адегенде узундугун текшеребиз.
    const adminKey = req.headers["x-admin-key"] || "";
    const expectedKey = process.env.ADMIN_KEY || "";
    const providedBuf = Buffer.from(String(adminKey));
    const expectedBuf = Buffer.from(expectedKey);
    const isValidKey =
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf);
    if (!isValidKey) {
      return res.status(403).json({ error: "Уруксат жок" });
    }
    const { userId, tier } = req.body;
    if (!userId || !tier || !PLANS[tier]) {
      return res.status(400).json({ error: "userId жана туура tier керек" });
    }
    setTier(userId, tier);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Сервердик ката" });
  }
});

// --- SPA fallback: белгисиз GET сурамдарды index.html'ге багыттоо ---
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("index.html табылган жок");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Тундук сервери ${PORT}-портто иштеп жатат`);
});
  
