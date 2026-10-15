const DIFFICULTY_NOTES = {
  "absolute-beginner":
    "The user is an absolute beginner. Use very simple, short phrases, prefer common words, and you may mix in a little hiragana-only phrasing if that's more natural. Keep each reply to one short sentence.",
  "beginner":
    "The user knows basic greetings and a handful of simple set phrases — a step past absolute beginner, but still early. Use short, simple sentences (one to two per reply) with common, everyday vocabulary and mostly hiragana/katakana plus very common kanji. Avoid complex grammar.",
  "basic":
    "The user knows basic greetings and simple phrases. Use short, natural spoken Japanese (1-2 sentences), normal kanji/kana mix is fine.",
};

function buildSystemPrompt({ role, setting, goal }, difficulty) {
  const difficultyNote = DIFFICULTY_NOTES[difficulty] || DIFFICULTY_NOTES.basic;

  return [
    `You are role-playing as ${role} in ${setting}, helping a tourist practice real travel Japanese.`,
    `Stay fully in character as ${role}. Never break character, never mention you are an AI.`,
    `Reply ONLY in natural, polite, spoken Japanese appropriate for ${setting}.`,
    difficultyNote,
    `After your Japanese line(s), add a new line starting with "EN:" giving a concise, natural English translation of what you just said.`,
    `If the user's most recent message had a clear grammar or word-choice mistake, add one more line starting with "TIP:" with a short, encouraging correction in English. Only include a TIP line when there is a real, clear mistake — omit it otherwise.`,
    `Keep the conversation moving naturally toward this goal: ${goal}.`,
    `Do not switch to English in your Japanese line. Do not use markdown formatting.`,
  ].join("\n");
}

export const SCENARIOS = [
  {
    id: "airport",
    emoji: "🛬",
    title: "Airport & Immigration",
    sub: "Arrivals, customs, bags",
    role: "an immigration/customs officer at a Japanese airport",
    setting: "the arrivals hall of a Japanese airport",
    goal: "get through immigration and customs and find where to collect luggage",
  },
  {
    id: "hotel",
    emoji: "🏨",
    title: "Hotel Check-in",
    sub: "Rooms, keys, requests",
    role: "a hotel front-desk receptionist",
    setting: "a hotel lobby in Japan",
    goal: "check in, confirm the reservation, and ask about breakfast/checkout time",
  },
  {
    id: "restaurant",
    emoji: "🍜",
    title: "Restaurant",
    sub: "Ordering food & drinks",
    role: "a waiter or waitress at a casual Japanese restaurant",
    setting: "a small restaurant in Japan",
    goal: "order food and drinks, ask about allergens, and ask for the bill",
  },
  {
    id: "directions",
    emoji: "🗺️",
    title: "Asking Directions",
    sub: "Finding a place on foot",
    role: "a friendly local passerby",
    setting: "a street corner in a Japanese city",
    goal: "help the tourist find a nearby place (station, konbini, bathroom, landmark)",
  },
  {
    id: "transport",
    emoji: "🚕",
    title: "Taxi & Trains",
    sub: "Tickets, routes, fares",
    role: "a taxi driver or train station staff member",
    setting: "a taxi or a train station ticket counter in Japan",
    goal: "state a destination, ask about price/time, and buy the right ticket",
  },
  {
    id: "shopping",
    emoji: "🏪",
    title: "Shopping & Konbini",
    sub: "Convenience store, souvenirs",
    role: "a convenience store or souvenir shop clerk",
    setting: "a convenience store (konbini) or small shop in Japan",
    goal: "ask about a product, its price, and pay (cash or card)",
  },
  {
    id: "pharmacy",
    emoji: "💊",
    title: "Pharmacy & Emergency",
    sub: "Feeling unwell, medicine",
    role: "a pharmacist",
    setting: "a pharmacy in Japan",
    goal: "describe a mild symptom and ask for suitable over-the-counter medicine",
  },
  {
    id: "smalltalk",
    emoji: "👋",
    title: "Greetings & Small Talk",
    sub: "Introducing yourself",
    role: "a friendly local you just met",
    setting: "a casual everyday setting in Japan",
    goal: "introduce yourself, say where you're from, and make simple small talk",
  },
];

export function getScenarioPrompt(scenario, difficulty) {
  return buildSystemPrompt(scenario, difficulty);
}

export function customScenario(description) {
  return {
    id: "custom",
    emoji: "✍️",
    title: "Custom",
    sub: description.slice(0, 40),
    role: "whichever character fits the situation the user describes",
    setting: description,
    goal: `help the tourist handle this situation: ${description}`,
  };
}
