import base64
import io
import json
import threading
import unittest
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class PublicSourceTests(unittest.TestCase):
    def test_daily_regional_news_query_is_detected(self):
        self.assertTrue(server.is_current_news_request(
            "What are the daily news updates in New Delhi, India?"
        ))
        self.assertTrue(server.is_current_news_request("Daily news in New Delhi"))

    def test_daily_news_search_query_keeps_location_and_removes_question_filler(self):
        self.assertEqual(
            server.news_search_query("What are the daily news updates in New Delhi, India?"),
            "New Delhi India news today",
        )

    def test_indian_news_query_uses_indian_google_news_edition(self):
        with patch("server.fetch_xml", return_value=ET.fromstring("<rss/>")) as fetch:
            server.search_news("New Delhi India news today")

        url = fetch.call_args.args[0]
        self.assertIn("hl=en-IN", url)
        self.assertIn("gl=IN", url)
        self.assertIn("ceid=IN%3Aen", url)

    def test_wikipedia_search_returns_article_summaries_and_links(self):
        search_response = {
            "query": {"search": [
                {"title": "Water cycle", "pageid": 123, "snippet": "The water cycle."},
            ]}
        }
        summary_response = {"extract": "Water moves around Earth in a continuous cycle."}
        with patch("server.fetch_json", side_effect=[search_response, summary_response]) as fetch:
            results = server.search_wikipedia("water cycle")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["text"], summary_response["extract"])
        self.assertEqual(results[0]["url"], "https://en.wikipedia.org/?curid=123")
        fetch.assert_called()

    def test_news_search_reads_feed_entries_and_publishers(self):
        feed = ET.fromstring("""<rss><channel><item>
            <title>World update</title><link>https://news.google.com/articles/example</link>
            <description><![CDATA[<p>A current event.</p>]]></description>
            <source>Example News</source><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate>
        </item></channel></rss>""")
        with patch("server.fetch_xml", return_value=feed):
            results = server.search_news("world news")

        self.assertEqual(results[0]["title"], "World update")
        self.assertEqual(results[0]["publisher"], "Example News")
        self.assertEqual(results[0]["text"], "A current event.")
        self.assertEqual(results[0]["url"], "https://news.google.com/articles/example")

    def test_search_combines_free_sources_and_includes_citations(self):
        articles = [{"title": "Topic", "text": "An encyclopedia summary.", "url": "https://en.wikipedia.org/?curid=1", "publisher": "Wikipedia"}]
        news = [{"title": "Latest event", "text": "A news summary.", "url": "https://news.google.com/item", "publisher": "Example", "publishedAt": "Today"}]
        with patch("server.search_wikipedia", return_value=articles), patch("server.search_news", return_value=news):
            result = server.search_sources("Tell me about this")

        self.assertIn("An encyclopedia summary.", result["text"])
        self.assertIn("Latest event", result["text"])
        self.assertEqual([source["url"] for source in result["sources"]], [articles[0]["url"], news[0]["url"]])
        self.assertIn("searchedAt", result)

    def test_search_still_works_if_one_public_source_is_unavailable(self):
        articles = [{"title": "Topic", "text": "A useful summary.", "url": "https://en.wikipedia.org/?curid=1", "publisher": "Wikipedia"}]
        with patch("server.search_wikipedia", return_value=articles), patch(
            "server.search_news", side_effect=HTTPError("https://news.google.com", 429, "Rate limited", {}, None)
        ):
            result = server.search_sources("Some topic")

        self.assertIn("news search is temporarily unavailable", result["text"])
        self.assertEqual(len(result["sources"]), 1)

    def test_search_fails_explicitly_if_both_sources_are_unavailable(self):
        with patch("server.search_wikipedia", side_effect=TimeoutError()), patch(
            "server.search_news", side_effect=TimeoutError()
        ):
            with self.assertRaisesRegex(RuntimeError, "sources are temporarily unavailable"):
                server.search_sources("Some topic")


class ServerEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.RoboHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)

    def post_chat(self, payload):
        request = Request(
            self.base_url + "/api/chat",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            return urlopen(request, timeout=3)
        except HTTPError as error:
            return error

    def post_auth(self, payload, origin=None):
        request = Request(
            self.base_url + "/api/auth/exchange",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Origin": origin or self.base_url,
            },
            method="POST",
        )
        try:
            return urlopen(request, timeout=3)
        except HTTPError as error:
            return error

    def post_image(self, payload):
        request = Request(
            self.base_url + "/api/image",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            return urlopen(request, timeout=3)
        except HTTPError as error:
            return error

    def test_health_reports_general_answer_configuration_without_exposing_key(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}):
            response = urlopen(self.base_url + "/api/health", timeout=3)
            health = json.loads(response.read())

        self.assertTrue(health["ok"])
        self.assertEqual(health["mode"], "gemini-chat-public-news-search")
        self.assertFalse(health["generalAnswersConfigured"])

    def test_image_config_does_not_expose_api_key(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": "server-only-secret"}):
            response = urlopen(self.base_url + "/api/image/config", timeout=3)
            body = response.read().decode()

        self.assertEqual(json.loads(body), {"configured": True})
        self.assertNotIn("server-only-secret", body)

    def test_image_generation_uses_gemini_and_returns_image_data(self):
        generated = {"data": base64.b64encode(b"image-bytes").decode(), "mimeType": "image/png"}
        with patch.dict("os.environ", {"GEMINI_API_KEY": "server-only-secret"}), patch(
            "server.generate_gemini_image", return_value=generated
        ) as generate:
            response = self.post_image({"prompt": "A village with two huts"})

        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.read()), generated)
        generate.assert_called_once_with("A village with two huts")

    def test_image_generation_uses_local_fallback_when_api_key_is_missing(self):
        with patch.dict("os.environ", {}, clear=True):
            response = self.post_image({"prompt": "A red fox"})

        self.assertEqual(response.code, 503)
        result = json.loads(response.read())
        self.assertFalse(result["configured"])

    def test_image_generation_reports_quota_limit_without_leaking_provider_details(self):
        quota_error = HTTPError(
            "https://generativelanguage.googleapis.com", 429, "Rate limited", {}, None
        )
        with patch.dict("os.environ", {"GEMINI_API_KEY": "server-only-secret"}), patch(
            "server.generate_gemini_image", side_effect=quota_error
        ):
            response = self.post_image({"prompt": "A red fox with a red hat"})

        self.assertEqual(response.code, 429)
        result = json.loads(response.read())
        self.assertIn("quota", result["error"].lower())
        self.assertNotIn("server-only-secret", json.dumps(result))

    def test_image_generation_rejects_violent_prompts_before_calling_provider(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": "server-only-secret"}), patch(
            "server.generate_gemini_image"
        ) as generate:
            response = self.post_image({"prompt": "A graphic bloody fight"})

        self.assertEqual(response.code, 400)
        self.assertIn("violence", json.loads(response.read())["error"])
        generate.assert_not_called()

    def test_gemini_request_keeps_key_in_header_and_validates_image_response(self):
        response_body = json.dumps({
            "output_image": {
                "data": base64.b64encode(b"image-bytes").decode(),
                "mime_type": "image/webp",
            }
        }).encode()

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return response_body

        fake_response = FakeResponse()
        with patch.dict("os.environ", {"GEMINI_API_KEY": "server-only-secret"}), patch(
            "server.urlopen", return_value=fake_response
        ) as open_url:
            result = server.generate_gemini_image("A red fox in a garden")

        request = open_url.call_args.args[0]
        self.assertEqual(request.full_url, "https://generativelanguage.googleapis.com/v1beta/interactions")
        self.assertEqual(request.get_header("X-goog-api-key"), "server-only-secret")
        self.assertEqual(request.get_header("Api-revision"), "2026-05-20")
        self.assertEqual(json.loads(request.data)["model"], "gemini-nano-banana-2.1")
        self.assertEqual(result["mimeType"], "image/webp")
        self.assertEqual(base64.b64decode(result["data"]), b"image-bytes")

    def test_auth_config_disables_unconfigured_providers(self):
        response = urlopen(self.base_url + "/api/auth/config", timeout=3)
        config = json.loads(response.read())

        self.assertEqual(config["redirectUri"], self.base_url + "/")
        self.assertFalse(config["providers"]["google"]["configured"])
        self.assertFalse(config["providers"]["microsoft"]["configured"])

    def test_public_origin_uses_active_railway_host_when_configured_domain_is_stale(self):
        handler = MagicMock()
        handler.headers = {
            "Host": "web-production-e8f7b068.up.railway.app",
            "X-Forwarded-Proto": "https",
        }
        with patch.dict("os.environ", {
            "ROBO_PUBLIC_URL": "https://web-production-62b91153.up.railway.app/",
        }):
            origin = server.public_origin(handler)

        self.assertEqual(origin, "https://web-production-e8f7b068.up.railway.app")

    def test_oauth_exchange_sets_session_cookie_and_session_endpoint_reads_it(self):
        profile = {"signedIn": True, "provider": "Google", "displayName": "Ada", "email": "ada@example.com"}
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "public-id", "GOOGLE_CLIENT_SECRET": "server-secret"}), patch(
            "server.fetch_oauth_token", return_value=profile
        ) as exchange:
            response = self.post_auth({
                "provider": "google",
                "code": "authorization-code",
                "codeVerifier": "v" * 43,
                "redirectUri": self.base_url + "/",
            })

        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.read()), profile)
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        exchange.assert_called_once()

        request = Request(
            self.base_url + "/api/auth/session",
            headers={"Cookie": response.headers["Set-Cookie"].split(";", 1)[0]},
        )
        session = json.loads(urlopen(request, timeout=3).read())
        self.assertEqual(session["email"], "ada@example.com")
        self.assertNotIn("expiresAt", session)

    def test_oauth_exchange_rejects_cross_origin_request(self):
        response = self.post_auth({}, origin="https://attacker.example")

        self.assertEqual(response.code, 403)

    def test_auth_session_rejects_tampered_session_cookie(self):
        request = Request(
            self.base_url + "/api/auth/session",
            headers={"Cookie": "robo_session=eyJzaWduZWRJbiI6dHJ1ZX0.invalid"},
        )
        session = json.loads(urlopen(request, timeout=3).read())

        self.assertEqual(session, {"signedIn": False})

    def test_chat_endpoint_calculates_arithmetic_without_search_or_api_key(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}), \
                patch("server.search_news") as news, \
                patch("server.search_wikipedia") as wikipedia:
            response = self.post_chat({"messages": [{"role": "user", "text": "12 + 34"}]})

        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.read()), {"text": "46", "sources": []})
        news.assert_not_called()
        wikipedia.assert_not_called()

    def test_chat_endpoint_searches_news_only_for_current_news_requests(self):
        news_result = [{
            "title": "Science update",
            "text": "A current report.",
            "url": "https://news.example/article",
            "publisher": "Example News",
            "publishedAt": "today",
        }]
        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}), \
                patch("server.search_news", return_value=news_result) as news, \
                patch("server.search_wikipedia") as wikipedia:
            response = self.post_chat({"messages": [
                {"role": "user", "text": "What are today's latest science news headlines?"}
            ]})

        result = json.loads(response.read())
        self.assertEqual(response.code, 200)
        self.assertIn("Science update", result["text"])
        self.assertEqual(result["sources"][0]["url"], news_result[0]["url"])
        news.assert_called_once()
        wikipedia.assert_not_called()

    def test_daily_regional_news_uses_live_headlines_when_gemini_fails(self):
        news_result = [{
            "title": "Delhi traffic update",
            "text": "A current report from New Delhi.",
            "url": "https://news.example/delhi",
            "publisher": "Example News",
            "publishedAt": "today",
        }]
        query = "What are the daily news updates in New Delhi, India?"
        with patch.dict("os.environ", {"GEMINI_API_KEY": "configured-key"}), \
                patch("server.search_news", return_value=news_result) as news, \
                patch("server.generate_gemini_answer", side_effect=RuntimeError(
                    "ROBO's AI service rejected its server configuration."
                )), \
                patch("server.search_wikipedia") as wikipedia:
            response = self.post_chat({"messages": [{"role": "user", "text": query}]})

        result = json.loads(response.read())
        self.assertEqual(response.code, 200)
        self.assertIn("Delhi traffic update", result["text"])
        self.assertIn("New Delhi", result["text"])
        self.assertEqual(result["sources"][0]["url"], news_result[0]["url"])
        news.assert_called_once_with("New Delhi India news today")
        wikipedia.assert_not_called()

    def test_chat_endpoint_uses_gemini_for_general_questions_and_code(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": "server-only-secret"}), \
                patch("server.generate_gemini_answer", return_value="Here is the Python code.") as generate, \
                patch("server.search_news") as news, \
                patch("server.search_wikipedia") as wikipedia:
            response = self.post_chat({
                "messages": [
                    {"role": "user", "text": "Write Python code that adds two numbers."},
                    {"role": "assistant", "text": "Sure."},
                    {"role": "user", "text": "Include input validation."},
                ],
                "responseStyle": "detailed",
            })

        self.assertEqual(response.code, 200)
        self.assertEqual(json.loads(response.read()), {"text": "Here is the Python code.", "sources": []})
        passed_messages, response_style = generate.call_args.args
        self.assertEqual(passed_messages[-1]["text"], "Include input validation.")
        self.assertEqual(response_style, "detailed")
        news.assert_not_called()
        wikipedia.assert_not_called()

    def test_gemini_answer_uses_server_key_and_preserves_chat_context(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps({
            "candidates": [{"content": {"parts": [{"text": "Here is the code."}]}}]
        }).encode()
        messages = [
            {"role": "user", "text": "Make a calculator."},
            {"role": "assistant", "text": "Which language?"},
            {"role": "user", "text": "Python."},
        ]
        with patch.dict("os.environ", {"GEMINI_API_KEY": "server-only-secret"}), \
                patch("server.urlopen", return_value=response) as open_url:
            answer = server.generate_gemini_answer(messages, "detailed")

        request = open_url.call_args.args[0]
        request_body = json.loads(request.data)
        self.assertEqual(answer, "Here is the code.")
        self.assertEqual(request.get_header("X-goog-api-key"), "server-only-secret")
        self.assertEqual(request_body["contents"][0]["role"], "user")
        self.assertIn("Python.", request_body["contents"][-1]["parts"][0]["text"])
        self.assertIn("working code", request_body["system_instruction"]["parts"][0]["text"])

    def test_chat_endpoint_answers_general_questions_from_wikipedia_without_gemini(self):
        article = {
            "title": "Navaratri",
            "text": "Navaratri is a Hindu festival celebrated over nine nights.",
            "url": "https://en.wikipedia.org/?curid=42",
            "publisher": "Wikipedia",
        }
        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}), \
                patch("server.search_news") as news, \
                patch("server.search_wikipedia", return_value=[article]) as wikipedia:
            response = self.post_chat({
                "messages": [{
                    "role": "user",
                    "text": "What is Navaratri?",
                }]
            })

        result = json.loads(response.read())
        self.assertEqual(response.code, 200)
        self.assertIn("Navaratri is a Hindu festival", result["text"])
        self.assertEqual(result["sources"][0]["url"], article["url"])
        wikipedia.assert_called_once_with("What is Navaratri?", limit=3)
        news.assert_not_called()

    def test_chat_endpoint_falls_back_to_wikipedia_when_gemini_rejects_configuration(self):
        article = {
            "title": "Navaratri",
            "text": "Navaratri is a Hindu festival celebrated over nine nights.",
            "url": "https://en.wikipedia.org/?curid=42",
            "publisher": "Wikipedia",
        }
        with patch.dict("os.environ", {"GEMINI_API_KEY": "configured-key"}), \
                patch("server.generate_gemini_answer", side_effect=RuntimeError(
                    "ROBO's AI service rejected its server configuration."
                )), \
                patch("server.search_news") as news, \
                patch("server.search_wikipedia", return_value=[article]) as wikipedia:
            response = self.post_chat({"messages": [{"role": "user", "text": "Navaratri"}]})

        result = json.loads(response.read())
        self.assertEqual(response.code, 200)
        self.assertIn("reference-based answer", result["text"])
        self.assertIn("Navaratri is a Hindu festival", result["text"])
        self.assertEqual(result["sources"][0]["url"], article["url"])
        wikipedia.assert_called_once_with("Navaratri", limit=3)
        news.assert_not_called()

    def test_chat_endpoint_returns_wikipedia_search_link_when_no_article_matches(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}), \
                patch("server.search_news") as news, \
                patch("server.search_wikipedia", return_value=[]):
            response = self.post_chat({
                "messages": [{
                    "role": "user",
                    "text": "How do I build a quantum-powered garden?",
                }]
            })

        result = json.loads(response.read())
        self.assertEqual(response.code, 200)
        self.assertIn("couldn't find a reliable encyclopedia match", result["text"])
        self.assertIn("Search Wikipedia", result["sources"][0]["title"])
        self.assertIn("quantum-powered", result["sources"][0]["url"])
        news.assert_not_called()

    def test_chat_endpoint_validates_messages(self):
        response = self.post_chat({"messages": [{"role": "system", "text": "bad role"}]})

        self.assertEqual(response.code, 400)
        self.assertIn("invalid message", json.loads(response.read())["error"])

    def test_chat_endpoint_rejects_non_object_json(self):
        request = Request(
            self.base_url + "/api/chat",
            data=b"[]",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as error:
            urlopen(request, timeout=3)

        self.assertEqual(error.exception.code, 400)
        self.assertIn("JSON object", json.loads(error.exception.read())["error"])
        error.exception.close()


if __name__ == "__main__":
    unittest.main()
