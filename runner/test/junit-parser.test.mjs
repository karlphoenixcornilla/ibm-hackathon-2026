// test/junit-parser.test.mjs — unit tests for the JUnit XML parser
// Spec: 02-specs/test-execution.md §Result format

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJunit } from '../src/shared/junit-parser.mjs';

describe('parseJunit — passing tests', () => {
  it('parses a single passing testcase', () => {
    const xml = `<testsuite><testcase name="testLogin" classname="com.example.LoginTest"/></testsuite>`;
    const results = parseJunit(xml, 'app/LoginTest.kt');
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'passed');
    assert.equal(results[0].id, 'app/LoginTest.kt::com.example.LoginTest.testLogin');
    assert.equal(results[0].message, '');
  });

  it('parses multiple passing tests', () => {
    const xml = `
      <testsuite>
        <testcase name="test1" classname="Foo"/>
        <testcase name="test2" classname="Foo"/>
      </testsuite>`;
    const results = parseJunit(xml, 'FooTest.kt');
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.status === 'passed'));
  });
});

describe('parseJunit — failing tests', () => {
  it('marks a testcase with <failure> as failed', () => {
    const xml = `
      <testsuite>
        <testcase name="testBiometric" classname="LoginTest">
          <failure message="AssertionError: expected true but was false">
            expected true but was false
          </failure>
        </testcase>
      </testsuite>`;
    const results = parseJunit(xml, 'LoginTest.kt');
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'failed');
    assert.ok(results[0].message.includes('AssertionError'));
  });

  it('marks a testcase with <error> as error', () => {
    const xml = `
      <testsuite>
        <testcase name="testCrash" classname="CrashTest">
          <error message="RuntimeException: null pointer">Stack trace here</error>
        </testcase>
      </testsuite>`;
    const results = parseJunit(xml, 'CrashTest.kt');
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'error');
    assert.ok(results[0].message.includes('RuntimeException'));
  });

  it('marks a testcase with <skipped> as skipped', () => {
    const xml = `
      <testsuite>
        <testcase name="testSkipped" classname="SkipTest">
          <skipped/>
        </testcase>
      </testsuite>`;
    const results = parseJunit(xml, 'SkipTest.kt');
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'skipped');
  });
});

describe('parseJunit — id format', () => {
  it('builds id as filePath::classname.testname', () => {
    const xml = `<testcase name="myTest" classname="com.example.MyClass"/>`;
    const results = parseJunit(xml, 'src/MyClassTest.java');
    assert.equal(results[0].id, 'src/MyClassTest.java::com.example.MyClass.myTest');
  });

  it('builds id without classname separator when classname is empty', () => {
    const xml = `<testcase name="myTest"/>`;
    const results = parseJunit(xml, 'src/MyTest.js');
    assert.equal(results[0].id, 'src/MyTest.js::myTest');
  });
});

describe('parseJunit — system output', () => {
  it('includes system-out in output field', () => {
    const xml = `
      <testsuite>
        <testcase name="t" classname="C">
          <system-out>some output here</system-out>
        </testcase>
      </testsuite>`;
    const results = parseJunit(xml, 'test.js');
    assert.ok(results[0].output.includes('some output here'));
  });
});

describe('parseJunit — XML entities', () => {
  it('unescapes XML entities in attributes', () => {
    const xml = `<testcase name="test &amp; method" classname="Foo &lt;Bar&gt;"/>`;
    const results = parseJunit(xml, 'f.kt');
    assert.ok(results[0].id.includes('test & method'));
  });
});

describe('parseJunit — empty/invalid XML', () => {
  it('returns empty array for empty XML', () => {
    const results = parseJunit('', 'test.kt');
    assert.equal(results.length, 0);
  });

  it('returns empty array for XML with no testcase elements', () => {
    const results = parseJunit('<testsuite><properties/></testsuite>', 'test.kt');
    assert.equal(results.length, 0);
  });
});
