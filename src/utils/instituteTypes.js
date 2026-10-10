// Rough, clearly-labelled fallback shown ONLY when a live lookup finds nothing, fails, or takes too long.
// These are approximate ranges from general knowledge of each institute type, NOT data about a specific college.
// Check them against NIRF / official placement reports and edit the numbers below before relying on them.
const INFO = {
  IIT: { label: 'IITs', avg: '₹12–25 LPA', highest: '₹50 LPA – ₹2 Cr+', fees: '₹8–11 lakh (tuition and fees, hostel extra)' },
  NIT: { label: 'NITs', avg: '₹8–18 LPA', highest: '₹30–90 LPA', fees: '₹5–7 lakh (tuition and fees, hostel extra)' },
  IIIT: { label: 'IIITs', avg: '₹10–22 LPA', highest: '₹30–70 LPA', fees: '₹6–14 lakh (varies widely between IIITs)' },
  OTHER: { label: 'government-funded technical institutes', avg: '₹5–12 LPA', highest: '₹15–45 LPA', fees: '₹3–8 lakh' },
};

export function instituteType(name = '') {
  const n = String(name).toUpperCase();
  if (/INSTITUTE OF INFORMATION TECHNOLOGY|\bIIIT/.test(n)) return { key: 'IIIT', ...INFO.IIIT };
  if (/INDIAN INSTITUTE OF TECHNOLOGY|\bIIT\b/.test(n)) return { key: 'IIT', ...INFO.IIT };
  if (/NATIONAL INSTITUTE OF TECHNOLOGY|\bNIT\b/.test(n)) return { key: 'NIT', ...INFO.NIT };
  return { key: 'OTHER', ...INFO.OTHER };
}
