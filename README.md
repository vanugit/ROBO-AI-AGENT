# ROBO — AI Learning Companion

A responsive ROBO chat workspace with local chat history, chat search, student profiles, explanation-style preferences, light/dark themes, and an immersive-exploration gallery inside the **Students** section. The gallery has exactly 20 curated topics and these six filters, in order: **All**, **How Things Work**, **Space**, **Human Body**, **Nature**, and **History**. The Freshwater Swamp Ecosystem is featured; each topic card opens its own illustrated scene with four guided learning stops and interactive hotspots. Chat sends non-refused general questions to Gemini when configured, uses web search and citations when available, refuses sensitive-content requests, supports programming help, and accepts up to 15 files for analysis and summaries.

The **Learner** section offers the Zia and Kian tutors, spoken answers, text input, and a readable transcript drawer. It uses the browser's speech synthesis voices, selecting a voice with a matching gender label when available and falling back to a distinct pitch if the browser does not identify voice gender. Voice playback requires browser speech synthesis support. Tutor file uploads use the existing server-side file processing and safety checks, with a limit of 15 files (1 MB each and 5 MB combined).

The supplied `robo-icon.ico` is used for the app icon, splash screen, and ROBO identity marks. Light and dark themes update the interface palette and text contrast across the workspace, forms, and dialogs.

## Run locally

ROBO searches Google before answering general questions when Gemini is configured, using Gemini's Google Search grounding and source citations. Google Programmable Search can be configured as an alternative search provider; without either Google Search configuration or Gemini, ROBO uses Wikipedia as its public fallback. Current-news requests use Google News. When Gemini is configured, general questions are still sent to it if search yields no usable results; answers without verifiable citations are marked as unverified. If web search fails, Gemini may answer from its existing knowledge while being instructed not to claim it searched. When Gemini is unavailable, ROBO returns available source excerpts or a clear error if no results are available; excerpts remain in their original language and carry a notice when translation is unavailable. Common Hello World programs are generated locally after searching; other code requests return relevant search results if Gemini is unavailable. Basic arithmetic and greetings are handled locally. ROBO cannot guarantee a correct answer to every possible question; model availability, knowledge, and safety limits apply. Gemini chat and image generation use the server-side `GEMINI_API_KEY`; keep the key server-side—never add it to frontend code. The key must be configured on the same Railway service/environment that runs `server.py`; restart or redeploy that service after changing its variables. Start the app from the repository directory:

```powershell
python -m pip install -r requirements.txt
python server.py
```

Then visit `http://127.0.0.1:8765/`. Set `GEMINI_API_KEY` on the server for Google-grounded answers and code generation in the language requested by the user. The default Gemini text model is the faster `gemini-3.5-flash-lite`; set `GEMINI_TEXT_MODEL` to choose another supported text model. Gemini Google Search grounding has Google API usage limits and may incur charges; check Google's current quota and pricing. To use Google Programmable Search instead, create a [Programmable Search Engine](https://programmablesearchengine.google.com/) configured to search the web, enable the [Custom Search JSON API](https://developers.google.com/custom-search/v1/overview), and set `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID` on the server. Without Gemini or those settings, ROBO clearly uses Wikipedia as its public-search fallback. These credentials stay server-side; never add them to frontend code.

General questions use Google Programmable Search when configured; otherwise they use Gemini Google Search grounding when Gemini is configured, with public Wikipedia search as the fallback. Current-news requests use Google News. ROBO ranks available matches against the requested topic and includes source links when they are available. Each new question is searched independently; earlier chat turns are included in a search only for clear follow-up questions. Wikipedia article extracts are fetched in one batch rather than making a separate request per result. This requires internet access. If search has no usable results, configured Gemini still generates an answer from its existing knowledge and is instructed to state uncertainty; if Gemini is unavailable too, ROBO reports that it cannot generate a complete answer. Gemini can make mistakes, so verify important factual, mathematical, and programming output. Without Gemini, built-in Hello World programs and a basic Python voting-age example still work after search; other custom coding requests return relevant search results when possible. Sensitive-content and explicit sexual-content requests receive the refusal `Sorry, I can't generate this type of content.` Benign informational questions such as health-risk questions are not refused just because they mention a sensitive topic. The content filter is keyword-based and is not a substitute for supervision.

The chat plus button accepts up to 15 files, limited to 1 MB per file and 5 MB total. It accepts any filename or extension, including dotfiles such as `.env` and `.gitignore`; it extracts text from UTF-8/UTF-16 source and configuration files, PDF, DOCX, XLSX, PPTX, OpenDocument, RTF, and EML files. Common images (including ICO) are normalized for Gemini, and known audio/video formats are passed through. Other binary formats are sent to Gemini with their detected MIME type when available; whether Gemini can interpret a particular proprietary, encrypted, damaged, or uncommon format depends on the provider/model. Extracted text is capped at 1 MB total, and normalized file data at 5 MB. Files are never executed. Without Gemini, ROBO can make extractive summaries of readable text; binary and multimodal analysis requires `GEMINI_API_KEY`. The interface, generated answers, and tutor speech use English. Without Gemini, search results and summaries are returned in their source language with a notice instead of a configuration error. Fixed safety responses remain in their specified wording. Chat history, student profiles, and preferences are stored in the browser.

### Gemini API key

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and add it as the server environment variable `GEMINI_API_KEY` (Railway: the Variables tab of the same service that runs `server.py`). This is separate from the Google OAuth client ID and secret used for sign-in. After changing a variable, restart or redeploy the service so the running process can read it. `/api/health` reports whether a key is available without exposing its value. For local PowerShell testing:

```powershell
$env:GEMINI_API_KEY = "your-key-from-ai-studio"
python server.py
```

ROBO uses the key for general chat and image generation. The general chat uses Google's Gemini `generateContent` API. Requests from every user of a deployment that shares this key use that Google project's quota and may incur charges if its applicable free quota or access is exceeded. Check Google's [current API pricing and free-tier eligibility](https://ai.google.dev/gemini-api/docs/pricing) before configuring a key.

### Gemini image generation

ROBO calls Google's `gemini-nano-banana-2.1` image-generation API from the Python server, so the key is not exposed to browsers. Requests from every user of a deployment that shares this key use that Google project’s quota and may incur charges if its applicable free quota or access is exceeded. The free Gemini consumer app does not mean API image generation is unlimited or always free; check Google's [current API pricing and free-tier eligibility](https://ai.google.dev/gemini-api/docs/pricing) before configuring a key. The server limits prompts to 2,000 characters, applies a basic violence-related keyword block, and caps image requests at five per IP per minute. Google’s own API safety filters also apply. Generated images are kept in the user's browser chat history and can be downloaded.

Without a configured Gemini key, prompts fall back to local, template-guided SVG illustrations. These are free and original, but cannot faithfully depict arbitrary descriptions; they are not a generative image model. Local images can be downloaded as SVG files. The violence keyword block is not a comprehensive safety classifier.

The **ROBO Generations** section in the left navigation links to [Craiyon](https://www.craiyon.com/en) as an external service. Craiyon could not be verified to provide a supported public API, so the launch button navigates to its website; ROBO does not send prompts to Craiyon or import its generated media.

The Scheduled clock has ten locally synthesized alarm sounds. Select a sound under **Settings → Alarm sound** to save it and hear a five-second preview; alarms and timer completion use the selected sound. The timer accepts hours, minutes, and seconds up to a five-hour maximum.

## Real sign-in setup

Google and Microsoft sign-in use OAuth authorization-code flow with PKCE. The user enters their password only on the provider's own sign-in page. ROBO exchanges the authorization code on its server, verifies the profile with the provider, and keeps a signed, HTTP-only session cookie; provider passwords and tokens are never stored in the browser or ROBO.

Real provider sign-in is disabled until credentials are configured:

- **Google:** Create a Web application OAuth client in Google Cloud. Add the app origin to Authorized JavaScript origins and the exact root URL (for example `http://127.0.0.1:8765/`) to Authorized redirect URIs.
- **Microsoft:** Register a web app in Microsoft Entra and add the exact root URL as a Web redirect URI. Enable the account types you want to support.

Set these server environment variables (Railway: Service → Variables):

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
ROBO_PUBLIC_URL=https://your-deployed-domain/
ROBO_SESSION_SECRET=<a long random secret>
```

Only configure the providers you intend to offer. Use the same exact root redirect URL in the provider console and `ROBO_PUBLIC_URL`; for Railway, use the currently provisioned public domain, not an old generated `*.up.railway.app` domain. If `ROBO_PUBLIC_URL` points to a different generated Railway domain, ROBO uses the active request domain instead. Add that active origin and exact root redirect URI to the provider console, then redeploy. For local development, the default is `http://127.0.0.1:8765/`. Never put client secrets in frontend files. Without provider credentials, the buttons remain disabled rather than pretending to sign a user in. Continuing as a guest remains available.

Railway can use the included `Procfile` (`python server.py`). The server reads Railway's `PORT` environment variable and binds to `0.0.0.0`; install the dependencies listed in `requirements.txt` for local runs, and ensure the Railway build installs that file.
