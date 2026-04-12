import openai
import os
import re
import requests
from collections import deque
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

from dotenv import load_dotenv, find_dotenv
_ = load_dotenv(find_dotenv()) # read local .env file

openai.api_key  = os.getenv('OPENAI_API_KEY')

client = openai.OpenAI()

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
}

class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set()

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'a':
            return
        for name, value in attrs:
            if name.lower() == 'href' and value:
                self.links.add(value)


def normalize_url(base_url, link):
    if link.startswith('#'):
        return None
    if link.startswith('mailto:') or link.startswith('tel:'):
        return None
    normalized = urljoin(base_url, link)
    parsed = urlparse(normalized)
    if parsed.scheme not in ('http', 'https'):
        return None
    return normalized.rstrip('/')


def normalize_netloc(netloc):
    netloc = netloc.lower()
    if netloc.startswith('www.'):
        return netloc[4:]
    return netloc


def extract_internal_links(html, base_url):
    parser = LinkParser()
    try:
        parser.feed(html)
    except AssertionError:
        # fallback on malformed HTML
        parser.links.update(re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.I))

    base_netloc = normalize_netloc(urlparse(base_url).netloc)
    internal_links = set()
    for link in parser.links:
        normalized = normalize_url(base_url, link)
        if not normalized:
            continue
        if normalize_netloc(urlparse(normalized).netloc) == base_netloc:
            internal_links.add(normalized)
    return internal_links


def crawl_site(start_url, max_pages=10):
    visited = set()
    queue = deque([start_url])
    pages = []

    while queue and len(visited) < max_pages:
        url = queue.popleft()
        if url in visited:
            continue

        try:
            response = requests.get(url, timeout=15, headers=DEFAULT_HEADERS)
            response.raise_for_status()
        except requests.RequestException:
            continue

        visited.add(url)
        pages.append((url, response.text))

        for link in extract_internal_links(response.text, url):
            if link not in visited:
                queue.append(link)

    return pages


def find_email_regex(html):
    match = re.search(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", html)
    return match.group(0) if match else None


def find_email_with_playwright(url, timeout_ms=15000):
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            # Prefer explicit mailto links, then scan visible text.
            mailtos = page.eval_on_selector_all(
                "a[href^='mailto:']",
                "els => els.map(e => e.getAttribute('href'))"
            )
            for href in mailtos or []:
                email = href.replace("mailto:", "").split("?")[0].strip()
                if email:
                    browser.close()
                    return email

            text = page.inner_text("body")
            browser.close()
            return find_email_regex(text)
    except Exception:
        return None


def get_completion(prompt, model="gpt-4o", temperature=0):
    messages = [{"role": "user", "content": prompt}]
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    return response.choices[0].message.content

def get_completion_from_messages(messages, model="gpt-4o", temperature=0):
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature, # this is the degree of randomness of the model's output
    )
    # print(str(response.choices[0].message))
    return response.choices[0].message.content

url = "http://www.heritage-restaurants.com/basel"
pages = crawl_site(url, max_pages=10)

email = None
for page_url, page_html in pages:
    email = find_email_regex(page_html)
    if email:
        print(f'Found email on {page_url} via regex: {email}')
        break

if email is None:
    email = find_email_with_playwright(url)
    if email:
        print(f'Found email on {url} via Playwright: {email}')

if email is None:
    for page_url, page_html in pages:
        snippet = page_html[:16000]
        prompt = f"""
Extract any email address from the following content.

Your task: find ANY email address on this page, regardless of format or context.

An email address is a string matching: something@domain.extension

If multiple emails exist, prefer ones that look like contact emails (info@, contact@, hello@, support@) over no-reply or automated addresses.

Return ONLY the email address itself. If no email is found, return \"NOT_FOUND\".

Page URL: {page_url}
Content:
{snippet}

Response:
"""
        response = get_completion(prompt).strip()
        if response and response != "NOT_FOUND":
            email = response
            print(f'Found email on {page_url} via model: {email}')
            break

if email is None:
    print('NOT_FOUND')
else:
    print(email)
