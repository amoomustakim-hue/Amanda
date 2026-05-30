const defaultTimeZone = "Africa/Lagos";

function hasExplicitDurationText(message) {
  return /\bfor\s+(\d+(?:\.\d+)?|one|two|three|four)\s*(hour|hours|minute|minutes)\b/i.test(
    String(message || ""),
  );
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function cleanLocationValue(value) {
  return String(value || "")
    .replace(/^[,\s-]+/, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatHumanTime(hour, minute) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function timeRegex() {
  return /\b(?:at|by|for)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)(?=$|\s|[.,!?])/i;
}

function normalizePeriod(value) {
  return String(value || "").toLowerCase().replace(/[\s.]/g, "");
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\b(schedule|book|create|set|calendar|event|appointment)\b/gi, " ")
    .replace(/\b(make it|change it|move it|set it|change the location to|location to)\b/gi, " ")
    .replace(/\b(tomorrow|today|next\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\b(at|by)?\s*\d{1,2}(:\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?\b/gi, " ")
    .replace(/\b(for)\s+\d+\s+(hour|hours|minute|minutes)\b/gi, " ")
    .replace(/\b(at|in|on)\s+.+$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nextWeekday(dayName, now) {
  const days = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const target = days[dayName];
  if (target === undefined) return null;
  const date = new Date(now);
  const delta = ((target - date.getDay() + 7) % 7) || 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function parseDate(message, now) {
  const lower = message.toLowerCase();
  const date = new Date(now);
  if (lower.includes("today")) return { date, found: true, label: "today" };
  if (lower.includes("tomorrow")) {
    date.setDate(date.getDate() + 1);
    return { date, found: true, label: "tomorrow" };
  }
  const weekday = lower.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    return { date: nextWeekday(weekday[1], now), found: true, label: weekday[0] };
  }
  const month = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/);
  if (month) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = months.findIndex((item) => month[1].startsWith(item));
    const parsed = new Date(now);
    parsed.setMonth(monthIndex, Number(month[2]));
    if (parsed < now) parsed.setFullYear(parsed.getFullYear() + 1);
    return { date: parsed, found: true, label: `${month[1]} ${month[2]}` };
  }
  return { date, found: false, label: "" };
}

function parseTime(message) {
  const lower = message.toLowerCase();
  const match = lower.match(timeRegex());
  if (!match) {
    if (/\bmorning\b/.test(lower)) return { found: true, hour: 9, minute: 0 };
    if (/\bafternoon\b/.test(lower)) return { found: true, hour: 14, minute: 0 };
    if (/\bevening\b/.test(lower)) return { found: true, hour: 17, minute: 0 };
    return { found: false, hour: 10, minute: 0 };
  }
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = normalizePeriod(match[3]);
  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  return {
    found: true,
    hour,
    minute,
    normalizedTime: formatHumanTime(hour, minute),
    period,
    timeText: match[0].trim(),
  };
}

function parseDurationMinutes(message) {
  const lower = message.toLowerCase();
  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
  };
  const match = lower.match(/\bfor\s+(\d+(?:\.\d+)?|one|two|three|four)\s*(hour|hours|minute|minutes)\b/);
  if (!match) return 30;
  const amount = words[match[1]] || Number(match[1]);
  return match[2].startsWith("hour") ? Math.round(amount * 60) : Math.round(amount);
}

function parseLocation(message) {
  const withoutTimes = message.replace(timeRegex(), " ");
  const directPatterns = [
    /\b(?:the\s+)?location\s+is\s+at\s+(.+?)$/i,
    /\b(?:the\s+)?location\s+is\s+(.+?)$/i,
    /\b(?:change|set)\s+(?:the\s+)?location\s+to\s+(.+?)$/i,
    /\bmake\s+(?:the\s+)?location\s+(?:be\s+)?(.+?)$/i,
    /\buse\s+(.+?)\s+as\s+the\s+location$/i,
    /^(?:at|in|on)\s+(.+?)$/i,
  ];
  for (const pattern of directPatterns) {
    const match = withoutTimes.match(pattern);
    if (match) {
      const value = cleanLocationValue(match[1]);
      if (value) return value;
    }
  }
  const matches = [...withoutTimes.matchAll(/\b(?:at|in|on)\s+(.+?)(?=\s+for\s+(?:\d+(?:\.\d+)?|one|two|three|four)\s+(?:hour|hours|minute|minutes)\b|$)/gi)];
  for (const match of matches.reverse()) {
    const value = cleanLocationValue(match[1]);
    if (/\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(value)) continue;
    if (/^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(value)) continue;
    if (value) return value;
  }
  return "";
}

function titleFromMessage(message) {
  const lower = message.toLowerCase();
  const productReview = message.match(/\bproduct review\b/i);
  if (productReview) return "Product review";
  const callWith = message.match(/\bcall with ([a-z][a-z\s.'-]{1,40}?)(?:\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|at|by|for)\b|$)/i);
  if (callWith) return `Call with ${callWith[1].trim().replace(/\b\w/g, (char) => char.toUpperCase())}`;
  if (lower.includes("supplier")) return "Supplier meeting";
  const delivery = message.match(/\bdelivery follow-?up\b/i);
  if (delivery) return "Delivery follow-up";
  const afterFor = message.match(/\bfor\s+(.+?)(?:\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|at|by|for\s+\d)\b|$)/i);
  const cleaned = cleanTitle(afterFor?.[1] || message);
  if (/^meeting$/i.test(cleaned)) return "Meeting";
  if (!cleaned || /^(a|an|the|an event|something)$/i.test(cleaned)) return "";
  return cleaned[0].toUpperCase() + cleaned.slice(1);
}

function formatOffsetIso(date, hour, minute) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}:00.000+01:00`;
}

function addMinutes(hour, minute, duration) {
  const total = hour * 60 + minute + duration;
  return {
    hour: Math.floor(total / 60) % 24,
    minute: total % 60,
  };
}

export function parseCalendarEventRequest(message, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const timeZone = options.timezone || defaultTimeZone;
  const date = parseDate(message, now);
  const time = parseTime(message);
  const durationMinutes = parseDurationMinutes(message);
  const end = addMinutes(time.hour, time.minute, durationMinutes);
  const title = titleFromMessage(message);
  const location = parseLocation(message);
  const missingFields = [];
  if (!title || (!date.found && /^(a\s+)?meeting$/i.test(title))) missingFields.push("title");
  if (!date.found) missingFields.push("date");
  if (!time.found) missingFields.push("time");

  return {
    dateLabel: date.label || "",
    description: "Prepared by Amanda.",
    durationMinutes,
    end: formatOffsetIso(date.date, end.hour, end.minute),
    location,
    missingFields,
    start: formatOffsetIso(date.date, time.hour, time.minute),
    timeLabel: time.found ? formatHumanTime(time.hour, time.minute) : "",
    timeText: time.timeText || "",
    timeZone,
    title,
  };
}

function parseIso(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function inferDurationMinutes(payload = {}) {
  if (Number.isFinite(Number(payload.durationMinutes)) && Number(payload.durationMinutes) > 0) {
    return Number(payload.durationMinutes);
  }
  const start = parseIso(payload.start);
  const end = parseIso(payload.end);
  if (start && end) {
    const diff = Math.round((end.getTime() - start.getTime()) / 60000);
    if (diff > 0) return diff;
  }
  return 30;
}

function followUpTypeFromFields(fields = []) {
  const unique = [...new Set(fields)];
  if (unique.length > 1) return "multiple";
  const first = unique[0] || "";
  if (first === "location") return "location";
  if (first === "durationMinutes") return "duration";
  if (first === "date") return "date";
  if (first === "time") return "time";
  return "";
}

export function parseCalendarFollowUp(message, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const basePayload = options.basePayload || {};
  const timeZone = options.timezone || basePayload.timeZone || defaultTimeZone;
  const baseStart = parseIso(basePayload.start) || new Date(now);
  const workingStart = new Date(baseStart);
  const fields = [];

  const location = parseLocation(message);
  if (location) fields.push("location");

  const date = parseDate(message, now);
  if (date.found) {
    workingStart.setFullYear(date.date.getFullYear(), date.date.getMonth(), date.date.getDate());
    fields.push("date");
  }

  const time = parseTime(message);
  if (time.found) {
    workingStart.setHours(time.hour, time.minute, 0, 0);
    fields.push("time");
  }

  const explicitDuration = hasExplicitDurationText(message);
  const durationMinutes = explicitDuration
    ? parseDurationMinutes(message)
    : inferDurationMinutes(basePayload);
  if (explicitDuration) fields.push("durationMinutes");

  const result = {
    fields: [...new Set(fields)],
    followUpType: followUpTypeFromFields(fields),
    timeZone,
  };

  if (location) result.location = location;
  if (date.found) result.dateLabel = date.label || "";
  if (time.found) result.timeLabel = formatHumanTime(time.hour, time.minute);
  if (time.found) {
    result.normalizedTime = time.normalizedTime || formatHumanTime(time.hour, time.minute);
    result.timeText = time.timeText || "";
  }
  if (explicitDuration) result.durationMinutes = durationMinutes;

  if (date.found || time.found || explicitDuration) {
    const endDate = new Date(workingStart);
    endDate.setMinutes(endDate.getMinutes() + durationMinutes);
    result.start = formatOffsetIso(workingStart, workingStart.getHours(), workingStart.getMinutes());
    result.end = formatOffsetIso(endDate, endDate.getHours(), endDate.getMinutes());
    if (!result.durationMinutes) result.durationMinutes = durationMinutes;
  }

  return result;
}

export function calendarClarification(parsed) {
  const missing = new Set(parsed.missingFields || []);
  if (missing.has("title") && missing.has("date")) {
    return "What should I call the calendar event, and which date should I use?";
  }
  if (missing.has("title")) return "What should I call the calendar event?";
  if (missing.has("date")) return "Which date should I use?";
  if (missing.has("time")) return "What time should I schedule it for?";
  return "";
}
