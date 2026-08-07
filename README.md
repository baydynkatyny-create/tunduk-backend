# Тундук — Backend Сервер

Бул сервер Claude жана Gemini API ачкычтарын жашырат, бардык колдонуучулар үчүн бир жерден башкарат.

## Эмне үчүн керек

Мурунку прототип браузердин ичинде түз API'ге кайрылчу — бул ачкычтарды ачык калтырат. Бул сервер ортодо туруп, ачкычтарды жашырат жана чыгымды чектейт (rate limiting).

## Жергиликтүү жерде иштетүү (тестирлөө үчүн)

1. Node.js орнотулушу керек (18-версиядан жогору): https://nodejs.org
2. Терминалда:
   ```
   cd tunduk-backend
   npm install
   cp .env.example .env
   ```
3. `.env` файлын ачып, чыныгы ачкычтарды коюңуз:
   - `ANTHROPIC_API_KEY` — https://console.anthropic.com
   - `GEMINI_API_KEY` — https://aistudio.google.com
4. Серверди иштетиңиз:
   ```
   npm start
   ```
5. Сервер `http://localhost:3000` дарегинде иштейт.

## Интернетке чыгаруу (бекер варианттар)

Эң жеңил жол — **Railway** же **Render**:

### Railway.app аркылуу
1. GitHub'га бул папканы жүктөңүз (репозиторий түзүп)
2. railway.app сайтына кирип, "New Project" → "Deploy from GitHub"
3. Репозиторийди тандаңыз
4. "Variables" бөлүмүнө `.env` ичиндеги ачкычтарды кол менен киргизиңиз (ANTHROPIC_API_KEY, GEMINI_API_KEY, ALLOWED_ORIGIN)
5. Railway автоматтык түрдө URL берет (мис: `tunduk-backend.up.railway.app`)

### Render.com аркылуу
1. GitHub репозиторийин туташтырыңыз
2. "New Web Service" тандаңыз
3. Build Command: `npm install`, Start Command: `npm start`
4. "Environment" бөлүмүнөн ачкычтарды кошуңуз

Экөө тең акысыз деңгээлде (free tier) баштоо үчүн жетиштүү.

## Кийинки кадам

Сервер даяр болгондон кийин, фронтенд (браузердеги чат баракчасы) энди Anthropic/Gemini'ге түз эмес, ушул серверге кайрылат:
- `POST /api/chat` — `{ messages: [...] }` жиберип, `{ reply: "..." }` алат
- `POST /api/image` — `{ prompt: "..." }` жиберип, `{ dataUrl: "..." }` алат

Бул фронтендди мен эми жаңыртам.
