const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

export function assertEqual(actual, expected, context = '') {
  if (!Object.is(actual, expected)) {
    throw new Error(`${context ? `${context}: ` : ''}erwartet ${String(expected)}, erhalten ${String(actual)}`);
  }
}

export function assertTrue(condition, context = '') {
  assertEqual(Boolean(condition), true, context);
}

export function assertBytes(actual, expected, context = '') {
  assertEqual(actual.length, expected.length, `${context} Länge`);
  for (let i = 0; i < expected.length; i += 1) {
    assertEqual(actual[i], expected[i], `${context} Byte ${i}`);
  }
}

export function assertThrows(fn, errorType = Error) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof errorType)) {
    throw new Error(`Erwartete Exception ${errorType.name}, erhalten ${caught?.constructor?.name ?? 'keine'}`);
  }
}

export async function runAll() {
  const results = [];
  for (const entry of cases) {
    try {
      await entry.fn();
      results.push({ name: entry.name, passed: true });
    } catch (error) {
      results.push({ name: entry.name, passed: false, error: error.message });
    }
  }
  return results;
}
