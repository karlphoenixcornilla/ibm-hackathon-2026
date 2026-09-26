// src/shared/junit-parser.mjs — JUnit XML result parser
// Shared between the Reprise Runner and the CI run-loop (T4).
// Spec: 02-specs/test-execution.md §Result format, §Adapters (report: junit)
//
// Parses the subset of JUnit XML produced by Android Instrumentation tests,
// Gradle, Maven, XCTest (via xcpretty), and most other common test runners.
//
// Returns an array of TestResult matching contracts/execution.ts.

/**
 * @typedef {{ id: string; status: 'passed' | 'failed' | 'error' | 'skipped'; message: string; output: string }} TestResult
 */

/**
 * Parse a JUnit XML string into an array of TestResult objects.
 * @param {string} xml
 * @param {string} filePath  Used to build the id prefix.
 * @returns {TestResult[]}
 */
export function parseJunit(xml, filePath) {
  /** @type {TestResult[]} */
  const results = [];

  // Pull out all <testcase> elements (handles both <testsuite> and <testsuites>).
  const testCaseRe = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/gi;
  let m;
  while ((m = testCaseRe.exec(xml)) !== null) {
    const attrs = m[1] ?? m[3] ?? '';
    const inner = m[2] ?? '';
    const name = attrValue(attrs, 'name') ?? 'unknown';
    const classname = attrValue(attrs, 'classname') ?? '';
    const id = `${filePath}::${classname ? classname + '.' : ''}${name}`;

    // Determine status
    let status = /** @type {'passed'|'failed'|'error'|'skipped'} */ ('passed');
    let message = '';
    let output = '';

    const failureMatch = /<failure\b([^>]*)>([\s\S]*?)<\/failure>/i.exec(inner);
    const errorMatch = /<error\b([^>]*)>([\s\S]*?)<\/error>/i.exec(inner);
    const skippedMatch = /<skipped\b[^>]*\/?>/i.exec(inner);
    const sysoutMatch = /<system-out>([\s\S]*?)<\/system-out>/i.exec(inner);
    const syserrMatch = /<system-err>([\s\S]*?)<\/system-err>/i.exec(inner);

    if (failureMatch) {
      status = 'failed';
      message = (attrValue(failureMatch[1], 'message') ?? failureMatch[2] ?? '').trim();
      output = failureMatch[2]?.trim() ?? '';
    } else if (errorMatch) {
      status = 'error';
      message = (attrValue(errorMatch[1], 'message') ?? errorMatch[2] ?? '').trim();
      output = errorMatch[2]?.trim() ?? '';
    } else if (skippedMatch) {
      status = 'skipped';
    }

    if (sysoutMatch) output += (output ? '\n' : '') + sysoutMatch[1].trim();
    if (syserrMatch) output += (output ? '\n' : '') + syserrMatch[1].trim();

    results.push({ id, status, message, output });
  }

  return results;
}

/**
 * Extract an XML attribute value from an attribute string.
 * @param {string} attrs
 * @param {string} name
 * @returns {string | undefined}
 */
function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(attrs);
  if (!m) return undefined;
  return unescapeXml(m[1] ?? m[2] ?? '');
}

/**
 * @param {string} s
 * @returns {string}
 */
function unescapeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
