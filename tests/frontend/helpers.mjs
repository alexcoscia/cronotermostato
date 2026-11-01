// Builds a program dict from a shared case (same rules as tests/test_frontend_parity.py):
// "day" is Monday, "day1".."day6" the other days, "holiday" the holiday part,
// "program_name" overrides the name, "days" the number of days (default 7).
export function buildProgram(c) {
  const days = c.days ?? 7;
  const week = Array.from({ length: days }, () => []);
  if (days > 0) week[0] = c.day ?? [];
  for (let i = 1; i < days; i++) {
    if (c[`day${i}`] !== undefined) week[i] = c[`day${i}`];
  }
  return { id: "p1", name: c.program_name ?? "Program", week, holiday: c.holiday ?? [] };
}
