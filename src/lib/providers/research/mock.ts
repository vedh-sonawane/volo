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

  // ── Informational / reference pages (MUST be classified as information, not
  //    candidates). These reproduce the reported failure: a government guide and
  //    an aggregator listing that must never appear as "options". ──────────────
  {
    url: "https://www.gov.uk/become-driving-instructor",
    title: "Become an approved driving instructor (ADI) — guide",
    snippet: "How to register as an approved driving instructor (ADI).",
    keywords: ["driving", "instructor", "instructors", "adi", "register", "become", "lessons"],
    html: `<html><head><title>Become an approved driving instructor (ADI) — guide</title></head><body><article>
      <h1>Become an approved driving instructor</h1>
      <p>This guide explains how to qualify and register as an approved driving instructor (ADI).</p>
      <h2>1. Register as an ADI</h2><p>To register you must pass three qualifying tests and a background check.</p>
      <h2>2. When you're an ADI</h2><p>Once registered you must display your certificate in the car.</p>
      <h2>3. Renew your ADI registration</h2><p>Registration lasts four years and must be renewed.</p>
      <h2>4. Fees and costs</h2><p>The registration fee is set by the DVSA each year.</p>
      <h2>5. More information</h2><p>Read the full guidance for approved driving instructors.</p>
    </article></body></html>`,
  },

  // ── Bicycle repair: one real shop (candidate) + one how-to page (info). ─────
  {
    url: "https://spokes-repair.test/",
    title: "Spokes Bike Repair — Toronto Bicycle Repair Shop",
    snippet: "Bicycle repair and tune-ups in Toronto.",
    keywords: ["bicycle", "bike", "repair", "shop", "toronto", "mechanic", "place", "tune"],
    html: `<html><head><title>Spokes Bike Repair — Toronto Bicycle Repair Shop</title></head><body><main>
      <h1>Spokes Bike Repair</h1>
      <p>Full-service bicycle repair in Toronto, ON. Basic tune-up from $45, flat-tyre fix $20 — most repairs under $100.
      Open Mon-Sat 9am-6pm. Rated 4.7/5 by local riders. Call (416) 555-0133 or book online.</p>
    </main></body></html>`,
  },
  {
    url: "https://bike-blog.test/how-to-fix-a-flat",
    title: "How to Fix a Flat Bike Tire — Step by Step",
    snippet: "A guide to repairing a flat bicycle tyre yourself.",
    keywords: ["bicycle", "bike", "repair", "fix", "flat", "how", "tyre", "tire"],
    html: `<html><head><title>How to Fix a Flat Bike Tire — Step by Step</title></head><body><article>
      <h1>How to Fix a Flat Bike Tire</h1>
      <h2>1. Remove the wheel</h2><p>Open the brake and undo the quick release.</p>
      <h2>2. Take off the tyre</h2><p>Use tyre levers to pry one side off the rim.</p>
      <h2>3. Replace the tube</h2><p>Insert a new inner tube and seat the tyre.</p>
    </article></body></html>`,
  },

  // ── Campsite: one real campground (candidate) + one encyclopedia page (info).
  {
    url: "https://pinegrove-campground.test/",
    title: "Pine Grove Campground — Camping near Toronto",
    snippet: "Family campground with electric hookups near Toronto.",
    keywords: ["campsite", "campground", "camping", "toronto", "electricity", "electric", "tent", "weekend"],
    html: `<html><head><title>Pine Grove Campground — Camping near Toronto</title></head><body><main>
      <h1>Pine Grove Campground</h1>
      <p>A family campground in Barrie, ON, about an hour from Toronto. Sites from $38/night with electricity hookups.
      Open May to October. Rated 4.6/5. Reserve online or call (705) 555-0180.</p>
    </main></body></html>`,
  },
  {
    url: "https://encyclo.test/wiki/Camping",
    title: "Camping - Encyclopedia",
    snippet: "Camping is an outdoor activity involving overnight stays.",
    keywords: ["camping", "campsite", "outdoor", "tent", "history"],
    html: `<html><head><title>Camping - Encyclopedia</title></head><body><article>
      <h1>Camping</h1>
      <p>Camping is an outdoor activity involving overnight stays away from home in a shelter such as a tent.</p>
      <h2>History</h2><p>Recreational camping became popular in the early 20th century.</p>
      <h2>Equipment</h2><p>Common equipment includes tents, sleeping bags, and stoves.</p>
    </article></body></html>`,
  },

  // ── Universities: two real universities (candidates) + a rankings list (info).
  {
    url: "https://tech-university.test/tuition",
    title: "Tech University — Tuition & Computer Science Program",
    snippet: "Tuition and CS program details for Tech University.",
    keywords: ["university", "universities", "tuition", "computer", "science", "compare", "college", "programs"],
    html: `<html><head><title>Tech University — Tuition & Computer Science Program</title></head><body><main>
      <h1>Tech University</h1>
      <p>Tech University is a private research university located in Boston, MA. Annual undergraduate tuition is
      $42,000 for the current academic year, excluding housing and fees. Our Computer Science program is rated
      4.6/5 by students and offers specialisations in artificial intelligence, systems, and human-computer
      interaction. Class sizes are small and most courses include a lab component. Students can apply online through
      the admissions portal; the application deadline for the autumn intake is in January.</p>
    </main></body></html>`,
  },
  {
    url: "https://state-college.test/cs",
    title: "State College — Affordable Computer Science Degree",
    snippet: "Affordable CS degree at State College.",
    keywords: ["university", "universities", "tuition", "computer", "science", "compare", "college", "programs"],
    html: `<html><head><title>State College — Affordable Computer Science Degree</title></head><body><main>
      <h1>State College</h1>
      <p>State College is a public university located in Columbus, OH. Annual in-state tuition is $18,500 per year,
      making it one of the more affordable options for a computer science degree. The BSc in Computer Science
      includes a data-science track and an optional co-op placement year with local employers. The program is
      rated 4.2/5 by current students. Financial aid and scholarships are available, and admissions are handled
      through the state application system.</p>
    </main></body></html>`,
  },
  {
    url: "https://rankings.test/best-cs-schools",
    title: "The 20 Best Computer Science Schools (2026 Rankings)",
    snippet: "A ranking of top computer science schools.",
    keywords: ["university", "universities", "computer", "science", "best", "rankings", "compare", "college"],
    html: `<html><head><title>The 20 Best Computer Science Schools (2026 Rankings)</title></head><body><article>
      <h1>The 20 Best Computer Science Schools</h1>
      <p>Our editors ranked computer science programs by reputation.</p>
      <h2>Methodology</h2><p>We weighted faculty, research output, and outcomes.</p>
      <h2>More information</h2><p>See the full methodology and sources.</p>
    </article></body></html>`,
  },

  // ── Subscription cancellation: a how-to guide (procedure → ordered steps). ──
  {
    url: "https://help-center.test/cancel-gym-membership",
    title: "How to Cancel Your Gym Membership",
    snippet: "Step-by-step guide to cancelling a gym subscription.",
    keywords: ["cancel", "subscription", "gym", "membership", "how", "unsubscribe", "understand"],
    html: `<html><head><title>How to Cancel Your Gym Membership</title></head><body><article>
      <h1>How to Cancel Your Gym Membership</h1>
      <h2>1. Log in to your account</h2><p>Sign in on the gym's website or app.</p>
      <h2>2. Open Membership settings</h2><p>Go to Account, then Membership.</p>
      <h2>3. Select Cancel Membership</h2><p>Choose a cancellation reason if prompted.</p>
      <h2>4. Confirm the cancellation</h2><p>Review any notice period or final charge.</p>
      <h2>5. Save the confirmation</h2><p>Keep the confirmation email as proof.</p>
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
