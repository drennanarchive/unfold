/*
 * The gift catalog. Edit this file to change what's on each list.
 *
 * Each gift needs:
 *   id         Unique and permanent. Lowercase letters, numbers and dashes only
 *              (e.g. "clara-cozy-blanket"). Claims are stored against this id,
 *              so don't rename it once people have started claiming.
 *   recipient  Must match one of the names in RECIPIENTS below.
 *   name       What the gift is.
 *
 * Optional:
 *   description  A short note (size, colour, "any brand is fine", ...).
 *   price        Free text, shown as written: "$35", "~$20", "$40–60".
 *   link         Where to find it (must start with http:// or https://).
 *   image        An image URL. If missing or broken, the emoji is shown instead.
 *   emoji        The picture shown when there's no image. Defaults to 🎁.
 *
 * These are SAMPLE gifts so the page can be tried out. Replace them with the real lists.
 */

window.RECIPIENTS = ["Clara", "Cameron"];

window.GIFTS = [
  // ---- Clara ----
  {
    id: "clara-cozy-blanket",
    recipient: "Clara",
    name: "Cozy oversized blanket",
    description: "Soft knit throw, big enough for the whole couch. Cream or sage.",
    price: "$35",
    link: "https://example.com/blanket",
    emoji: "🧶",
  },
  {
    id: "clara-mystery-novel",
    recipient: "Clara",
    name: "A good mystery novel",
    description: "Anything twisty. Bonus points for a hardcover.",
    price: "~$20",
    emoji: "📚",
  },
  {
    id: "clara-candle-set",
    recipient: "Clara",
    name: "Winter candle set",
    description: "Pine, cedar or cinnamon scents.",
    price: "$28",
    link: "https://example.com/candles",
    emoji: "🕯️",
  },
  {
    id: "clara-tea-sampler",
    recipient: "Clara",
    name: "Loose-leaf tea sampler",
    price: "$18",
    emoji: "🍵",
  },
  {
    id: "clara-plant",
    recipient: "Clara",
    name: "Small houseplant",
    description: "Something hard to kill, in a nice pot.",
    emoji: "🪴",
  },

  // ---- Cameron ----
  {
    id: "cameron-headphones",
    recipient: "Cameron",
    name: "Wireless headphones",
    description: "Over-ear, noise cancelling. Black.",
    price: "$90–120",
    link: "https://example.com/headphones",
    emoji: "🎧",
  },
  {
    id: "cameron-board-game",
    recipient: "Cameron",
    name: "A new board game",
    description: "Strategy games for 2–4 players.",
    price: "$45",
    emoji: "🎲",
  },
  {
    id: "cameron-coffee",
    recipient: "Cameron",
    name: "Fancy coffee beans",
    description: "Whole bean, medium roast.",
    price: "$22",
    link: "https://example.com/coffee",
    emoji: "☕",
  },
  {
    id: "cameron-socks",
    recipient: "Cameron",
    name: "Warm wool socks",
    description: "Size L. Always welcome.",
    price: "$15",
    emoji: "🧦",
  },
  {
    id: "cameron-hoodie",
    recipient: "Cameron",
    name: "Zip-up hoodie",
    description: "Size L, navy or charcoal.",
    price: "$50",
    emoji: "🧥",
  },
];
