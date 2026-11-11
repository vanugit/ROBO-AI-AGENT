import json
import ast
import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", os.environ.get("ROBO_PORT", "8765")))
MAX_BODY_BYTES = 128 * 1024
MAX_MESSAGES = 40
MAX_MESSAGE_LENGTH = 8000
MAX_IMAGE_PROMPT_LENGTH = 2000
MAX_GENERATED_IMAGE_BYTES = 12 * 1024 * 1024
MAX_MATH_NODES = 64
IMAGE_REQUEST_LIMIT = 5
IMAGE_REQUEST_WINDOW = 60
USER_AGENT = "ROBO-Learning-Assistant/1.0 (public-source search demo)"
SESSION_COOKIE = "robo_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7
SESSION_SECRET = os.environ.get("ROBO_SESSION_SECRET", "").encode() or secrets.token_bytes(32)
VIOLENT_IMAGE_PROMPT = re.compile(
    r"\b(?:violent|violence|kill|murder|blood|gore|attack|assault|bombing|explosion|"
    r"stabbing|shooting|warfare|battlefield|torture|beating|fight|wound|wounded|corpse|massacre)\b",
    re.IGNORECASE,
)
IMAGE_REQUESTS = {}
IMAGE_REQUESTS_LOCK = threading.Lock()
OAUTH_PROVIDERS = {
    "google": {
        "client_id_env": "GOOGLE_CLIENT_ID",
        "client_secret_env": "GOOGLE_CLIENT_SECRET",
        "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
    },
    "microsoft": {
        "client_id_env": "MICROSOFT_CLIENT_ID",
        "client_secret_env": "MICROSOFT_CLIENT_SECRET",
        "authorization_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo_endpoint": "https://graph.microsoft.com/oidc/userinfo",
        "scope": "openid profile email",
    },
}


class MarkupText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())


def plain_text(markup):
    parser = MarkupText()
    parser.feed(markup or "")
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def fetch_json(url):
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_xml(url):
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml"})
    with urlopen(request, timeout=12) as response:
        return ET.fromstring(response.read())


def generate_gemini_image(prompt):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Gemini image generation is not configured.")
    body = json.dumps({
        "model": "gemini-nano-banana-2.1",
        "input": [{"type": "text", "text": prompt}],
    }).encode("utf-8")
    request = Request(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-goog-api-key": api_key,
            "Api-Revision": "2026-05-20",
        },
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8"))
    image = result.get("output_image") if isinstance(result, dict) else None
    if not isinstance(image, dict):
        raise RuntimeError("Gemini did not return an image.")
    data = image.get("data")
    mime_type = image.get("mime_type", "image/png")
    if not isinstance(data, str) or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", data):
        raise RuntimeError("Gemini returned invalid image data.")
    if mime_type not in ("image/png", "image/jpeg", "image/webp"):
        raise RuntimeError("Gemini returned an unsupported image format.")
    image_bytes = base64.b64decode(data, validate=True)
    if not image_bytes or len(image_bytes) > MAX_GENERATED_IMAGE_BYTES:
        raise RuntimeError("Gemini returned an empty or oversized image.")
    return {"data": data, "mimeType": mime_type}


def allow_image_request(client_address):
    now = time.monotonic()
    with IMAGE_REQUESTS_LOCK:
        recent = [timestamp for timestamp in IMAGE_REQUESTS.get(client_address, []) if now - timestamp < IMAGE_REQUEST_WINDOW]
        if len(recent) >= IMAGE_REQUEST_LIMIT:
            IMAGE_REQUESTS[client_address] = recent
            return False
        recent.append(now)
        IMAGE_REQUESTS[client_address] = recent
        for address, timestamps in list(IMAGE_REQUESTS.items()):
            if not any(now - timestamp < IMAGE_REQUEST_WINDOW for timestamp in timestamps):
                IMAGE_REQUESTS.pop(address, None)
    return True


def public_origin(handler):
    configured_url = os.environ.get("ROBO_PUBLIC_URL", "").strip()
    if configured_url:
        from urllib.parse import urlsplit
        parsed = urlsplit(configured_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("ROBO_PUBLIC_URL must be an absolute http(s) URL.")
        return f"{parsed.scheme}://{parsed.netloc}"
    forwarded_proto = handler.headers.get("X-Forwarded-Proto", "").split(",")[0].strip()
    scheme = forwarded_proto if forwarded_proto in ("http", "https") else "http"
    host = handler.headers.get("Host", "localhost")
    return f"{scheme}://{host}"


def oauth_provider_config(provider):
    if not isinstance(provider, str):
        return None
    config = OAUTH_PROVIDERS.get(provider)
    if not config:
        return None
    client_id = os.environ.get(config["client_id_env"], "").strip()
    client_secret = os.environ.get(config["client_secret_env"], "").strip()
    if not client_id or not client_secret:
        return None
    return {
        **config,
        "provider": "Google" if provider == "google" else "Microsoft",
        "client_id": client_id,
        "client_secret": client_secret,
    }


def encode_session(profile):
    payload = {**profile, "expiresAt": int(time.time()) + SESSION_MAX_AGE}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(SESSION_SECRET, encoded.encode(), hashlib.sha256).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{encoded}.{encoded_signature}"


def decode_session(cookie_value):
    try:
        encoded, signature = cookie_value.split(".", 1)
        expected = base64.urlsafe_b64encode(
            hmac.new(SESSION_SECRET, encoded.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if not isinstance(payload, dict) or payload.get("expiresAt", 0) <= int(time.time()):
            return None
        return payload
    except (ValueError, json.JSONDecodeError, TypeError):
        return None


def fetch_oauth_token(provider_config, code, verifier, redirect_uri):
    form = urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": provider_config["client_id"],
        "client_secret": provider_config["client_secret"],
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
    }).encode()
    request = Request(provider_config["token_endpoint"], data=form, headers={
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    })
    with urlopen(request, timeout=15) as response:
        token_data = json.loads(response.read().decode("utf-8"))
    if not isinstance(token_data, dict):
        raise ValueError("The identity provider returned an invalid token response.")
    access_token = token_data.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise ValueError("The identity provider did not return an access token.")
    profile_request = Request(provider_config["userinfo_endpoint"], headers={
        "User-Agent": USER_AGENT,
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    })
    with urlopen(profile_request, timeout=15) as response:
        identity = json.loads(response.read().decode("utf-8"))
    if not isinstance(identity, dict):
        raise ValueError("The identity provider returned an invalid profile.")
    email = identity.get("email")
    if not isinstance(email, str) or not email.strip():
        raise ValueError("The identity provider did not return an email address.")
    name = identity.get("name") or identity.get("given_name") or email.split("@", 1)[0]
    return {"signedIn": True, "provider": provider_config["provider"], "displayName": str(name), "email": email}


def search_wikipedia(query, limit=3):
    endpoint = "https://en.wikipedia.org/w/api.php?" + urlencode({
        "action": "query",
        "list": "search",
        "srsearch": query,
        "format": "json",
        "srlimit": limit,
        "utf8": 1,
    })
    result = fetch_json(endpoint)
    pages = result.get("query", {}).get("search", [])
    matches = []
    for page in pages[:limit]:
        title = page.get("title")
        page_id = page.get("pageid")
        if not title or not isinstance(page_id, int):
            continue
        summary_url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + quote(title.replace(" ", "_"))
        try:
            summary = fetch_json(summary_url)
            extract = re.sub(r"\s+", " ", summary.get("extract", "")).strip()
        except (HTTPError, URLError, TimeoutError, ValueError, UnicodeDecodeError):
            extract = plain_text(page.get("snippet", ""))
        if not extract:
            extract = plain_text(page.get("snippet", ""))
        if not extract:
            continue
        matches.append({
            "title": title,
            "text": extract[:1200],
            "url": f"https://en.wikipedia.org/?curid={page_id}",
            "publisher": "Wikipedia",
        })
    return matches


def search_news(query, limit=5):
    url = "https://news.google.com/rss/search?" + urlencode({
        "q": query,
        "hl": "en-US",
        "gl": "US",
        "ceid": "US:en",
    })
    root = fetch_xml(url)
    items = []
    for item in root.findall("./channel/item")[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        description = plain_text(item.findtext("description") or "")
        source_element = item.find("source")
        publisher = (source_element.text or "").strip() if source_element is not None else ""
        pub_date = (item.findtext("pubDate") or "").strip()
        if title and link.startswith("https://"):
            items.append({
                "title": title,
                "text": description[:500],
                "url": link,
                "publisher": publisher or "Google News",
                "publishedAt": pub_date,
            })
    return items


def search_sources(query):
    query = re.sub(r"\s+", " ", query).strip()[:300]
    with ThreadPoolExecutor(max_workers=2) as executor:
        wiki_future = executor.submit(search_wikipedia, query)
        news_future = executor.submit(search_news, query)
        results = {"encyclopedia": [], "news": [], "sourceErrors": []}
        for name, future, key in (
            ("Wikipedia", wiki_future, "encyclopedia"),
            ("Google News", news_future, "news"),
        ):
            try:
                results[key] = future.result()
            except (HTTPError, URLError, TimeoutError, ValueError, UnicodeDecodeError, ET.ParseError) as error:
                print(f"{name} search failed: {error}", flush=True)
                results["sourceErrors"].append(name)

    if not results["encyclopedia"] and not results["news"]:
        raise RuntimeError("The public search sources are temporarily unavailable. Please try again.")

    sections = []
    if results["encyclopedia"]:
        sections.append("Here are encyclopedia matches for your question:")
        for item in results["encyclopedia"]:
            sections.append(f"{item['title']}\n{item['text']}")
    if results["news"]:
        sections.append("Recent news matches:")
        for item in results["news"]:
            date = f" ({item['publishedAt']})" if item.get("publishedAt") else ""
            publisher = f" — {item['publisher']}" if item.get("publisher") else ""
            summary = f"\n{item['text']}" if item["text"] else ""
            sections.append(f"{item['title']}{publisher}{date}{summary}")

    warning = ""
    if results["sourceErrors"]:
        warning = "\n\nSome sources could not be reached: " + ", ".join(results["sourceErrors"]) + "."
    if not results["encyclopedia"] and results["news"]:
        opening = "I couldn't find an encyclopedia match, but here are current news results."
    elif not results["news"] and results["encyclopedia"]:
        opening = "Current news search is temporarily unavailable; here are encyclopedia results."
    else:
        opening = ""
    text = "\n\n".join(sections)
    if opening:
        text = opening + "\n\n" + text
    text += warning
    sources = []
    for item in results["encyclopedia"] + results["news"]:
        sources.append({key: item[key] for key in ("title", "url", "publisher", "publishedAt") if item.get(key)})
    return {"text": text, "sources": sources, "searchedAt": datetime.now(timezone.utc).isoformat()}


def calculate_arithmetic(query):
    match = re.fullmatch(
        r"\s*(?:(?:what is|calculate|compute|evaluate|solve)\s+)?"
        r"([0-9\s()+\-*/.]+)\s*\??\s*",
        query,
        re.IGNORECASE,
    )
    if not match:
        return None
    expression = match.group(1).strip()
    if not re.search(r"\d\s*[+\-*/]", expression) and not re.search(r"[+\-*/]\s*\d", expression):
        return None

    operators = {
        ast.Add: lambda left, right: left + right,
        ast.Sub: lambda left, right: left - right,
        ast.Mult: lambda left, right: left * right,
        ast.Div: lambda left, right: left / right,
        ast.FloorDiv: lambda left, right: left // right,
        ast.Mod: lambda left, right: left % right,
        ast.USub: lambda value: -value,
        ast.UAdd: lambda value: value,
    }

    def evaluate(node, depth=0):
        if depth > MAX_MATH_NODES:
            raise ValueError("Expression is too complex.")
        if isinstance(node, ast.Expression):
            return evaluate(node.body, depth + 1)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in operators:
            left = evaluate(node.left, depth + 1)
            right = evaluate(node.right, depth + 1)
            return operators[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in operators:
            return operators[type(node.op)](evaluate(node.operand, depth + 1))
        raise ValueError("Unsupported arithmetic expression.")

    try:
        tree = ast.parse(expression, mode="eval")
        if sum(1 for _ in ast.walk(tree)) > MAX_MATH_NODES:
            return None
        result = evaluate(tree)
        if not isinstance(result, (int, float)) or abs(result) > 1e100:
            return None
    except (SyntaxError, ValueError, ZeroDivisionError, OverflowError):
        return None
    formatted = format(result, ".12g") if isinstance(result, float) else str(result)
    return {"text": formatted, "sources": []}


def is_current_news_request(query):
    query = query.lower()
    if re.search(r"\b(?:latest|today|current|breaking|recent|updates?|happening now)\b", query) and re.search(
        r"\b(?:news|headlines|current events)\b", query
    ):
        return True
    return bool(re.search(r"\b(?:give me|show me|tell me)\s+(?:the\s+)?(?:news|headlines)\b", query))


def generate_gemini_answer(messages, response_style="balanced", news_items=None):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "General AI answers are not configured on this server. Set GEMINI_API_KEY in the server environment and restart ROBO."
        )
    style_guidance = {
        "concise": "Keep the answer concise and direct.",
        "balanced": "Give a clear, balanced explanation with useful detail.",
        "detailed": "Give a thorough explanation, organized for easy reading.",
    }.get(response_style, "Give a clear, balanced explanation with useful detail.")
    system_instruction = (
        "You are ROBO, a helpful and accurate learning companion. Answer the user's actual question directly. "
        "For calculations, show the result and explain briefly when useful. For programming requests, provide "
        "working code in the requested language, fenced code blocks, and brief run/use instructions. State "
        "important assumptions, and do not invent facts or claim to have performed actions you did not perform. "
        + style_guidance
    )
    contents = []
    for message in messages:
        role = "model" if message["role"] == "assistant" else "user"
        if contents and contents[-1]["role"] == role:
            contents[-1]["parts"][0]["text"] += "\n\n" + message["text"]
        else:
            contents.append({"role": role, "parts": [{"text": message["text"]}]})
    if news_items is not None:
        news_context = "\n\nCurrent news search results (use only these for current claims; cite their titles):\n"
        news_context += "\n".join(
            f"- {item['title']} ({item.get('publisher', 'Source')}, {item.get('publishedAt', 'date unavailable')}): "
            f"{item.get('text', '')} [{item['url']}]"
            for item in news_items
        ) or "No current news results were found."
        contents[-1]["parts"][0]["text"] += news_context
        system_instruction += " Summarize the supplied current-news results without adding unverified current claims."
    model = os.environ.get("GEMINI_TEXT_MODEL", "gemini-2.5-flash").strip()
    request = Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}:generateContent",
        data=json.dumps({
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "contents": contents,
        }).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 429:
            raise RuntimeError("ROBO's AI service is at its current quota limit. Try again later.") from error
        if error.code in (400, 401, 403, 404):
            raise RuntimeError("ROBO's AI service rejected its server configuration. Check the Gemini key and text model settings.") from error
        raise RuntimeError("ROBO's AI service is temporarily unavailable. Please try again.") from error
    except (URLError, TimeoutError, ValueError, UnicodeDecodeError) as error:
        raise RuntimeError("ROBO could not reach its AI service. Please try again.") from error
    candidates = result.get("candidates", []) if isinstance(result, dict) else []
    if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
        raise RuntimeError("ROBO's AI service returned no answer. Please rephrase your question and try again.")
    content = candidates[0].get("content", {})
    parts = content.get("parts", []) if isinstance(content, dict) else []
    if not isinstance(parts, list):
        parts = []
    text = "\n".join(part.get("text", "") for part in parts if isinstance(part.get("text"), str)).strip()
    if not text:
        raise RuntimeError("ROBO's AI service returned no answer. Please rephrase your question and try again.")
    return text


class RoboHandler(SimpleHTTPRequestHandler):
    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "mode": "gemini-chat-public-news-search",
                "generalAnswersConfigured": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
            })
            return
        if self.path == "/api/image/config":
            self.send_json(200, {"configured": bool(os.environ.get("GEMINI_API_KEY", "").strip())})
            return
        if self.path == "/api/auth/config":
            origin = public_origin(self)
            self.send_json(200, {
                "providers": {
                    name: {
                        "configured": bool(oauth_provider_config(name)),
                        "clientId": os.environ.get(config["client_id_env"], "").strip() if oauth_provider_config(name) else "",
                        "authorizationEndpoint": config["authorization_endpoint"],
                        "scope": config["scope"],
                    }
                    for name, config in OAUTH_PROVIDERS.items()
                },
                "redirectUri": origin + "/",
            })
            return
        if self.path == "/api/auth/session":
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            morsel = cookies.get(SESSION_COOKIE)
            profile = decode_session(morsel.value) if morsel else None
            if not profile:
                self.send_json(200, {"signedIn": False})
                return
            profile.pop("expiresAt", None)
            self.send_json(200, profile)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/auth/logout":
            origin = public_origin(self)
            if self.headers.get("Origin") != origin:
                self.send_json(403, {"error": "Sign-out request origin did not match this app."})
                return
            cookie = f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
            if origin.startswith("https://"):
                cookie += "; Secure"
            self.send_json(200, {"signedIn": False}, {"Set-Cookie": cookie})
            return
        if self.path == "/api/auth/exchange":
            self.handle_oauth_exchange()
            return
        if self.path == "/api/image":
            self.handle_image_generation()
            return
        if self.path != "/api/chat":
            self.send_json(404, {"error": "Not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                self.send_json(413, {"error": "Message is empty or too large."})
                return
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                self.send_json(400, {"error": "The request body must be a JSON object."})
                return
            messages = payload.get("messages")
            if not isinstance(messages, list) or not messages:
                self.send_json(400, {"error": "Send at least one message to ROBO."})
                return
            validated = []
            total_text_length = 0
            for message in messages[-MAX_MESSAGES:]:
                if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
                    self.send_json(400, {"error": "The conversation has an invalid message."})
                    return
                text = message.get("text")
                if not isinstance(text, str) or not text.strip() or len(text) > MAX_MESSAGE_LENGTH:
                    self.send_json(400, {"error": "Messages must contain text and be under 8,000 characters."})
                    return
                total_text_length += len(text)
                if total_text_length > 60_000:
                    self.send_json(413, {"error": "This conversation is too long to search. Start a new chat and try again."})
                    return
                validated.append({"role": message["role"], "text": text.strip()})
            query = next((message["text"] for message in reversed(validated) if message["role"] == "user"), None)
            if not query:
                self.send_json(400, {"error": "Add a question before sending."})
                return
            arithmetic = calculate_arithmetic(query)
            if arithmetic is not None:
                self.send_json(200, arithmetic)
                return

            news_request = is_current_news_request(query)
            api_configured = bool(os.environ.get("GEMINI_API_KEY", "").strip())
            if news_request:
                news = search_news(query[:300])
                if api_configured:
                    answer = generate_gemini_answer(validated, payload.get("responseStyle"), news)
                    sources = [
                        {key: item[key] for key in ("title", "url", "publisher", "publishedAt") if item.get(key)}
                        for item in news
                    ]
                    self.send_json(200, {"text": answer, "sources": sources})
                else:
                    lines = ["Here are the latest news results I found:"]
                    lines.extend(
                        f"- {item['title']} ({item.get('publisher', 'Source')})"
                        + (f": {item['text']}" if item.get("text") else "")
                        for item in news
                    )
                    self.send_json(200, {
                        "text": "\n\n".join(lines) if news else "I couldn't find current news results for that search.",
                        "sources": [
                            {key: item[key] for key in ("title", "url", "publisher", "publishedAt") if item.get(key)}
                            for item in news
                        ],
                    })
                return

            if api_configured:
                self.send_json(200, {"text": generate_gemini_answer(validated, payload.get("responseStyle")), "sources": []})
                return

            raise RuntimeError(
                "ROBO's general AI is not configured on this server. Set GEMINI_API_KEY on the server to answer questions beyond basic arithmetic and news search."
            )
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "The request body must be valid JSON."})
        except RuntimeError as error:
            self.send_json(502, {"error": str(error)})
        except (HTTPError, URLError, TimeoutError, ET.ParseError) as error:
            print(f"Chat source request failed: {error}", flush=True)
            self.send_json(502, {"error": "ROBO could not reach the requested information source. Please try again."})

    def handle_image_generation(self):
        content_length = self.headers.get("Content-Length", "0")
        try:
            content_length = int(content_length)
        except ValueError:
            self.send_json(400, {"error": "The image request size is invalid."})
            return
        if content_length <= 0 or content_length > 16_384:
            self.send_json(413, {"error": "The image prompt is empty or too large."})
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "The image request must be valid JSON."})
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "The image request must be a JSON object."})
            return
        prompt = payload.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_IMAGE_PROMPT_LENGTH:
            self.send_json(400, {"error": "Enter an image description under 2,000 characters."})
            return
        prompt = prompt.strip()
        if VIOLENT_IMAGE_PROMPT.search(prompt):
            self.send_json(400, {"error": "I can’t create illustrations depicting violence. Try a peaceful, non-violent description instead."})
            return
        if not os.environ.get("GEMINI_API_KEY", "").strip():
            self.send_json(503, {"configured": False, "error": "Gemini image generation is not configured on this server."})
            return
        if not allow_image_request(self.client_address[0]):
            self.send_json(429, {"error": "Too many image requests. Please wait a minute and try again."})
            return
        try:
            image = generate_gemini_image(prompt)
            self.send_json(200, image)
        except HTTPError as error:
            if error.code == 429:
                self.send_json(429, {"error": "Gemini's image-generation quota is currently unavailable. Check your Google AI Studio limits and try again later."})
            elif error.code in (401, 403):
                self.send_json(502, {"error": "Gemini rejected the server API key or image model access. Check the server's Gemini API configuration."})
            else:
                self.send_json(502, {"error": "Gemini image generation failed. Please try again later."})
        except (URLError, TimeoutError):
            self.send_json(502, {"error": "ROBO could not reach Gemini image generation. Please try again."})
        except (RuntimeError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(502, {"error": "Gemini returned an invalid image response. Please try again."})

    def handle_oauth_exchange(self):
        try:
            origin = public_origin(self)
            if self.headers.get("Origin") != origin:
                self.send_json(403, {"error": "Sign-in request origin did not match this app."})
                return
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 16_384:
                self.send_json(400, {"error": "The sign-in response is missing or too large."})
                return
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                self.send_json(400, {"error": "The sign-in response is invalid."})
                return
            provider = payload.get("provider")
            code = payload.get("code")
            verifier = payload.get("codeVerifier")
            redirect_uri = payload.get("redirectUri")
            provider_config = oauth_provider_config(provider)
            if not provider_config:
                self.send_json(503, {"error": "This sign-in provider is not configured on the ROBO server."})
                return
            if not isinstance(code, str) or not code or not isinstance(verifier, str) or not re.fullmatch(r"[A-Za-z0-9._~-]{43,128}", verifier):
                self.send_json(400, {"error": "The sign-in response is invalid or expired. Please try again."})
                return
            if redirect_uri != origin + "/":
                self.send_json(400, {"error": "The sign-in redirect URI does not match this app."})
                return
            profile = fetch_oauth_token(provider_config, code, verifier, redirect_uri)
            cookie = f"{SESSION_COOKIE}={encode_session(profile)}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_MAX_AGE}"
            if origin.startswith("https://"):
                cookie += "; Secure"
            self.send_json(200, profile, {"Set-Cookie": cookie})
        except (ValueError, UnicodeDecodeError, HTTPError, URLError, TimeoutError) as error:
            print(f"OAuth sign-in failed: {error}", flush=True)
            self.send_json(502, {"error": "The identity provider could not complete sign-in. Check OAuth setup and try again."})


if __name__ == "__main__":
    print(f"ROBO is running at http://{HOST}:{PORT}/ (Gemini general chat; news search)", flush=True)
    ThreadingHTTPServer((HOST, PORT), RoboHandler).serve_forever()
