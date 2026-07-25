// ─────────────────────────────────────────────────────────────────────────────
// Mock research provider — deterministic, offline, zero-network.
//
// Enable with RESEARCH_PROVIDER=mock. This exists so the entire product can be
// developed, tested, and demoed for free WITHOUT depending on a live search
// engine (which may rate-limit). It routes queries to realistic fixture pages
// and runs them through the SAME extraction path as the real provider, so the
// full pipeline is exercised honestly. It is clearly labelled as mock in the UI.
// ─────────────────────────────────────────────────────────────────────────────

import type { FetchedPage, ResearchProvider, SearchResult } from "./types";
import { extractReadable } from "./extract";

interface Fixture {
  url: string;
  title: string;
  snippet: string;
  keywords: string[];
  html: string;
}

const FIXTURES: Fixture[] = [
  {
    url: "https://example-driving.test/best-instructors-austin",
    title: "8 Best Driving Instructors in Austin (2026) — Prices & Reviews",
    snippet: "Compare the top-rated driving instructors in Austin, TX with hourly prices and availability.",
    keywords: ["driving", "instructor", "instructors", "austin", "lessons"],
    html: `<html><head><title>8 Best Driving Instructors in Austin (2026) — Prices & Reviews</title></head><body><article>
      <h1>8 Best Driving Instructors in Austin</h1>
      <p>We compared driving instructors across Austin, TX. All prices are per hour.</p>
      <h2>1. Lone Star Driving Academy</h2>
      <p>Rated 4.8/5. Lessons from $45/hour. Serves central Austin and covers evenings and weekends, with availability next week. Call (512) 555-0142.</p>
      <h2>2. Capital City Driving School</h2>
      <p>Rated 4.6/5. Priced at $55/hour in Austin, TX. Flexible scheduling including next week. Email hello@capitalcitydriving.test.</p>
      <h2>3. Hill Country Driver Training</h2>
      <p>Rated 4.9/5. $58/hour. Premium instructors in Austin. Booking fills fast; limited availability next week. Phone (512) 555-0199.</p>
      <h2>4. Bluebonnet Driving Instructors</h2>
      <p>Rated 4.3/5. $72/hour — a bit above budget. Austin, TX. Weekend availability only.</p>
      <h2>5. Congress Ave Driving Lessons</h2>
      <p>Rated 4.1/5. $49/hour. Downtown Austin. Contact (512) 555-0170 for next week slots.</p>
    </article></body></html>`,
  },
  {
    url: "https://example-driving.test/lone-star-academy",
    title: "Lone Star Driving Academy — Austin Driving Lessons",
    snippet: "Affordable driving lessons in Austin from $45/hour.",
    keywords: ["driving", "instructor", "austin", "lessons", "lone", "star"],
    html: `<html><head><title>Lone Star Driving Academy — Austin Driving Lessons</title></head><body><main>
      <h1>Lone Star Driving Academy</h1>
      <p>Professional driving instruction in Austin, TX. Our lessons start at $45/hour with package discounts.</p>
      <p>We are rated 4.8/5 by over 300 students. Availability next week is open for morning and evening slots.</p>
      <p>Book online or call (512) 555-0142. Email book@lonestardriving.test.</p>
    </main></body></html>`,
  },
  {
    url: "https://example-eats.test/best-restaurants-chicago-groups",
    title: "10 Best Chicago Restaurants for Groups (Under $50/Person)",
    snippet: "Great Chicago restaurants for groups of 6, most under $50 per person.",
    keywords: ["restaurant", "restaurants", "chicago", "group", "dinner", "people"],
    html: `<html><head><title>10 Best Chicago Restaurants for Groups (Under $50/Person)</title></head><body><article>
      <h1>10 Best Chicago Restaurants for Groups</h1>
      <p>Perfect for a party of 6 this weekend. Prices are approximate per person.</p>
      <h2>1. The Purple Pig</h2>
      <p>Mediterranean small plates in Chicago, IL. About $45/person. Open Mon-Sun 11:30am-11pm. Vegetarian friendly. Reserve at thepurplepig.test.</p>
      <h2>2. Girl and the Goat</h2>
      <p>New American in Chicago. Around $60/person — above the budget. Booking via resy. Gluten-free options.</p>
      <h2>3. Lou Malnati's Pizzeria</h2>
      <p>Deep dish pizza, Chicago IL. Roughly $25/person. Open daily 11am-10pm. Great for groups. Book at loumalnatis.test.</p>
      <h2>4. Pequod's Pizza</h2>
      <p>Iconic pan pizza. About $30/person in Chicago. Vegetarian options. Walk-ins and reservations.</p>
      <h2>5. Xoco</h2>
      <p>Mexican street food, Chicago. Approximately $28/person. Open Tue-Sat. Vegetarian friendly.</p>
    </article></body></html>`,
  },
  {
    url: "https://example-tech.test/best-laptops-programming-gaming-1500",
    title: "Best Laptops for Programming and Gaming Under $1500 (2026)",
    snippet: "Top laptops under $1500 that handle both coding and gaming.",
    keywords: ["laptop", "laptops", "programming", "gaming", "compare"],
    html: `<html><head><title>Best Laptops for Programming and Gaming Under $1500 (2026)</title></head><body><article>
      <h1>Best Laptops for Programming and Gaming Under $1500</h1>
      <p>We tested machines that balance developer workloads and gaming.</p>
      <h2>1. Lenovo Legion 5 Pro</h2>
      <p>$1,399. Ryzen 7, RTX 4060, 16GB RAM, 1TB SSD. 1-year warranty. Sold by Lenovo. Rated 4.7/5. 30-day return policy.</p>
      <h2>2. ASUS TUF Gaming A15</h2>
      <p>$1,199. Ryzen 7, RTX 4060, 16GB RAM. 1-year warranty. Sold by ASUS. Rated 4.5/5.</p>
      <h2>3. Acer Predator Helios Neo 16</h2>
      <p>$1,299. Intel Core i7, RTX 4060, 16GB RAM. Sold by Acer. Rated 4.4/5. Free returns within 15 days.</p>
      <h2>4. Razer Blade 14</h2>
      <p>$1,999 — over budget. Ryzen 9, RTX 4070. Premium build. Rated 4.6/5.</p>
    </article></body></html>`,
  },
  {
    url: "https://example-shop.test/how-to-return-a-product",
    title: "How to Return a Product — Step-by-Step Returns Guide",
    snippet: "Exact steps to return an online order and get a refund.",
    keywords: ["return", "product", "refund", "how", "steps", "amazon"],
    html: `<html><head><title>How to Return a Product — Step-by-Step Returns Guide</title></head><body><article>
      <h1>How to Return a Product</h1>
      <p>Follow these steps to return an item and get a refund.</p>
      <h2>1. Open Your Orders</h2>
      <p>Go to Your Orders in your account and find the item you want to return.</p>
      <h2>2. Select Return or Replace Items</h2>
      <p>Choose the order, then click Return or Replace Items and pick a reason.</p>
      <h2>3. Choose a Refund or Replacement</h2>
      <p>Select refund to original payment method, then choose a drop-off or pickup option.</p>
      <h2>4. Print the Return Label</h2>
      <p>Print the prepaid label and attach it to the package. Returns are usually free within 30 days.</p>
      <h2>5. Drop Off the Package</h2>
      <p>Take it to the carrier location. Refunds typically process within 3-5 business days after receipt.</p>
    </article></body></html>`,
  },
  {
    url: "https://example-travel.test/cheapest-flights-guide",
    title: "How to Find the Cheapest Flights — Options Compared",
    snippet: "Compare the cheapest flight options and booking methods.",
    keywords: ["flight", "flights", "cheapest", "fly", "airfare"],
    html: `<html><head><title>How to Find the Cheapest Flights — Options Compared</title></head><body><article>
      <h1>Cheapest Flight Options Compared</h1>
      <p>We compared common ways to book affordable flights.</p>
      <h2>1. Budget Carrier Direct</h2>
      <p>From $89 one-way. Nonstop on low-cost airlines. Book on the airline site. Fewer amenities.</p>
      <h2>2. Legacy Airline Basic Economy</h2>
      <p>Around $149. 1 stop typical. Airline booking. More reliable schedules.</p>
      <h2>3. Aggregator Bundle</h2>
      <p>About $129. Mixed airlines. Book via aggregator. Flexible dates recommended.</p>
    </article></body></html>`,
  },
];

export class MockResearchProvider implements ResearchProvider {
  readonly name = "mock";

  async search(query: string, limit = 8): Promise<SearchResult[]> {
    const q = query.toLowerCase();
    const scored = FIXTURES.map((f) => {
      let score = 0;
      for (const k of f.keywords) if (q.includes(k)) score += 2;
      return { f, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const chosen = (scored.length ? scored : FIXTURES.map((f) => ({ f, score: 0 }))).slice(0, limit);
    return chosen.map(({ f }) => ({ url: f.url, title: f.title, snippet: f.snippet }));
  }

  async fetch(url: string): Promise<FetchedPage> {
    const f = FIXTURES.find((x) => x.url === url);
    if (!f) {
      return { url, finalUrl: url, title: url, text: "", links: [], words: 0, ok: false, error: "not in fixtures" };
    }
    const { title, text, links } = extractReadable(f.html, f.url);
    return { url, finalUrl: f.url, title, text, links, words: text.split(/\s+/).length, ok: true };
  }
}
